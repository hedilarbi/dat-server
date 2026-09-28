const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  companyName: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  activityType: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  role: {
    type: String,
    enum: ['admin', 'vendeur', 'acheteur'],
    default: 'acheteur',
    required: true
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
    postalCode: { type: String, trim: true }
  },
  // Numéro SIRET de l'établissement : 14 chiffres (SIREN sur 9 + NIC sur 5)
  siret: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  // Tampon de l'entreprise, détouré sur fond transparent (facultatif)
  stampUrl: {
    type: String,
    trim: true
  },
  // Documents téléversés sur Firebase Storage
  kbisUrl: {
    type: String,
    trim: true
  },
  cinRectoUrl: {
    type: String,
    trim: true
  },
  cinVersoUrl: {
    type: String,
    trim: true
  },
  // Spécificités Vendeurs
  vhuNumber: {
    type: String,
    trim: true
  },
  bankInfo: {
    bankName: { type: String, trim: true },
    accountHolder: { type: String, trim: true },
    iban: { type: String, trim: true },
    bic: { type: String, trim: true },
    ribUrl: { type: String, trim: true }
  },
  // Statuts d'inscription
  status: {
    type: String,
    enum: ['brouillon', 'soumis', 'en_attente_validation', 'refuse', 'correction_demandee', 'valide', 'suspendu', 'bloque'],
    default: 'brouillon'
  },
  // Email verification & OTP
  emailVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    code: { type: String },
    expiresAt: { type: Date }
  },
  // Historique des refus
  rejections: [{
    date: { type: Date, default: Date.now },
    motifs: [{ type: String }],
    motifsLabels: [{ type: String }],
    comment: { type: String },
    resubmittedAt: { type: Date }
  }],
  // Préférences
  language: {
    type: String,
    enum: ['fr', 'en'],
    default: 'fr'
  },
  expoPushToken: {
    type: String,
    trim: true
  },
  // Dette à régler avant réactivation : commission réellement due à l'étape 1,
  // ou pénalité fixe configurée lorsque le délai de l'étape 2 est dépassé.
  pendingCommission: {
    amount: { type: Number },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    reason: {
      type: String,
      enum: ['commission_impayee', 'penalite_etape_2'],
      default: 'commission_impayee'
    }
  },
  suspension: {
    note: { type: String, trim: true },
    source: { type: String, enum: ['admin', 'system'] },
    reason: {
      type: String,
      enum: ['admin', 'commission_impayee', 'penalite_etape_2']
    },
    date: { type: Date }
  },
  // Historique des suspensions et blocages : `suspension` ci-dessus ne décrit que la suspension
  // en cours et disparaît à la réactivation. Alimenté automatiquement par le hook de sauvegarde
  // plus bas, à chaque changement de statut — aucun chemin de suspension ne peut l'oublier.
  suspensionHistory: [{
    status: { type: String, enum: ['suspendu', 'bloque'] },
    source: { type: String, enum: ['admin', 'system'] },
    reason: { type: String, enum: ['admin', 'commission_impayee', 'penalite_etape_2'] },
    note: { type: String, trim: true },
    // Dette à régler au moment de la suspension (commission de l'étape 1 ou pénalité de l'étape 2)
    debtAmount: { type: Number },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    startedAt: { type: Date },
    endedAt: { type: Date },
    // Levée par le paiement de la dette, ou réactivation manuelle par l'administration
    endedBy: { type: String, enum: ['paiement', 'admin'] }
  }]
}, {
  timestamps: true
});

const SUSPENDED_STATUSES = ['suspendu', 'bloque'];

// Statut et dette tels que chargés depuis la base : le hook de sauvegarde en a besoin pour
// détecter une transition (Mongoose ne conserve pas l'ancienne valeur d'un champ modifié).
function rememberSuspensionState(user) {
  user.$locals.originalStatus = user.status;
  user.$locals.originalPendingCommission = user.pendingCommission ? {
    amount: user.pendingCommission.amount,
    saleId: user.pendingCommission.saleId,
  } : null;
  user.$locals.originalSuspension = user.suspension ? {
    note: user.suspension.note,
    source: user.suspension.source,
    reason: user.suspension.reason,
    date: user.suspension.date,
  } : null;
}

userSchema.post('init', function () {
  rememberSuspensionState(this);
});

// Ouvrir une entrée d'historique à l'entrée en suspension/blocage, la clôturer à la sortie.
userSchema.pre('save', function () {
  const user = this;
  if (user.isNew || !user.isModified('status')) return;

  const previous = user.$locals.originalStatus;
  const next = user.status;
  const wasSuspended = SUSPENDED_STATUSES.includes(previous);
  const isSuspended = SUSPENDED_STATUSES.includes(next);
  const openEntry = [...user.suspensionHistory].reverse().find((entry) => !entry.endedAt);

  if (!wasSuspended && isSuspended) {
    user.suspensionHistory.push({
      status: next,
      source: user.suspension?.source || 'admin',
      reason: user.suspension?.reason || 'admin',
      note: user.suspension?.note || undefined,
      debtAmount: user.pendingCommission?.amount || undefined,
      sale: user.pendingCommission?.saleId || undefined,
      startedAt: user.suspension?.date || new Date(),
    });
  } else if (wasSuspended && isSuspended && openEntry) {
    // Passage de suspendu à bloqué (ou l'inverse) : même période, statut mis à jour.
    openEntry.status = next;
  } else if (wasSuspended && !isSuspended) {
    const originalDebt = user.$locals.originalPendingCommission;
    const originalSuspension = user.$locals.originalSuspension;
    const debtCleared = Boolean(originalDebt?.amount) && !(user.pendingCommission && user.pendingCommission.amount);
    const endedAt = new Date();

    if (openEntry) {
      openEntry.endedAt = endedAt;
      openEntry.endedBy = debtCleared ? 'paiement' : 'admin';
    } else {
      // Compatibilité avec les comptes suspendus avant l'introduction de l'historique :
      // leur suspension courante doit être archivée avant que la réactivation ne l'efface.
      user.suspensionHistory.push({
        status: previous,
        source: originalSuspension?.source || 'admin',
        reason: originalSuspension?.reason || 'admin',
        note: originalSuspension?.note || undefined,
        debtAmount: originalDebt?.amount || undefined,
        sale: originalDebt?.saleId || undefined,
        startedAt: originalSuspension?.date || user.updatedAt || endedAt,
        endedAt,
        endedBy: debtCleared ? 'paiement' : 'admin',
      });
    }
  }
});

userSchema.post('save', function () {
  rememberSuspensionState(this);
});

// Middleware Mongoose pour hacher le mot de passe avant de sauvegarder
userSchema.pre('save', async function () {
  const user = this;
  if (!user.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(user.password, salt);
  user.password = hash;
});

// Méthode pour comparer les mots de passe
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
