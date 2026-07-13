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
    trim: true
  },
  activityType: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
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
  }
}, {
  timestamps: true
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
