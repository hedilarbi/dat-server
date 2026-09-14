const axios = require('axios');
const fs = require('fs');
const { getSignedUrl } = require('./storage.service');

const ESIGNATURE_BASE_URL = process.env.ESIGNATURE_BASE_URL || 'https://test.esignature.openapi.com';
const ESIGNATURE_API_URL = `${ESIGNATURE_BASE_URL}/EU-SES`;

/**
 * Convertit un buffer PDF ou une URL en base64 pour OpenAPI
 */
const bufferToBase64 = (buffer) => {
  return buffer.toString('base64');
};

/**
 * Créer une requête SES pour les 2 documents avec les 2 signataires (vendeur, acheteur)
 */
const createSignatureSession = async ({ saleId, seller, buyer, certificateBuffer, purchaseDeclarationBuffer }) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) {
    throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');
  }

  const baseUrl = process.env.APP_BASE_URL || 'https://votre-domaine.com';
  const webhookSecret = process.env.ESIGNATURE_WEBHOOK_SECRET;
  if (process.env.NODE_ENV === 'production' && !webhookSecret) {
    throw new Error('ESIGNATURE_WEBHOOK_SECRET manquant dans les variables d\'environnement');
  }

  const payload = {
    callback: {
      url: `${baseUrl}/api/webhooks/esignature`,
      method: 'JSON',
      retry: 5,
      ...(webhookSecret ? { headers: { 'X-Webhook-Secret': webhookSecret } } : {}),
      custom: {
        saleId: saleId
      }
    },
    inputDocuments: [
      {
        sourceType: "base64",
        payload: bufferToBase64(certificateBuffer)
      },
      {
        sourceType: "base64",
        payload: bufferToBase64(purchaseDeclarationBuffer)
      }
    ],
    signers: [
      {
        name: seller.firstName || seller.companyName || 'Vendeur',
        surname: seller.lastName || '',
        email: seller.email,
        authentication: ["email"],
        language: seller.language || 'fr',
        message: "Bonjour, voici votre code OTP pour signer les documents de vente: {OTP}",
        signatures: [
          // Certificat de cession (Page 1) - Vendeur (Bas de la section Ancien propriétaire)
          { page: 1, x: "260", y: "502" },
          // Déclaration d'achat (Page 2) - Vendeur (Bas de page)
          { page: 2, x: "260", y: "732" }
        ]
      },
      {
        name: buyer.firstName || buyer.companyName || 'Acheteur',
        surname: buyer.lastName || '',
        email: buyer.email,
        authentication: ["email"],
        language: buyer.language || 'fr',
        message: "Bonjour, voici votre code OTP pour signer les documents de vente: {OTP}",
        signatures: [
          // Certificat de cession (Page 1) - Acheteur (Bas de page)
          { page: 1, x: "260", y: "780" },
          // Déclaration d'achat (Page 2) - Acheteur (Milieu de page)
          { page: 2, x: "340", y: "432" }
        ]
      }
    ]
  };

  try {
    const response = await axios.post(ESIGNATURE_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success === false) {
      console.error('OpenAPI a retourné une erreur logique :', response.data);
      throw new Error(`OpenAPI Error: ${response.data.message}`);
    }
    
    if (response.data && response.data.errorNumber) {
      console.error('OpenAPI a retourné une erreur interne :', response.data);
      throw new Error(`OpenAPI Error: ${response.data.errorMessage}`);
    }

    // L'API encapsule la réponse dans un objet { success, message, data, error }
    // En cas de succès, les données (id, signers) se trouvent dans response.data.data
    return response.data.data;
  } catch (error) {
    console.error('Erreur lors de l\'appel à OpenAPI eSignature:', error.response?.data || error.message);
    throw new Error('La création de la session de signature a échoué.');
  }
};

module.exports = {
  createSignatureSession
};

/**
 * Récupère le document signé final depuis OpenAPI
 */
const fetchSignedDocument = async (signatureId) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) {
    throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');
  }

  try {
    const response = await axios.get(`${ESIGNATURE_BASE_URL}/signatures/${signatureId}/signedDocument`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      responseType: 'arraybuffer' // car c'est un fichier binaire
    });

    return response.data; // Retourne le Buffer du PDF
  } catch (error) {
    console.error(`Erreur lors de la récupération du document signé (${signatureId}):`, error.message);
    throw new Error('Impossible de récupérer le document signé depuis OpenAPI.');
  }
};

const fetchAuditTrail = async (signatureId) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');

  const response = await axios.get(`${ESIGNATURE_BASE_URL}/signatures/${signatureId}/audit`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
};

module.exports.fetchSignedDocument = fetchSignedDocument;
module.exports.fetchAuditTrail = fetchAuditTrail;
