const VehicleDossier = require('../models/vehicleDossier.model');
const User = require('../models/user.model');
const RefusalReason = require('../models/refusalReason.model');
const { sendEmail } = require('../config/mail');
const { normalizeLanguage, dossierApprovalEmail, dossierRejectionEmail, dossierCorrectionEmail } = require('./emailTemplates.service');
const notificationService = require('./notification.service');

// expo-server-sdk v6 ships as an ES Module ("type": "module"); require()-ing it crashe sur le
// runtime Node de Vercel (ERR_REQUIRE_ESM) — chargé via import() dynamique, comme dans admin.service.js.
let expoModulePromise = null;
const getExpoModule = async () => {
  if (!expoModulePromise) {
    expoModulePromise = import('expo-server-sdk');
  }
  return expoModulePromise;
};

const sendPushNotification = async (user, { title, body, data }) => {
  const { Expo } = await getExpoModule();
  if (!user.expoPushToken || !Expo.isExpoPushToken(user.expoPushToken)) return;

  const expo = new Expo();
  const chunks = expo.chunkPushNotifications([{ to: user.expoPushToken, sound: 'default', title, body, data }]);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (pushError) {
      console.error(`Erreur d'envoi de notification push (dossier véhicule) : ${pushError.message}`);
    }
  }
};

const vehicleLabelOf = (dossier) => [dossier.brand, dossier.model].filter(Boolean).join(' ') || 'Véhicule';

const sendDecisionEmail = async (seller, emailContent) => {
  try {
    return await sendEmail({ to: seller.email, ...emailContent });
  } catch (cause) {
    const error = new Error(`L'e-mail n'a pas pu être envoyé à ${seller.email || 'ce vendeur'}. La décision n'a pas été appliquée : vérifiez la configuration SMTP puis réessayez.`);
    error.statusCode = 502;
    error.codeName = 'vehicleDossier.email_delivery_failed';
    error.cause = cause;
    throw error;
  }
};

/**
 * Résout les clés de motifs (RefusalReason) en libellés lisibles dans la langue du destinataire.
 * Mêmes conventions que admin.service.js::rejectUser (motifsLabels = libellés résolus et figés
 * au moment de la décision, indépendants d'une modification ultérieure du référentiel).
 */
const resolveReasonMessages = async (motifs, language) => {
  const reasons = await RefusalReason.find({ key: { $in: motifs } });
  const lang = normalizeLanguage(language);
  return reasons.length > 0
    ? reasons.map((r) => r.message[lang] || r.message.fr || r.key)
    : motifs;
};

// Whitelist explicite des champs modifiables par le vendeur — ne JAMAIS spreader req.body
// directement dans le document, sous peine de permettre à un vendeur de s'auto-valider
// (status), de changer de propriétaire (seller) ou d'écrire dans l'historique de refus
// (refusals), qui sont tous des champs du schéma mais réservés au serveur/à l'admin.
const VEHICLE_FIELDS = [
  'brand', 'model', 'year', 'mileage', 'engine', 'fuelType', 'vin', 'description',
  'reservePrice', 'conditionDetails', 'registrationNumber', 'session',
  'registrationCountry', 'firstRegistrationDate', 'co2', 'energyLabel', 'vehicleGenre',
  'fiscalPower', 'bodyType', 'gearbox', 'passengerCount', 'doorCount', 'color', 'vrade',
  'procedure', 'vehicleAddress', 'vehicleAddressDetails', 'registrationCardAvailable', 'registrationCardMissingReasons',
  'identificationSheetAvailable', 'policeBookNumber'
];

const BLUR_ZONE_FIELDS = ['page', 'x', 'y', 'width', 'height'];

const pickBlurZones = (zones) => {
  if (!Array.isArray(zones)) return [];
  return zones.map((zone) => {
    const picked = {};
    for (const field of BLUR_ZONE_FIELDS) {
      if (zone[field] !== undefined) picked[field] = zone[field];
    }
    return picked;
  });
};

const pickPhoto = (photo) => ({
  originalUrl: photo.originalUrl,
  processedUrl: photo.processedUrl,
  blurZones: pickBlurZones(photo.blurZones),
  isCover: Boolean(photo.isCover),
  order: photo.order ?? 0,
  width: photo.width,
  height: photo.height
});

const pickDocument = (doc) => ({
  type: doc.type,
  originalUrl: doc.originalUrl,
  processedUrl: doc.processedUrl,
  mimeType: doc.mimeType,
  blurZones: pickBlurZones(doc.blurZones),
  label: doc.label,
  width: doc.width,
  height: doc.height
});

const pickEditableFields = (payload) => {
  const result = {};
  for (const field of VEHICLE_FIELDS) {
    if (payload[field] !== undefined) result[field] = payload[field];
  }
  if (payload.photos !== undefined) {
    result.photos = (payload.photos || []).map((photo, index) => ({ ...pickPhoto(photo), isCover: index === 0 }));
  }
  if (payload.expertReport !== undefined) {
    result.expertReport = payload.expertReport ? pickDocument(payload.expertReport) : undefined;
  }
  if (payload.additionalDocuments !== undefined) {
    result.additionalDocuments = (payload.additionalDocuments || []).map(pickDocument);
  }
  return result;
};

/**
 * Vérifie qu'un dossier contient tout le nécessaire pour être soumis à validation admin
 * (cahier des charges §10.3). Lève une erreur codeName='vehicleDossier.incomplete' sinon.
 */
const assertSubmittable = (dossier) => {
  const missing = [];

  const requiredFields = ['brand', 'model', 'year', 'mileage', 'engine', 'fuelType', 'vin', 'description', 'reservePrice'];
  for (const field of requiredFields) {
    if (dossier[field] === undefined || dossier[field] === null || dossier[field] === '') {
      missing.push(field);
    }
  }

  if (!dossier.photos || dossier.photos.length === 0) {
    missing.push('photos');
  } else if (dossier.photos.filter((p) => p.isCover).length !== 1) {
    missing.push('coverPhoto');
  }

  if (missing.length > 0) {
    const error = new Error(`Le dossier est incomplet pour être soumis à validation. Champs manquants : ${missing.join(', ')}.`);
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.incomplete';
    error.details = { missing };
    throw error;
  }
};

/** Notifie l'administrateur (centre de notifications in-app) qu'un dossier vient d'être soumis. */
const notifyAdminOfSubmission = async (dossier, sellerId) => {
  try {
    const seller = await User.findById(sellerId).select('companyName');
    if (seller) await notificationService.createAdminVehicleDossierNotification(dossier, seller);
  } catch (err) {
    console.error(`Erreur lors de la notification admin (soumission dossier véhicule) : ${err.message}`);
  }
};

const createDossier = async (sellerId, payload) => {
  const fields = pickEditableFields(payload);
  if (fields.registrationNumber) {
    const cleanReg = fields.registrationNumber.trim().replace(/[\s-]/g, '');
    if (cleanReg) {
      const existing = await VehicleDossier.findOne({
        registrationNumber: new RegExp(`^${cleanReg}$`, 'i')
      });
      if (existing) {
        const error = new Error(`Un dossier véhicule existe déjà avec le matricule / immatriculation « ${fields.registrationNumber} ».`);
        error.statusCode = 400;
        error.codeName = 'vehicleDossier.registration_number_exists';
        throw error;
      }
    }
  }

  const dossier = new VehicleDossier({
    seller: sellerId,
    ...fields
  });

  if (payload.submit) {
    assertSubmittable(dossier);
    dossier.status = 'soumis';
    dossier.submittedAt = new Date();
  }

  await dossier.save();
  if (payload.submit) await notifyAdminOfSubmission(dossier, sellerId);
  return dossier;
};

const getOwnedDossier = async (dossierId, sellerId) => {
  const dossier = await VehicleDossier.findById(dossierId);
  if (!dossier) {
    const error = new Error('Dossier véhicule introuvable.');
    error.statusCode = 404;
    error.codeName = 'vehicleDossier.not_found';
    throw error;
  }
  if (dossier.seller.toString() !== sellerId.toString()) {
    const error = new Error("Accès refusé. Vous n'êtes pas le propriétaire de ce dossier.");
    error.statusCode = 403;
    error.codeName = 'vehicleDossier.access_forbidden';
    throw error;
  }
  return dossier;
};

const updateDossier = async (dossierId, sellerId, payload) => {
  const dossier = await getOwnedDossier(dossierId, sellerId);

  if (!['brouillon', 'correction_demandee'].includes(dossier.status)) {
    const error = new Error('Ce dossier ne peut plus être modifié dans son statut actuel.');
    error.statusCode = 403;
    error.codeName = 'vehicleDossier.not_editable';
    throw error;
  }

  const fields = pickEditableFields(payload);
  if (fields.registrationNumber && fields.registrationNumber !== dossier.registrationNumber) {
    const cleanReg = fields.registrationNumber.trim().replace(/[\s-]/g, '');
    if (cleanReg) {
      const existing = await VehicleDossier.findOne({
        registrationNumber: new RegExp(`^${cleanReg}$`, 'i'),
        _id: { $ne: dossierId }
      });
      if (existing) {
        const error = new Error(`Un dossier véhicule existe déjà avec le matricule / immatriculation « ${fields.registrationNumber} ».`);
        error.statusCode = 400;
        error.codeName = 'vehicleDossier.registration_number_exists';
        throw error;
      }
    }
  }

  const wasCorrection = dossier.status === 'correction_demandee';
  Object.assign(dossier, fields);

  if (payload.submit) {
    assertSubmittable(dossier);
    dossier.status = 'soumis';
    dossier.submittedAt = new Date();
    if (wasCorrection && dossier.refusals.length > 0) {
      dossier.refusals[dossier.refusals.length - 1].resubmittedAt = new Date();
    }
  }

  await dossier.save();
  if (payload.submit) await notifyAdminOfSubmission(dossier, sellerId);
  return dossier;
};

/**
 * Dossiers d'un vendeur, paginés et filtrables colonne par colonne.
 *
 * Le filtrage se fait en base et non sur le tableau déjà chargé : sinon il ne porterait que
 * sur la page affichée, et le compteur de résultats mentirait.
 */
const listDossiers = async (sellerId, filters = {}) => {
  const query = { seller: sellerId };
  if (filters.status) {
    // Plusieurs statuts internes partagent un même libellé côté vendeur — « soumis » et
    // « en_attente_validation » notamment. Le filtre accepte donc une liste séparée par
    // des virgules, pour qu'une seule option d'interface couvre bien les deux.
    const statuses = String(filters.status).split(',').map((v) => v.trim()).filter(Boolean);
    if (statuses.length === 1) query.status = statuses[0];
    else if (statuses.length > 1) query.status = { $in: statuses };
  }

  // Recherche par sous-chaîne, insensible à la casse, comme côté administration
  for (const field of ['brand', 'model']) {
    if (filters[field]) query[field] = new RegExp(escapeRegExp(String(filters[field])), 'i');
  }
  if (filters.reservePrice && Number.isFinite(Number(filters.reservePrice))) {
    query.reservePrice = Number(filters.reservePrice);
  }

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const [dossiers, total] = await Promise.all([
    VehicleDossier.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    VehicleDossier.countDocuments(query),
  ]);

  return { dossiers, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
};

const getDossierById = async (dossierId, sellerId) => getOwnedDossier(dossierId, sellerId);

const deleteDossier = async (dossierId, sellerId) => {
  const dossier = await getOwnedDossier(dossierId, sellerId);
  if (dossier.status !== 'brouillon') {
    const error = new Error('Seul un dossier en brouillon peut être supprimé.');
    error.statusCode = 403;
    error.codeName = 'vehicleDossier.not_deletable';
    throw error;
  }
  await dossier.deleteOne();
};

// ---------------------------------------------------------------------------
// Actions administrateur (cahier des charges §10.3) : portée sur tous les
// dossiers, indépendamment du propriétaire, sans les garde-fous de statut
// appliqués côté vendeur.
// ---------------------------------------------------------------------------

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const adminListDossiers = async (filters = {}) => {
  const query = {};
  if (filters.status && filters.status !== 'all') query.status = filters.status;

  let columnFilters = {};
  if (filters.columnFilters) {
    try {
      columnFilters = typeof filters.columnFilters === 'string' ? JSON.parse(filters.columnFilters) : filters.columnFilters;
    } catch {
      columnFilters = {};
    }
  }

  const textFields = ['brand', 'model', 'registrationNumber', 'procedure', 'co2', 'energyLabel', 'vehicleGenre', 'fiscalPower', 'bodyType', 'vin', 'gearbox', 'color', 'vrade'];
  textFields.forEach((field) => {
    if (columnFilters[field]) query[field] = new RegExp(escapeRegExp(String(columnFilters[field])), 'i');
  });
  if (columnFilters.year && Number.isFinite(Number(columnFilters.year))) query.year = Number(columnFilters.year);
  if (columnFilters.mileage && Number.isFinite(Number(columnFilters.mileage))) query.mileage = Number(columnFilters.mileage);
  if (columnFilters.registrationCardAvailable === 'true') query.registrationCardAvailable = true;
  if (columnFilters.registrationCardAvailable === 'false') query.registrationCardAvailable = false;
  if (columnFilters.status) query.status = columnFilters.status;
  if (columnFilters.submittedAt) {
    const start = new Date(`${columnFilters.submittedAt}T00:00:00.000Z`);
    const end = new Date(`${columnFilters.submittedAt}T23:59:59.999Z`);
    if (!Number.isNaN(start.getTime())) query.submittedAt = { $gte: start, $lte: end };
  }
  if (columnFilters.seller) {
    const sellerRegex = new RegExp(escapeRegExp(String(columnFilters.seller)), 'i');
    const sellerIds = await User.find({ $or: [{ companyName: sellerRegex }, { firstName: sellerRegex }, { lastName: sellerRegex }] }).distinct('_id');
    query.seller = { $in: sellerIds };
  }

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const [dossiers, total, counts] = await Promise.all([
    VehicleDossier.find(query)
      .populate('seller', 'companyName email firstName lastName')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    VehicleDossier.countDocuments(query),
    Promise.all([
      VehicleDossier.countDocuments({ status: 'soumis' }),
      VehicleDossier.countDocuments({ status: 'correction_demandee' }),
      VehicleDossier.countDocuments({ status: 'valide' }),
      VehicleDossier.countDocuments({ status: 'refuse' }),
    ]).then(([enAttente, correction, valide, refuse]) => ({ enAttente, correction, valide, refuse })),
  ]);

  return { dossiers, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), counts };
};

const adminGetDossierById = async (dossierId) => {
  const dossier = await VehicleDossier.findById(dossierId).populate('seller', 'companyName email firstName lastName phone language expoPushToken');
  if (!dossier) {
    const error = new Error('Dossier véhicule introuvable.');
    error.statusCode = 404;
    error.codeName = 'vehicleDossier.not_found';
    throw error;
  }
  return dossier;
};

const adminUpdateDossier = async (dossierId, payload) => {
  const dossier = await VehicleDossier.findById(dossierId);
  if (!dossier) {
    const error = new Error('Dossier véhicule introuvable.');
    error.statusCode = 404;
    error.codeName = 'vehicleDossier.not_found';
    throw error;
  }
  const editableFields = pickEditableFields(payload || {});
  // Les médias disposent de leur propre éditeur et ne sont pas remplacés par ce formulaire.
  delete editableFields.photos;
  delete editableFields.expertReport;
  delete editableFields.additionalDocuments;
  Object.assign(dossier, editableFields);
  await dossier.save();
  await dossier.populate('seller', 'companyName email firstName lastName phone language expoPushToken');
  return dossier;
};

const adminGetAvailableDossiers = async () => {
  return VehicleDossier.find({ status: 'valide', session: null })
    .populate('seller', 'companyName firstName lastName email')
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Permet à l'administrateur de retoucher les médias (zones de flou, recadrage, réordonnancement,
 * couverture) indépendamment du statut du dossier — cahier des charges §10.5 ("Modifier une photo
 * d'un dossier", "Modifier ou supprimer une zone de flou avant validation").
 */
const adminUpdateDossierMedia = async (dossierId, payload) => {
  const dossier = await VehicleDossier.findById(dossierId);
  if (!dossier) {
    const error = new Error('Dossier véhicule introuvable.');
    error.statusCode = 404;
    error.codeName = 'vehicleDossier.not_found';
    throw error;
  }

  if (payload.photos !== undefined) dossier.photos = (payload.photos || []).map(pickPhoto);
  if (payload.expertReport !== undefined) dossier.expertReport = payload.expertReport ? pickDocument(payload.expertReport) : undefined;
  if (payload.additionalDocuments !== undefined) dossier.additionalDocuments = (payload.additionalDocuments || []).map(pickDocument);

  await dossier.save();
  // Repeupler le vendeur : le front réutilise ce même objet pour rafraîchir l'affichage
  // (nom du vendeur) sans recharger toute la page.
  await dossier.populate('seller', 'companyName email firstName lastName phone');
  return dossier;
};

const approveDossier = async (dossierId) => {
  const dossier = await adminGetDossierById(dossierId);
  const seller = dossier.seller;
  const vehicleLabel = vehicleLabelOf(dossier);
  await sendDecisionEmail(seller, dossierApprovalEmail({ user: seller, vehicleLabel }));

  dossier.status = 'valide';
  await dossier.save();
  await sendPushNotification(seller, {
    title: 'Dossier véhicule validé !',
    body: `Votre dossier "${vehicleLabel}" a été validé.`,
    data: { dossierId: dossier._id.toString(), status: 'valide' },
  });

  return dossier;
};

const rejectDossier = async (dossierId, { motifs, comment }) => {
  if (!motifs || !Array.isArray(motifs) || motifs.length === 0) {
    const error = new Error('Veuillez spécifier au moins un motif de refus.');
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.validation_error';
    throw error;
  }

  const dossier = await adminGetDossierById(dossierId);
  const seller = dossier.seller;
  const reasonMessages = await resolveReasonMessages(motifs, seller.language);

  const vehicleLabel = vehicleLabelOf(dossier);
  const reasonsText = reasonMessages.map((text) => `- ${text}`).join('<br>');
  const reasonsPlain = reasonMessages.join(', ');
  await sendDecisionEmail(seller, dossierRejectionEmail({ user: seller, vehicleLabel, reasonsText, reasonsPlain, comment }));

  dossier.status = 'refuse';
  dossier.refusals.push({ date: new Date(), motifs, motifsLabels: reasonMessages, comment: comment || '' });
  await dossier.save();
  await sendPushNotification(seller, {
    title: 'Dossier véhicule refusé',
    body: `Votre dossier "${vehicleLabel}" a été refusé. Consultez votre espace pour plus de détails.`,
    data: { dossierId: dossier._id.toString(), status: 'refuse' },
  });

  return dossier;
};

const requestDossierCorrection = async (dossierId, { motifs, comment }) => {
  if (!motifs || !Array.isArray(motifs) || motifs.length === 0) {
    const error = new Error('Veuillez spécifier au moins un motif de correction.');
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.validation_error';
    throw error;
  }

  const dossier = await adminGetDossierById(dossierId);
  const seller = dossier.seller;
  const reasonMessages = await resolveReasonMessages(motifs, seller.language);

  const vehicleLabel = vehicleLabelOf(dossier);
  const reasonsText = reasonMessages.map((text) => `- ${text}`).join('<br>');
  const reasonsPlain = reasonMessages.join(', ');
  await sendDecisionEmail(seller, dossierCorrectionEmail({ user: seller, vehicleLabel, reasonsText, reasonsPlain, comment }));

  dossier.status = 'correction_demandee';
  dossier.refusals.push({ date: new Date(), motifs, motifsLabels: reasonMessages, comment: comment || '' });
  await dossier.save();
  await sendPushNotification(seller, {
    title: 'Correction demandée sur votre dossier véhicule',
    body: `Veuillez mettre à jour le dossier "${vehicleLabel}" dans votre espace.`,
    data: { dossierId: dossier._id.toString(), status: 'correction_demandee' },
  });

  return dossier;
};

module.exports = {
  createDossier,
  updateDossier,
  listDossiers,
  getDossierById,
  deleteDossier,
  adminListDossiers,
  adminGetDossierById,
  adminUpdateDossier,
  adminUpdateDossierMedia,
  approveDossier,
  rejectDossier,
  requestDossierCorrection,
  adminGetAvailableDossiers
};
