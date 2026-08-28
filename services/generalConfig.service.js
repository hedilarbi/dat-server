const GeneralConfig = require('../models/generalConfig.model');

const validationError = (message) => {
  const err = new Error(message);
  err.codeName = 'general_config.validation_error';
  return err;
};

// Champs modifiables depuis l'interface admin, avec leur libellé pour les messages d'erreur.
const FIELDS = [
  { key: 'commissionPaymentDeadlineHours', label: 'Le délai de paiement de la commission', type: 'number' },
  { key: 'bankTransferDeadlineHours', label: 'Le délai de virement', type: 'number' },
  { key: 'vehicleListingAttempts', label: 'Le nombre de tentatives de mise en vente', type: 'number' },
  { key: 'nextWinnerAcceptanceDeadlineHours', label: 'Le délai pour le gagnant suivant', type: 'number' },
  { key: 'accountReactivationFee', label: 'Les frais de dossier de réactivation', type: 'number' },
  { key: 'adminEmail', label: "L'adresse email de l'administrateur", type: 'email' },
];

/**
 * Récupérer la configuration générale, en la créant avec ses valeurs par défaut
 * au premier accès (document unique).
 */
const getConfig = async () => {
  let config = await GeneralConfig.findOne();
  if (!config) {
    config = await GeneralConfig.create({});
  }
  return config;
};

const updateConfig = async (payload) => {
  const config = await getConfig();

  for (const { key, label, type } of FIELDS) {
    if (payload[key] === undefined) continue;

    if (type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const emailVal = String(payload[key]).trim();
      if (!emailRegex.test(emailVal)) {
        throw validationError(`${label} doit être une adresse email valide.`);
      }
      config[key] = emailVal;
    } else {
      const value = Number(payload[key]);
      if (!Number.isInteger(value) || value < 1) {
        throw validationError(`${label} doit être un nombre entier supérieur ou égal à 1.`);
      }
      config[key] = value;
    }
  }

  await config.save();
  return config;
};

module.exports = {
  getConfig,
  updateConfig,
};
