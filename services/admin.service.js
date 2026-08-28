const User = require('../models/user.model');
const RefusalReason = require('../models/refusalReason.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const Ticket = require('../models/ticket.model');
const Session = require('../models/session.model');
const Sale = require('../models/sale.model');
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
  const { role, status, search, city, dateFrom, dateTo } = filters;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  let columnFilters = {};
  if (filters.columnFilters) {
    try {
      columnFilters = typeof filters.columnFilters === 'string' ? JSON.parse(filters.columnFilters) : filters.columnFilters;
    } catch (e) {
      columnFilters = {};
    }
  }

  const query = { role: { $ne: 'admin' } };
  if (role && role !== 'all') query.role = role;
  if (status && status !== 'all') query.status = STATUS_GROUP_MAP[status] || status;
  if (city) query['address.city'] = new RegExp(escapeRegExp(city), 'i');
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) query.createdAt.$lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  if (columnFilters.companyName) query.companyName = new RegExp(escapeRegExp(String(columnFilters.companyName)), 'i');
  if (columnFilters.activityType) query.activityType = new RegExp(escapeRegExp(String(columnFilters.activityType)), 'i');
  if (columnFilters.city) query['address.city'] = new RegExp(escapeRegExp(String(columnFilters.city)), 'i');
  if (columnFilters.email) query.email = new RegExp(escapeRegExp(String(columnFilters.email)), 'i');
  if (columnFilters.phone) query.phone = new RegExp(escapeRegExp(String(columnFilters.phone)), 'i');
  if (columnFilters.status) query.status = STATUS_GROUP_MAP[columnFilters.status] || columnFilters.status;
  if (columnFilters.submittedAt) {
    const start = new Date(`${columnFilters.submittedAt}T00:00:00.000Z`);
    const end = new Date(`${columnFilters.submittedAt}T23:59:59.999Z`);
    query.createdAt = { $gte: start, $lte: end };
  }

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
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
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
      User.countDocuments(roleScopedQuery),
      User.countDocuments({ ...roleScopedQuery, createdAt: { $gte: monthStart } }),
    ]).then(([totalAll, acheteur, vendeur, enAttente, correction, valide, refuse, roleTotal, newThisMonth]) => ({
      all: totalAll,
      acheteur,
      vendeur,
      enAttente,
      correction,
      valide,
      refuse,
      roleTotal,
      newThisMonth,
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

  if ((newStatus === 'suspendu' || newStatus === 'bloque') && user.role === 'acheteur') {
    try {
      const { revokeOngoingSalesForSuspendedBuyer } = require('./sale.service');
      await revokeOngoingSalesForSuspendedBuyer(user._id, 'suspension_admin');
    } catch (err) {
      console.error(`Erreur réattribution des ventes lors de la suspension admin de ${user._id}:`, err.message);
    }
  }

  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

/**
 * Retrieve dashboard statistics (KPIs and pending actions)
 */
const getDashboardStats = async () => {
  // Pending actions
  const pendingUsersCount = await User.countDocuments({ status: 'en_attente', role: { $in: ['acheteur', 'vendeur'] } });
  const pendingDossiersCount = await VehicleDossier.countDocuments({ status: 'soumis' });
  const pendingTicketsCount = await Ticket.countDocuments({ status: 'en_attente_admin' });

  // KPIs
  const activeSessionsCount = await Session.countDocuments({ status: 'en_cours' });
  const validatedUsersCount = await User.countDocuments({ status: 'valide', role: { $in: ['acheteur', 'vendeur'] } });
  
  // Total transaction volume
  const sales = await Sale.find({ status: { $in: ['en_attente_paiement', 'paye', 'cloture'] } });
  const totalTransactionVolume = sales.reduce((acc, sale) => acc + (sale.winningOfferAmount || 0), 0);
  
  // Completed sales count
  const completedSalesCount = await Sale.countDocuments({ status: 'cloture' });

  // Recent activities (last 5 users)
  const recentUsers = await User.find({ role: { $in: ['acheteur', 'vendeur'] } })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('firstName lastName companyName role email createdAt status');
  // Late payments (Step 1 or 2, >80% time elapsed or overdue)
  const allCurrentPayments = await Sale.find({
    status: 'en_cours',
    currentStep: { $in: [1, 2] },
  })
    .populate('vehicle', 'brand model year')
    .populate('winner', 'firstName lastName companyName')
    .lean();

  const now = new Date();
  const latePaymentSales = allCurrentPayments
    .filter((sale) => {
      if (!sale.currentStepDueAt) return false;
      const dueAt = new Date(sale.currentStepDueAt);
      const startedAt = sale.currentStepStartedAt
        ? new Date(sale.currentStepStartedAt)
        : sale.wonAt
          ? new Date(sale.wonAt)
          : sale.createdAt
            ? new Date(sale.createdAt)
            : null;

      if (now >= dueAt) return true; // Déjà dépassé
      if (!startedAt) return false;

      const total = dueAt.getTime() - startedAt.getTime();
      if (total <= 0) return true;

      const elapsedPercent = ((now.getTime() - startedAt.getTime()) / total) * 100;
      return elapsedPercent >= 80;
    })
    .map((sale) => ({
      ...sale,
      winningOfferAmount: sale.amount || sale.winningOfferAmount || 0,
    }));
    
  return {
    pendingActions: {
      users: pendingUsersCount,
      dossiers: pendingDossiersCount,
      tickets: pendingTicketsCount,
      latePayments: latePaymentSales,
    },
    kpis: {
      activeSessions: activeSessionsCount,
      validatedUsers: validatedUsersCount,
      totalTransactionVolume,
      completedSales: completedSalesCount
    },
    recentActivities: {
      users: recentUsers
    }
  };
};

/**
 * Liste de tous les paiements Stripe (commission de vente & réactivation de compte)
 */
const listPayments = async (filters = {}) => {
  const Payment = require('../models/payment.model');
  const { type, search } = filters;

  const query = {};
  if (type && type !== 'all') {
    query.type = type;
  }

  // 1. Récupérer les enregistrements de la collection Payment
  let payments = await Payment.find(query)
    .populate('user', 'firstName lastName email companyName role')
    .populate({
      path: 'sale',
      populate: { path: 'vehicle', select: 'brand model year' },
    })
    .sort({ paidAt: -1, createdAt: -1 })
    .lean();

  // 2. Si la collection est encore vide (ex: ventes passées avant la création du modèle),
  // on réconcilie à partir des ventes ayant commissionPaidAt
  if (payments.length === 0) {
    const paidSales = await Sale.find({ commissionPaidAt: { $ne: null } })
      .populate('winner', 'firstName lastName email companyName role')
      .populate('vehicle', 'brand model year')
      .populate('winningOffer', 'fees')
      .sort({ commissionPaidAt: -1 })
      .lean();

    for (const sale of paidSales) {
      if (!sale.winner) continue;
      const amountInEuros = sale.commissionPayment?.amount ? sale.commissionPayment.amount / 100 : (sale.winningOffer?.fees?.total || sale.winningOffer?.fees?.commission || sale.fees?.commission || 300);
      try {
        await Payment.create({
          user: sale.winner._id,
          sale: sale._id,
          type: 'paiement_commission',
          amount: amountInEuros,
          currency: 'eur',
          stripeSessionId: sale.commissionPayment?.checkoutSessionId || null,
          stripePaymentIntentId: sale.commissionPayment?.paymentIntentId || null,
          status: 'paye',
          paidAt: sale.commissionPaidAt || sale.createdAt,
        });
      } catch (e) {
        // Ignorer les doublons
      }
    }

    payments = await Payment.find(query)
      .populate('user', 'firstName lastName email companyName role')
      .populate({
        path: 'sale',
        populate: { path: 'vehicle', select: 'brand model year' },
      })
      .sort({ paidAt: -1, createdAt: -1 })
      .lean();
  }

  // Application de la recherche textuelle éventuelle
  if (search) {
    const s = search.toLowerCase();
    payments = payments.filter((p) => {
      const u = p.user || {};
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const company = (u.companyName || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const stripeId = (p.stripeSessionId || p.stripePaymentIntentId || '').toLowerCase();
      const vehicle = p.sale?.vehicle ? `${p.sale.vehicle.brand} ${p.sale.vehicle.model}`.toLowerCase() : '';
      return fullName.includes(s) || company.includes(s) || email.includes(s) || stripeId.includes(s) || vehicle.includes(s);
    });
  }

  // Calcul des statistiques cumulées
  const totalAmount = payments.reduce((acc, p) => acc + (p.amount || 0), 0);
  const commissionPaymentsCount = payments.filter((p) => p.type === 'paiement_commission').length;
  const reactivationPaymentsCount = payments.filter((p) => p.type === 'reactivation_compte').length;

  return {
    payments: payments.map((p) => ({
      id: String(p._id),
      user: p.user ? {
        id: String(p.user._id),
        name: `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() || p.user.companyName || 'Utilisateur',
        companyName: p.user.companyName || '',
        email: p.user.email || '',
        role: p.user.role || 'acheteur',
      } : null,
      saleId: p.sale ? String(p.sale._id) : null,
      vehicle: p.sale?.vehicle ? `${p.sale.vehicle.brand} ${p.sale.vehicle.model}` : null,
      type: p.type,
      typeLabel: p.type === 'paiement_commission' ? 'Paiement de commission' : 'Réactivation de compte',
      amount: p.amount,
      currency: p.currency || 'eur',
      provider: p.provider || 'stripe',
      stripeId: p.stripeSessionId || p.stripePaymentIntentId || 'stripe_direct',
      status: p.status || 'paye',
      paidAt: p.paidAt || p.createdAt,
    })),
    summary: {
      totalAmount,
      commissionPaymentsCount,
      reactivationPaymentsCount,
      totalCount: payments.length,
    },
  };
};

module.exports = {
  getUsers,
  approveUser,
  rejectUser,
  requestCorrection,
  updateUserStatus,
  getDashboardStats,
  listPayments,
};
