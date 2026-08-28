const mongoose = require('mongoose');
const commissionTierFields = require('./commissionTierFields');

/**
 * Tranche de commission plateforme (configuration par défaut).
 * Chaque tranche couvre un intervalle de montants [minAmount, maxAmount] et définit
 * la commission appliquée : soit un pourcentage du montant, soit un montant fixe.
 * maxAmount = null signifie « et plus » (dernière tranche, non bornée).
 *
 * Chaque session hérite de cette configuration et peut la surcharger
 * (voir `commission` dans models/session.model.js).
 */
const commissionTierSchema = new mongoose.Schema(commissionTierFields, {
  timestamps: true
});

commissionTierSchema.index({ minAmount: 1 });

const CommissionTier = mongoose.model('CommissionTier', commissionTierSchema);

module.exports = CommissionTier;
