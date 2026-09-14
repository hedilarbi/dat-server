const { finalizeSignature } = require('../services/sale.service');
const crypto = require('crypto');

const validWebhookSecret = (received) => {
  const expected = process.env.ESIGNATURE_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  if (typeof received !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

/**
 * Gère le webhook OpenAPI envoyé lorsqu'une session de signature est mise à jour (ex: terminée)
 */
exports.handleEsignatureWebhook = async (req, res, next) => {
  try {
    if (!validWebhookSecret(req.get('X-Webhook-Secret'))) {
      return res.status(401).json({ success: false, message: 'Webhook non authentifié' });
    }
    const { data, custom } = req.body;
    if (!data || !custom || !custom.saleId) {
      return res.status(400).json({ success: false, message: 'Payload invalide' });
    }

    const signatureId = data.id;
    const state = data.state;
    const saleId = custom.saleId;

    console.log(`Webhook eSignature reçu : Vente=${saleId}, Signature=${signatureId}, Statut=${state}`);

    // Si la signature est totalement terminée (les deux ont signé)
    if (state === 'DONE') {
      // Finalise la signature (télécharge le doc final, passe à l'étape 7)
      await finalizeSignature(saleId, signatureId);
    }

    // Répond à OpenAPI que tout est OK
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erreur dans handleEsignatureWebhook:', error);
    // Un statut non-2xx permet à OpenAPI d'utiliser la politique de retry configurée.
    return res.status(500).json({ success: false, error: error.message });
  }
};
