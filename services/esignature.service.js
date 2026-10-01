const axios = require('axios');
const fs = require('fs');
const { getSignedUrl } = require('./storage.service');

// Même repli que les e-mails (emailTemplates.service.js) : le retour depuis la plateforme de
// signature doit désigner le même site que les liens envoyés par courriel.
const CLIENT_BASE_URL = (process.env.CLIENT_BASE_URL || 'https://dealautopro.com').replace(/\/+$/, '');

// La documentation OpenAPI ne décrit que l'état NEW d'un signataire : on reconnaît les libellés
// de fin usuels, et une signature entièrement terminée (DONE) vaut pour tous les signataires.
const SIGNER_DONE_STATES = ['SIGNED', 'DONE', 'COMPLETED'];
const loggedSignerStates = new Set();

const requiredUrl = (name) => {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} manquant dans les variables d'environnement`);

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} doit être une URL valide`);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`${name} doit utiliser HTTPS en production`);
  }
  return raw.replace(/\/+$/, '');
};

// Zones de signature sur la première page de chaque document (x, y depuis le haut de la page).
// Les tampons (saleDocuments.service.js) sont posés à côté et ne doivent pas les recouvrir.
const SIGNATURE_FIELDS = {
  certificate: {
    seller: { x: '120', y: '518' }, // Sous « Fait à … le », cadre « Ancien propriétaire »
    buyer: { x: '120', y: '772' },  // Sous « Fait à … le », cadre « Nouveau propriétaire »
  },
  purchaseDeclaration: {
    seller: { x: '120', y: '738' }, // Sous « Fait à … le », cadre « Certificat de vente »
    buyer: { x: '250', y: '430' },  // À gauche du cadre « Cachet et signature de l'acquéreur »
  },
};

const signaturesFor = (role, declarationFirstPage) => [
  { page: 1, ...SIGNATURE_FIELDS.certificate[role] },
  { page: declarationFirstPage, ...SIGNATURE_FIELDS.purchaseDeclaration[role] },
];

/**
 * Créer une requête SES pour le dossier regroupant les deux documents (certificat de cession
 * puis déclaration d'achat, tous deux remplis et tamponnés), avec les deux signataires.
 * `declarationFirstPage` : page (à partir de 1) où commence la déclaration dans le dossier.
 */
const createSignatureSession = async ({ saleId, seller, buyer, bundleBuffer, declarationFirstPage }) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) {
    throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');
  }

  const esignatureBaseUrl = requiredUrl('ESIGNATURE_BASE_URL');
  const baseUrl = requiredUrl('APP_BASE_URL');
  const webhookSecret = process.env.ESIGNATURE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
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
        payload: bundleBuffer.toString('base64')
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
        signatures: signaturesFor('seller', declarationFirstPage)
      },
      {
        name: buyer.firstName || buyer.companyName || 'Acheteur',
        surname: buyer.lastName || '',
        email: buyer.email,
        authentication: ["email"],
        language: buyer.language || 'fr',
        message: "Bonjour, voici votre code OTP pour signer les documents de vente: {OTP}",
        signatures: signaturesFor('buyer', declarationFirstPage)
      }
    ],
    options: {
      // Par défaut, OpenAPI laisse le signataire modifier son nom et l'adresse qui reçoit l'OTP :
      // quiconque ouvrirait un lien de signature pourrait alors signer à la place de son titulaire.
      userEditableData: { name: false, email: false, mobile: false },
      ui: {
        // Le premier signataire arrive sur « en attente des autres signataires » : ce bouton le
        // ramène sur la vente, qui lui confirme qu'il n'a plus rien à faire.
        completeUrl: `${CLIENT_BASE_URL}/signature-terminee?vente=${encodeURIComponent(saleId)}`
      }
    }
  };

  try {
    const response = await axios.post(`${esignatureBaseUrl}/EU-SES`, payload, {
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
    // Le motif renvoyé par OpenAPI (ex. « Expired Token ») est conservé pour l'administration.
    const reason = error.response?.data?.message || error.message;
    throw new Error(`La création de la session de signature a échoué${reason ? ` (${reason})` : ''}.`);
  }
};

module.exports = {
  createSignatureSession,
  SIGNATURE_FIELDS
};

/**
 * Récupère le document signé final depuis OpenAPI
 */
const fetchSignedDocument = async (signatureId) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) {
    throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');
  }

  const esignatureBaseUrl = requiredUrl('ESIGNATURE_BASE_URL');
  try {
    const response = await axios.get(`${esignatureBaseUrl}/signatures/${signatureId}/signedDocument`, {
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

  const esignatureBaseUrl = requiredUrl('ESIGNATURE_BASE_URL');
  const response = await axios.get(`${esignatureBaseUrl}/signatures/${signatureId}/audit`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
};

/**
 * État courant d'une signature côté OpenAPI (WAIT_VALIDATION, WAIT_SIGN, WAIT_SIGNER, DONE, ERROR)
 * et avancement de chaque signataire, dans l'ordre d'envoi (vendeur puis acheteur).
 * Sert à dire à chaque partie où en est l'autre, et à rattraper une signature terminée dont
 * le webhook n'est jamais arrivé.
 */
const fetchSignatureProgress = async (signatureId) => {
  const token = process.env.ESIGNATURE_TOKEN;
  if (!token) throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');

  const esignatureBaseUrl = requiredUrl('ESIGNATURE_BASE_URL');
  const response = await axios.get(`${esignatureBaseUrl}/signatures/${signatureId}/detail`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  // Selon les endpoints, l'API renvoie l'objet directement ou l'enveloppe dans { data }.
  const detail = response.data?.data ?? response.data;
  const state = detail?.state || null;
  const signers = (detail?.signers || []).map((signer) => {
    const signerState = String(signer.state || '').toUpperCase();
    // Trace une seule fois chaque état inconnu, pour ajuster SIGNER_DONE_STATES si besoin.
    if (signerState && signerState !== 'NEW' && !SIGNER_DONE_STATES.includes(signerState) && !loggedSignerStates.has(signerState)) {
      loggedSignerStates.add(signerState);
      console.warn(`État de signataire OpenAPI non reconnu : ${signerState} (signature ${signatureId})`);
    }
    return {
      email: String(signer.email || '').trim().toLowerCase(),
      signed: state === 'DONE' || SIGNER_DONE_STATES.includes(signerState),
    };
  });
  return { state, signers };
};

module.exports.fetchSignatureProgress = fetchSignatureProgress;
module.exports.fetchSignedDocument = fetchSignedDocument;
module.exports.fetchAuditTrail = fetchAuditTrail;
