const Tax = require('../models/tax.model');

// Taxe appliquée sur la commission plateforme lors du dépôt d'une offre.
const PLATFORM_TAX_NAME = 'TAV';

/**
 * Taxe plateforme, ou un taux nul si elle n'a pas encore été créée en base :
 * une taxe manquante ne doit pas empêcher un acheteur de déposer son offre.
 */
const getPlatformTax = async () => {
  const tax = await Tax.findOne({ name: PLATFORM_TAX_NAME });
  return { name: tax ? tax.name : PLATFORM_TAX_NAME, rate: tax ? tax.value : 0 };
};

module.exports = {
  PLATFORM_TAX_NAME,
  getPlatformTax
};
