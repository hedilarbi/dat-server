/**
 * Définition partagée d'une tranche de commission.
 * Utilisée par le modèle CommissionTier (configuration par défaut de la plateforme)
 * et par le sous-document `commission.tiers` des sessions (configuration propre à une session).
 */
const commissionTierFields = {
  minAmount: {
    type: Number,
    required: true,
    min: 0
  },
  maxAmount: {
    type: Number,
    default: null,
    min: 0
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  label: {
    type: String,
    trim: true,
    default: ''
  },
  active: {
    type: Boolean,
    default: true
  }
};

module.exports = commissionTierFields;
