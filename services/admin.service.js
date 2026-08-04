const User = require('../models/user.model');
const RefusalReason = require('../models/refusalReason.model');
const { sendEmail } = require('../config/mail');
const { normalizeLanguage, approvalEmail, rejectionEmail, correctionEmail } = require('./emailTemplates.service');

// expo-server-sdk v6 ships as an ES Module ("type": "module"); require()-ing it crashes on
// Vercel's Node runtime (ERR_REQUIRE_ESM), so it must be loaded via dynamic import() instead.
let expoModulePromise = null;
const getExpoModule = async () => {
  if (!expoModulePromise) {
    expoModulePromise = import('expo-server-sdk');
  }
  return expoModulePromise;
};

const STATUS_GROUP_MAP = {
  attente: 'soumis',
  correction: 'correction_demandee',
  valide: 'valide',
  refuse: { $in: ['refuse', 'bloque', 'suspendu'] },
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Récupérer la liste des utilisateurs (avec filtres de rôle, statut, recherche et pagination)
 */
const getUsers = async (filters = {}) => {
  const { role, status, search } = filters;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const query = { role: { $ne: 'admin' } };
  if (role && role !== 'all') query.role = role;
  if (status && status !== 'all') query.status = STATUS_GROUP_MAP[status] || status;

  const conditions = [query];
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    conditions.push({
      $or: [
        { companyName: regex },
        { email: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] },
              regex: escapeRegExp(search),
              options: 'i',
            },
          },
        },
      ],
    });
  }
  const finalQuery = conditions.length > 1 ? { $and: conditions } : query;

  const baseQuery = { role: { $ne: 'admin' } };
  // Les compteurs de statut (en attente/correction/validé/refusé) suivent le filtre de rôle
  // en cours, pour que /inscriptions/acheteur et /inscriptions/vendeur affichent chacune
  // leurs propres totaux plutôt que ceux des deux rôles combinés.
  const roleScopedQuery = role && role !== 'all' ? { ...baseQuery, role } : baseQuery;
  const [users, total, counts] = await Promise.all([
    User.find(finalQuery)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(finalQuery),
    Promise.all([
      User.countDocuments(baseQuery),
      User.countDocuments({ ...baseQuery, role: 'acheteur' }),
      User.countDocuments({ ...baseQuery, role: 'vendeur' }),
      User.countDocuments({ ...roleScopedQuery, status: STATUS_GROUP_MAP.attente }),
      User.countDocuments({ ...roleScopedQuery, status: STATUS_GROUP_MAP.correction }),
      User.countDocuments({ ...roleScopedQuery, status: STATUS_GROUP_MAP.valide }),
      User.countDocuments({ ...roleScopedQuery, status: STATUS_GROUP_MAP.refuse }),
    ]).then(([totalAll, acheteur, vendeur, enAttente, correction, valide, refuse]) => ({
      all: totalAll,
      acheteur,
      vendeur,
      enAttente,
      correction,
      valide,
      refuse,
    })),
  ]);

  return {
    users,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
};

/**
 * Valider l'inscription d'un utilisateur (acheteur ou vendeur)
 */
const approveUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'admin.user_not_found';
    throw err;
  }

  user.status = 'valide';
  await user.save();

  // Envoyer un e-mail de validation
  try {
    await sendEmail({
      to: user.email,
      ...approvalEmail(user)
    });
  } catch (emailError) {
    console.error(`Erreur d'envoi du mail d'approbation : ${emailError.message}`);
  }

  // Envoyer une notification push
  const { Expo } = await getExpoModule();
  if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    const expo = new Expo();
    const messages = [{
      to: user.expoPushToken,
      sound: 'default',
      title: 'Votre compte est activé !',
      body: 'Félicitations, votre compte professionnel a été validé.',
      data: { status: 'valide' },
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (pushError) {
        console.error(`Erreur d'envoi de notification push (approbation) : ${pushError.message}`);
      }
    }
  }

  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

/**
 * Rejeter l'inscription d'un utilisateur (avec motifs et commentaire)
 */
const rejectUser = async (userId, { motifs, comment }) => {
  if (!motifs || !Array.isArray(motifs) || motifs.length === 0) {
    const err = new Error('Veuillez spécifier au moins un motif de refus.');
    err.codeName = 'admin.validation_error';
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'admin.user_not_found';
    throw err;
  }

  // Chercher les messages des motifs (pour l'e-mail et l'historique affiché à l'utilisateur)
  const reasons = await RefusalReason.find({ key: { $in: motifs } });
  const language = normalizeLanguage(user.language);
  const reasonMessages = reasons.length > 0
    ? reasons.map(r => r.message[language] || r.message.fr || r.key)
    : motifs;
  const reasonsText = reasonMessages.map(text => `- ${text}`).join('<br>');
  const reasonsPlain = reasonMessages.join(', ');

  // Changer le statut
  user.status = 'refuse';

  // Enregistrer le rejet dans l'historique (motifsLabels = libellés résolus affichés à l'utilisateur)
  user.rejections.push({
    date: new Date(),
    motifs,
    motifsLabels: reasonMessages,
    comment: comment || ''
  });

  await user.save();

  // Envoyer un e-mail avec les causes du refus et le commentaire
  try {
    await sendEmail({
      to: user.email,
      ...rejectionEmail({ user, reasonsText, reasonsPlain, comment })
    });
  } catch (emailError) {
    console.error(`Erreur d'envoi du mail de refus : ${emailError.message}`);
  }

  // Envoyer une notification push
  const { Expo } = await getExpoModule();
  if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    const expo = new Expo();
    const messages = [{
      to: user.expoPushToken,
      sound: 'default',
      title: 'Action requise : Inscription refusée',
      body: 'Votre inscription a été refusée. Veuillez consulter votre espace pour corriger votre dossier.',
      data: { status: 'refuse' },
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (pushError) {
        console.error(`Erreur d'envoi de notification push (refus) : ${pushError.message}`);
      }
    }
  }

  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

/**
 * Demander une correction sur l'inscription d'un utilisateur (avec motifs et commentaire)
 */
const requestCorrection = async (userId, { motifs, comment }) => {
  if (!motifs || !Array.isArray(motifs) || motifs.length === 0) {
    const err = new Error('Veuillez spécifier au moins un motif de correction.');
    err.codeName = 'admin.validation_error';
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'admin.user_not_found';
    throw err;
  }

  const reasons = await RefusalReason.find({ key: { $in: motifs } });
  const language = normalizeLanguage(user.language);
  const reasonMessages = reasons.length > 0
    ? reasons.map(r => r.message[language] || r.message.fr || r.key)
    : motifs;
  const reasonsText = reasonMessages.map(text => `- ${text}`).join('<br>');
  const reasonsPlain = reasonMessages.join(', ');

  user.status = 'correction_demandee';
  user.rejections.push({
    date: new Date(),
    motifs,
    motifsLabels: reasonMessages,
    comment: comment || ''
  });

  await user.save();

  try {
    await sendEmail({
      to: user.email,
      ...correctionEmail({ user, reasonsText, reasonsPlain, comment })
    });
  } catch (emailError) {
    console.error(`Erreur d'envoi du mail de correction : ${emailError.message}`);
  }

  const { Expo } = await getExpoModule();
  if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    const expo = new Expo();
    const messages = [{
      to: user.expoPushToken,
      sound: 'default',
      title: 'Correction demandée sur votre dossier',
      body: 'Veuillez consulter votre espace pour mettre à jour votre dossier.',
      data: { status: 'correction_demandee' },
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (pushError) {
        console.error(`Erreur d'envoi de notification push (correction) : ${pushError.message}`);
      }
    }
  }

  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

/**
 * Suspendre ou bloquer un utilisateur
 */
const updateUserStatus = async (userId, newStatus) => {
  const allowed = ['valide', 'suspendu', 'bloque'];
  if (!allowed.includes(newStatus)) {
    const err = new Error('Statut invalide.');
    err.codeName = 'admin.invalid_status';
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'admin.user_not_found';
    throw err;
  }

  user.status = newStatus;
  await user.save();

  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

module.exports = {
  getUsers,
  approveUser,
  rejectUser,
  requestCorrection,
  updateUserStatus
};
