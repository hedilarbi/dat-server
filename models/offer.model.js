const mongoose = require('mongoose');

// Frais figés au moment du dépôt : le barème de commission d'une session ou le taux de taxe
// peuvent changer ensuite, l'offre doit garder le détail accepté par l'acheteur.
const offerFeesSchema = new mongoose.Schema({
  commission: { type: Number, required: true, min: 0 },
  commissionTier: {
    minAmount: { type: Number },
    maxAmount: { type: Number, default: null },
    type: { type: String, enum: ['percentage', 'fixed'] },
    value: { type: Number }
  },
  taxName: { type: String, trim: true, default: '' },
  taxRate: { type: Number, default: 0, min: 0 },
  taxAmount: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 }
}, { _id: false });

/**
 * Offre à pli fermé déposée par un acheteur sur un dossier véhicule
 * pendant une session d'appel d'offres active (cahier des charges §6.3).
 */
const offerSchema = new mongoose.Schema({
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
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Prix proposé par l'acheteur, hors commission et hors taxe
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  fees: {
    type: offerFeesSchema,
    required: true
  },
  // Montants successivement proposés avant la valeur courante, pour garder la trace
  // des modifications faites par l'acheteur pendant la session.
  revisions: [{
    amount: { type: Number, required: true, min: 0 },
    fees: { type: offerFeesSchema, required: true },
    replacedAt: { type: Date, default: Date.now }
  }],
  status: {
    type: String,
    enum: ['active', 'annulee'],
    default: 'active'
  },
  cancelledAt: { type: Date }
}, {
  timestamps: true
});

offerSchema.index({ vehicle: 1, createdAt: -1 });
offerSchema.index({ buyer: 1, createdAt: -1 });

const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer;
