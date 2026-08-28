const Tax = require('../models/tax.model');

// Taxes créées au premier démarrage si elles n'existent pas encore.
const DEFAULT_TAXES = [
  { name: 'TAV', value: 20 }
];

const seedTaxes = async () => {
  try {
    for (const tax of DEFAULT_TAXES) {
      const existing = await Tax.findOne({ name: tax.name });
      if (existing) {
        console.log(`La taxe ${tax.name} existe déjà.`);
        continue;
      }
      await Tax.create(tax);
      console.log(`Taxe ${tax.name} créée avec succès (${tax.value} %).`);
    }
  } catch (error) {
    console.error(`Erreur lors de la création des taxes par défaut : ${error.message}`);
  }
};

module.exports = seedTaxes;
