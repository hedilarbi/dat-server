const mongoose = require('mongoose');

// Motifs de refus d'un certificat signé, proposés au vendeur à l'étape de validation.
const CERTIFICATE_REJECTION_REASONS = [
  'tampon_manquant',
  'mauvais_tampon',
  'document_illisible',
  'signature_manquante',
  'document_incomplet',
  'mauvais_document',
  'autre',
];

// Étapes de la procédure d'achat suivie par le gagnant, dans l'ordre.
const PURCHASE_STEPS = [
  'commission',          // 1. Paiement de la commission + choix de remise des papiers
  'virement',            // 2. Virement du prix du véhicule au vendeur
  'certificat_vendeur',  // 3. Certificat téléchargé, signé et redéposé par le vendeur (ou auto)
  'validation_acheteur', // 4. Acheteur valide le certificat du vendeur
  'certificat_acheteur', // 5. Certificat téléchargé, signé et redéposé par l'acheteur (ou auto)
  'validation_vendeur',  // 6. Confirmation des documents par le vendeur
  'enlevement',          // 7. Mandat d'enlèvement, OTP et clôture de la vente
];

/**
 * Un candidat de la liste d'attente : l'offre reste éligible tant que le gagnant courant
 * n'a pas terminé sa procédure. Si celui-ci est écarté (délai dépassé), le rang suivant prend
 * sa place et reçoit exactement la même procédure.
 */
const waitingListEntrySchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
  amount: { type: Number, required: true },
  // Moment retenu pour départager deux offres de même montant
  offeredAt: { type: Date, required: true },
  rank: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ['gagnant', 'en_attente', 'ecarte', 'en_attente_confirmation', 'refuse_proposition'],
    default: 'en_attente'
  },
  discardedAt: { type: Date },
  discardReason: { type: String, trim: true }
}, { _id: false });

/**
 * Résultat de la mise en vente d'un véhicule à la clôture d'une session : le gagnant
 * désigné, la liste d'attente ordonnée, et l'avancement de la procédure d'achat.
 */
const saleSchema = new mongoose.Schema({
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VehicleDossier',
    required: true
  },
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Prix de réserve au moment de la clôture : seules les offres l'atteignant sont éligibles
  reservePrice: { type: Number, default: 0 },

  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winningOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
  amount: { type: Number, default: null },
  // Rang courant dans la liste d'attente (0 quand plus personne n'est éligible)
  currentRank: { type: Number, default: 0 },
  waitingList: { type: [waitingListEntrySchema], default: [] },

  status: {
    type: String,
    enum: ['en_cours', 'cloturee', 'sans_gagnant', 'annulee', 'en_attente_confirmation'],
    default: 'en_cours'
  },
  // Position dans PURCHASE_STEPS (1 = paiement de la commission)
  currentStep: { type: Number, default: 1, min: 1, max: PURCHASE_STEPS.length },
  currentStepStartedAt: { type: Date, default: null },
  // Échéance de l'étape en cours, calculée d'après les délais de la configuration générale.
  // Dépassée, elle écarte le gagnant au profit du candidat suivant de la liste d'attente.
  currentStepDueAt: { type: Date, default: null },
  // Seuils de rappel déjà envoyés pour l'étape en cours (en % du délai écoulé),
  // remis à zéro à chaque changement d'étape pour ne jamais relancer deux fois.
  stepRemindersSent: { type: [Number], default: [] },
  
  // Pause du chronomètre par l'admin
  timerPaused: { type: Boolean, default: false },
  timerPausedAt: { type: Date, default: null },

  // Étape 1 : paiement de la commission et mode de remise des papiers du véhicule
  commissionPaidAt: { type: Date, default: null },
  documentsDelivery: {
    type: String,
    enum: ['main_propre', 'poste'],
    default: null
  },
  // Trace du paiement en ligne de la commission. `amount` est en centimes, comme chez Stripe.
  commissionPayment: {
    provider: { type: String, default: 'stripe' },
    // 'checkout' pour le web (session hébergée), 'payment_intent' pour la PaymentSheet mobile
    mode: { type: String, enum: ['checkout', 'payment_intent'], default: null },
    checkoutSessionId: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['en_attente', 'paye', 'echoue'],
      default: null
    },
    amount: { type: Number, default: null },
    currency: { type: String, default: 'eur' },
    initiatedAt: { type: Date, default: null }
  },

  // Étape 2 : le virement est fait hors plateforme, le vendeur en confirme la réception
  transferConfirmedAt: { type: Date, default: null },

  // Étape 3 : certificat de cession généré par la plateforme, puis redéposé signé et tamponné
  certificate: {
    url: { type: String, default: null },
    filename: { type: String, default: null },
    generatedAt: { type: Date, default: null },
    // Étape 3 : le vendeur télécharge, signe et redépose le certificat (si pas de tampon auto)
    sellerSignedUrl: { type: String, default: null },
    sellerSignedFilename: { type: String, default: null },
    sellerSignedAt: { type: Date, default: null },
    // Étape 4 : l'acheteur valide que le document du vendeur est correct
    buyerValidatedAt: { type: Date, default: null },
    // Étape 5 : l'acheteur télécharge (le doc du vendeur), signe et redépose le certificat (si pas de tampon auto)
    signedUrl: { type: String, default: null },
    signedFilename: { type: String, default: null },
    signedAt: { type: Date, default: null },
    // Étape 6 : le vendeur atteste que le document déposé est bien signé et tamponné
    validatedAt: { type: Date, default: null },
    // Historique des refus : le document écarté est conservé pour la traçabilité.
    rejections: [{
      url: { type: String },
      rejectedBy: { type: String, enum: ['buyer', 'seller'], required: true },
      reason: { type: String, enum: CERTIFICATE_REJECTION_REASONS, required: true },
      comment: { type: String, trim: true },
      createdAt: { type: Date, default: Date.now }
    }],
    rejectionCount: { type: Number, default: 0 },
    lastRejection: {
      url: { type: String },
      rejectedBy: { type: String, enum: ['buyer', 'seller'] },
      reason: { type: String, enum: CERTIFICATE_REJECTION_REASONS },
      comment: { type: String, trim: true },
      createdAt: { type: Date }
    }
  },

  // Étape 5 : déclaration d'achat générée, remise au vendeur contre l'OTP détenu par l'acheteur
  handover: {
    declarationUrl: { type: String, default: null },
    declarationFilename: { type: String, default: null },
    generatedAt: { type: Date, default: null },
    // Code à usage unique affiché à l'acheteur et saisi par le vendeur lors de l'enlèvement
    otp: { type: String, default: null },
    otpAttempts: { type: Number, default: 0 },
    confirmedAt: { type: Date, default: null }
  },

  wonAt: { type: Date },
  closedAt: { type: Date }
}, {
  timestamps: true
});

// Un véhicule ne peut donner lieu qu'à une seule vente par session : garantit
// l'idempotence du traitement d'attribution, même s'il est rejoué.
saleSchema.index({ vehicle: 1, session: 1 }, { unique: true });
saleSchema.index({ winner: 1, createdAt: -1 });

const Sale = mongoose.model('Sale', saleSchema);

module.exports = Sale;
module.exports.PURCHASE_STEPS = PURCHASE_STEPS;
module.exports.CERTIFICATE_REJECTION_REASONS = CERTIFICATE_REJECTION_REASONS;
