const mongoose = require('mongoose');

/**
 * Configuration générale de la plateforme (document unique).
 * Regroupe les délais de la procédure d'achat et la limite de remise en vente.
 */
const generalConfigSchema = new mongoose.Schema({
  // Délai laissé au gagnant pour régler la commission plateforme avant d'être écarté
  // au profit du candidat suivant de la liste d'attente.
  commissionPaymentDeadlineHours: {
    type: Number,
    default: 48,
    min: 1,
  },
  // Délai laissé à l'acheteur pour virer le prix du véhicule au vendeur.
  bankTransferDeadlineHours: {
    type: Number,
    default: 92,
    min: 1,
  },
  // Nombre de mises en vente autorisées pour un même véhicule.
  vehicleListingAttempts: {
    type: Number,
    default: 3,
    min: 1,
  },
  // Délai laissé au gagnant suivant pour accepter ou refuser le véhicule.
  nextWinnerAcceptanceDeadlineHours: {
    type: Number,
    default: 24,
    min: 1,
  },
  // Frais de dossier pour réactiver un compte suspendu (en euros).
  accountReactivationFee: {
    type: Number,
    default: 300,
    min: 1,
  },
  // Adresse e-mail de l'administrateur pour recevoir les notifications système
  adminEmail: {
    type: String,
    default: 'contact@dealautopro.com',
    trim: true,
  },
}, {
  timestamps: true,
});

const GeneralConfig = mongoose.model('GeneralConfig', generalConfigSchema);

module.exports = GeneralConfig;
