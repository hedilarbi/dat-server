const mongoose = require('mongoose');

/**
 * Jeton d'accès d'un service externe (signature électronique OpenAPI), renouvelé automatiquement.
 * Il est gardé en base et non dans le `.env` : un renouvellement produit un nouveau jeton (et un
 * nouveau refresh token) que le serveur doit retenir, y compris après un redémarrage.
 */
const integrationTokenSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  token: { type: String, required: true },
  refreshToken: { type: String, default: null },
  // Droits du jeton, relus sur le compte tant qu'il est valide : après son expiration, OpenAPI ne les
  // renvoie plus, or un nouveau jeton doit avoir les mêmes.
  scopes: { type: [String], default: [] },
  // Date d'expiration annoncée par OpenAPI ; inconnue pour un jeton saisi à la main dans le .env
  expireAt: { type: Date, default: null },
  // Valeur du .env à partir de laquelle ce jeton a été initialisé : si le .env change (nouveau jeton
  // collé à la main), le serveur repart de cette nouvelle valeur.
  seededFrom: { type: String, default: null },
  renewedAt: { type: Date, default: null },
  lastAlertAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('IntegrationToken', integrationTokenSchema);
