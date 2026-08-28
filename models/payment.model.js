const mongoose = require('mongoose');

/**
 * Historique des paiements Stripe de la plateforme.
 * Motifs supportés :
 * - `paiement_commission` : Règlement de la commission sur une vente remportée
 * - `reactivation_compte` : Règlement de la pénalité/commission impayée pour réactiver un compte suspendu
 */
const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale',
    default: null,
  },
  type: {
    type: String,
    enum: ['paiement_commission', 'reactivation_compte'],
    required: true,
  },
  amount: {
    type: Number, // Montant en Euros (ex: 300)
    required: true,
  },
  currency: {
    type: String,
    default: 'eur',
  },
  provider: {
    type: String,
    default: 'stripe',
  },
  mode: {
    type: String,
    enum: ['checkout', 'payment_intent'],
    default: 'checkout',
  },
  stripeSessionId: {
    type: String,
    default: null,
  },
  stripePaymentIntentId: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['paye', 'en_attente', 'echoue'],
    default: 'paye',
  },
  paidAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Payment', paymentSchema);
