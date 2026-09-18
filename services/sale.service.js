const mongoose = require('mongoose');
const Sale = require('../models/sale.model');
const Session = require('../models/session.model');
const Offer = require('../models/offer.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const User = require('../models/user.model');
const { sendEmail } = require('../config/mail');
const emailTemplates = require('./emailTemplates.service');
const generalConfigService = require('./generalConfig.service');
const paymentService = require('./payment.service');
const notificationService = require('./notification.service');
const { fillCertificateOfTransfer } = require('./certificateOfTransfer.service');
const { fillPurchaseDeclaration } = require('./purchaseDeclaration.service');
const { saveBuffer } = require('./storage.service');
const { generateBonEnlevement } = require('./handoverDocument.service');
const { createSignatureSession, fetchSignedDocument, fetchAuditTrail } = require('./esignature.service');
const { stampSignedBundle } = require('./signedDocumentStamp.service');
const { isStripeConfigured } = require('../config/stripe');

const CLOSED_SESSION_STATUSES = ['closed', 'cloturee'];
const OPEN_SESSION_STATUSES = ['open', 'active'];

const getOfferCommissionTotal = (offer) => {
  const fees = offer?.fees;
  const amount = Number(fees?.commission || 0) + Number(fees?.taxAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Le montant de la commission impayée est introuvable.');
    err.codeName = 'payment.fees_missing';
    throw err;
  }
  return amount;
};


/**
 * Moment retenu pour départager deux offres de même montant : une offre modifiée est
 * considérée déposée à ce montant au moment de la modification, pas au dépôt initial.
 */
const offeredAt = (offer) => (
  (offer.revisions || []).length > 0 ? (offer.updatedAt || offer.createdAt) : offer.createdAt
);

/**
 * Liste d'attente d'un véhicule, du meilleur au moins bon candidat.
 * Seules les offres actives atteignant le prix de réserve sont éligibles ; à montant égal,
 * celui qui a misé ce montant le premier passe devant.
 */
const buildWaitingList = (offers, reservePrice) => offers
  .filter((offer) => offer.status === 'active' && offer.amount >= reservePrice)
  .sort((a, b) => (b.amount - a.amount) || (new Date(offeredAt(a)) - new Date(offeredAt(b))))
  .map((offer, index) => ({
    buyer: offer.buyer,
    offer: offer._id,
    amount: offer.amount,
    offeredAt: offeredAt(offer),
    rank: index + 1,
    status: index === 0 ? 'gagnant' : 'en_attente',
  }));

/**
 * Prévenir le gagnant par e-mail. Un échec d'envoi ne doit jamais faire échouer
 * l'attribution elle-même : la vente reste créée et le courriel est simplement journalisé.
 */
const notifyWinner = async (sale, vehicle, session, deadlineHours) => {
  try {
    const winner = await User.findById(sale.winner).select('email firstName lastName language');
    if (!winner) return;

    const email = emailTemplates.saleWonEmail({
      user: winner,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: session.name,
      amount: sale.amount,
      saleId: String(sale._id),
      deadlineHours,
    });

    await sendEmail({ to: winner.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification du gagnant impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Nombre de candidats prévenus qu'ils sont en liste d'attente, gagnant compris : les rangs 2
 * et 3 reçoivent l'e-mail, au-delà la probabilité d'être appelé ne le justifie plus.
 */
const WAITING_LIST_NOTIFIED_RANKS = 3;

/**
 * Prévenir les meilleurs offrants suivants qu'ils sont en liste d'attente. Leur offre n'est
 * pas perdue : elle reprend la main si le gagnant est écarté (délai dépassé, règles non
 * respectées). Comme les autres notifications, un échec d'envoi n'interrompt pas l'attribution.
 */
const notifyWaitingList = async (sale, vehicle, session) => {
  const runnersUp = (sale.waitingList || []).filter(
    (entry) => entry.rank > 1 && entry.rank <= WAITING_LIST_NOTIFIED_RANKS && !entry.topThreeEmailSentAt,
  );
  if (runnersUp.length === 0) return;

  const buyers = await User.find({ _id: { $in: runnersUp.map((entry) => entry.buyer) } })
    .select('email firstName lastName language')
    .lean();
  const buyersById = new Map(buyers.map((buyer) => [String(buyer._id), buyer]));

  for (const entry of runnersUp) {
    try {
      const buyer = buyersById.get(String(entry.buyer));
      if (!buyer) continue;

      const email = emailTemplates.saleWaitingListEmail({
        user: buyer,
        brand: vehicle?.brand || '',
        model: vehicle?.model || '',
        year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle),
        sessionName: session.name,
        rank: entry.rank,
        amount: entry.amount,
      });

      await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html });
      entry.topThreeEmailSentAt = new Date();
      await sale.save();
    } catch (error) {
      console.error(`Notification de liste d'attente impossible (vente ${sale._id}, rang ${entry.rank}) : ${error.message}`);
    }
  }
};

/** Envoyer (ou reprendre) les notifications liées à une réattribution déjà enregistrée. */
const notifyReattributedParties = async (sale, entry, vehicle, session, deadlineHours) => {
  const [candidate, seller] = await Promise.all([
    User.findById(entry.buyer).select('email firstName lastName language').lean(),
    User.findById(sale.seller).select('email firstName lastName language').lean(),
  ]);

  if (candidate && !entry.promotionEmailSentAt) {
    try {
      const email = emailTemplates.saleReattributedWinnerEmail({
        user: candidate,
        brand: vehicle?.brand || '', model: vehicle?.model || '', year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle), sessionName: session?.name || '', saleId: sale._id,
        amount: entry.amount, deadlineHours,
      });
      await sendEmail({ to: candidate.email, subject: email.subject, text: email.text, html: email.html });
      entry.promotionEmailSentAt = new Date();
      await sale.save();
    } catch (err) {
      console.error(`Impossible d'envoyer l'e-mail de réattribution à ${candidate.email} :`, err.message);
    }
  }

  if (seller && !entry.sellerPromotionEmailSentAt) {
    try {
      const email = emailTemplates.saleReattributedSellerEmail({
        user: seller,
        brand: vehicle?.brand || '', model: vehicle?.model || '', year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle), sessionName: session?.name || '', saleId: sale._id,
        amount: entry.amount, rank: entry.rank,
      });
      await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
      entry.sellerPromotionEmailSentAt = new Date();
      await sale.save();
    } catch (err) {
      console.error(`Impossible d'envoyer l'e-mail de réattribution au vendeur ${seller.email} :`, err.message);
    }
  }
};

/**
 * Prévenir le vendeur que l'enchère sur son véhicule est close et qu'une offre a été retenue.
 * Comme pour le gagnant, un échec d'envoi n'interrompt jamais l'attribution.
 */
const notifySellerAwarded = async (sale, vehicle, session) => {
  try {
    const seller = await User.findById(sale.seller).select('email firstName lastName language');
    if (!seller) return;

    const email = emailTemplates.saleAwardedSellerEmail({
      user: seller,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: session.name,
      amount: sale.amount,
      saleId: String(sale._id),
    });

    await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification du vendeur impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Prévenir le vendeur que son véhicule n'a pas trouvé preneur : le prix de réserve n'a pas
 * été atteint. Comme les autres notifications, un échec d'envoi n'interrompt pas l'attribution.
 */
const notifySellerUnsold = async (sale, vehicle, session, { bestOffer, offerCount }) => {
  try {
    const seller = await User.findById(sale.seller).select('email firstName lastName language');
    if (!seller) return;

    const email = emailTemplates.saleUnsoldSellerEmail({
      user: seller,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: session.name,
      reservePrice: sale.reservePrice,
      bestOffer,
      offerCount,
    });

    await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification d'invendu impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Positionner la vente sur une étape et armer son échéance. Les rappels déjà envoyés sont
 * remis à zéro : chaque étape a son propre cycle 50 % / 80 % / expiration.
 */
const enterStep = (sale, step, deadlineHours) => {
  const startedAt = new Date();
  sale.currentStep = step;
  sale.currentStepStartedAt = startedAt;
  sale.currentStepDueAt = deadlineHours
    ? new Date(startedAt.getTime() + deadlineHours * 3600 * 1000)
    : null;
  sale.stepRemindersSent = [];
  return deadlineHours;
};

/**
 * Placer la vente sur la première étape de la procédure d'achat, avec le délai de paiement
 * de la commission (Configuration > Configuration générale).
 * Retourne le délai retenu, pour l'annoncer dans l'e-mail envoyé au gagnant.
 */
const startPurchaseProcedure = async (sale) => {
  const { commissionPaymentDeadlineHours } = await generalConfigService.getConfig();
  sale.wonAt = new Date();
  // Une réattribution doit toujours démarrer avec un chronomètre actif. Sans cette remise
  // à zéro, une pause décidée pour le gagnant précédent exclut aussi le nouveau gagnant de
  // processStepDeadlines : il ne reçoit alors ni le rappel à 50 %, ni celui à 80 %.
  sale.timerPaused = false;
  sale.timerPausedAt = null;
  return enterStep(sale, 1, commissionPaymentDeadlineHours);
};

/**
 * Désigner le gagnant d'un véhicule à la clôture de sa session.
 * Retourne la vente créée, ou celle qui existait déjà (traitement rejoué).
 */
const attributeVehicle = async (vehicle, session) => {
  const existing = await Sale.findOne({ vehicle: vehicle._id, session: session._id });
  if (existing) return existing;

  // Un dossier sans prix de réserve n'impose aucun minimum : toute offre est éligible
  const reservePrice = Number.isFinite(vehicle.reservePrice) ? vehicle.reservePrice : 0;
  const offers = await Offer.find({ vehicle: vehicle._id, session: session._id }).lean();
  const waitingList = buildWaitingList(offers, reservePrice);

  const sale = new Sale({
    vehicle: vehicle._id,
    session: session._id,
    seller: vehicle.seller,
    reservePrice,
    waitingList,
  });

  if (waitingList.length === 0) {
    // Aucune offre, ou aucune n'atteint le prix de réserve : personne ne gagne
    sale.status = 'sans_gagnant';
    sale.currentRank = 0;
    await sale.save();
    // Le véhicule reste validé et redevient disponible : il sera republié dans une
    // prochaine session tant qu'il lui reste des tentatives de mise en vente.
    // Le compteur, lui, a déjà été incrémenté à la publication dans cette session.
    await VehicleDossier.updateOne({ _id: vehicle._id }, { $set: { session: null } });

    // La meilleure offre reçue, même sous la réserve, aide le vendeur à décider s'il
    // republie au même prix : on la lui transmet plutôt que de dire seulement « invendu ».
    const activeOffers = offers.filter((offer) => offer.status === 'active');
    const bestOffer = activeOffers.length
      ? Math.max(...activeOffers.map((offer) => offer.amount))
      : null;
    await notifySellerUnsold(sale, vehicle, session, { bestOffer, offerCount: activeOffers.length });

    return sale;
  }

  const best = waitingList[0];
  sale.status = 'en_cours';
  sale.currentRank = 1;
  sale.winner = best.buyer;
  sale.winningOffer = best.offer;
  sale.amount = best.amount;
  const deadlineHours = await startPurchaseProcedure(sale);
  await sale.save();

  await notifyWinner(sale, vehicle, session, deadlineHours);
  await notifySellerAwarded(sale, vehicle, session);
  await notifyWaitingList(sale, vehicle, session);
  return sale;
};

/**
 * Désigner les gagnants de tous les véhicules d'une session clôturée.
 */
const processSessionAttributions = async (session) => {
  // year et photos alimentent la carte véhicule de l'e-mail envoyé au gagnant
  const vehicles = await VehicleDossier.find({ session: session._id, status: 'valide' })
    .select('brand model year photos seller reservePrice listingCount')
    .lean();

  const results = [];
  for (const vehicle of vehicles) {
    try {
      results.push(await attributeVehicle(vehicle, session));
    } catch (error) {
      console.error(`Attribution impossible pour le véhicule ${vehicle._id} : ${error.message}`);
    }
  }
  return results;
};

/**
 * Traiter les sessions clôturées dont les gagnants n'ont pas encore été désignés.
 * Rejouable sans risque : une session traitée est horodatée et n'est jamais reprise,
 * ce qui couvre aussi le cas d'un serveur arrêté au moment de la clôture.
 */
const processClosedSessions = async () => {
  const sessions = await Session.find({
    status: { $in: CLOSED_SESSION_STATUSES },
    attributionsProcessedAt: null,
  }).select('name startDate endDate status');

  for (const session of sessions) {
    try {
      await processSessionAttributions(session);
      session.attributionsProcessedAt = new Date();
      await session.save();
    } catch (error) {
      console.error(`Attribution impossible pour la session ${session._id} : ${error.message}`);
    }
  }
};

/**
 * Reprendre les e-mails d'attribution qui n'ont pas été acceptés par le SMTP lors du premier
 * passage. Cette routine est rejouable : chaque destinataire est horodaté après succès.
 */
const processPendingAttributionEmails = async () => {
  const sales = await Sale.find({ status: 'en_cours' })
    .populate('vehicle', 'brand model year photos')
    .populate('session', 'name');

  for (const sale of sales) {
    try {
      await notifyWaitingList(sale, sale.vehicle, sale.session || { name: '' });

      if (sale.currentRank > 1) {
        const current = sale.waitingList.find((entry) => entry.rank === sale.currentRank);
        if (current && (!current.promotionEmailSentAt || !current.sellerPromotionEmailSentAt)) {
          const startedAt = sale.currentStepStartedAt ? new Date(sale.currentStepStartedAt).getTime() : null;
          const dueAt = sale.currentStepDueAt ? new Date(sale.currentStepDueAt).getTime() : null;
          const deadlineHours = startedAt && dueAt ? Math.max(1, Math.round((dueAt - startedAt) / 3_600_000)) : 0;
          await notifyReattributedParties(sale, current, sale.vehicle, sale.session, deadlineHours);
        }
      }
    } catch (error) {
      console.error(`Reprise des e-mails d'attribution impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
};

/**
 * Écarter le gagnant courant et attribuer directement le véhicule au candidat suivant de la
 * liste d'attente, qui démarre aussitôt sa propre procédure d'achat (étape 1 : paiement de
 * la commission, avec le même délai que le tout premier gagnant). Il n'y a plus d'étape de
 * confirmation intermédiaire : le nouveau gagnant est informé par e-mail que son offre est
 * retenue suite au retrait du précédent, faute pour celui-ci d'avoir respecté les règles.
 */
const notifySellerReattributionExhausted = async (sale) => {
  try {
    const [seller, vehicle] = await Promise.all([
      User.findById(sale.seller).select('email firstName lastName language').lean(),
      VehicleDossier.findById(sale.vehicle).select('brand model year').lean(),
    ]);
    if (!seller?.email) return;
    const email = emailTemplates.saleReattributionExhaustedSellerEmail({ user: seller, vehicle });
    await sendEmail({ to: seller.email, ...email });
  } catch (error) {
    console.error(`Notification de retour en attente impossible (vente ${sale._id}) : ${error.message}`);
  }
};

const promoteNextBidder = async (saleId, reason = 'delai_depasse') => {
  const sale = await Sale.findById(saleId);
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est pas active.");
    err.codeName = 'sale.not_active';
    throw err;
  }

  const current = sale.waitingList.find((entry) => entry.rank === sale.currentRank);
  if (current) {
    current.status = 'ecarte';
    current.discardedAt = new Date();
    current.discardReason = reason;
  }

  let next = null;
  const candidates = sale.waitingList
    .filter((entry) => entry.rank > sale.currentRank && entry.rank <= 3 && entry.status !== 'ecarte')
    .sort((a, b) => a.rank - b.rank);

  for (const candidate of candidates) {
    const user = await User.findById(candidate.buyer).select('status').lean();
    if (user && user.status === 'suspendu') {
      candidate.status = 'ecarte';
      candidate.discardedAt = new Date();
      candidate.discardReason = 'compte_suspendu';
    } else {
      next = candidate;
      break;
    }
  }

  if (!next) {
    // Plus aucun candidat : le véhicule ne trouve pas preneur
    sale.status = 'sans_gagnant';
    sale.currentRank = 0;
    sale.winner = null;
    sale.winningOffer = null;
    sale.amount = null;
    await sale.save();
    // Comme à la clôture sans offre retenue, le véhicule redevient disponible
    await VehicleDossier.updateOne({ _id: sale.vehicle }, { $set: { session: null } });
    await notifySellerReattributionExhausted(sale);
    return sale;
  }

  next.status = 'gagnant';
  sale.currentRank = next.rank;
  sale.winner = next.buyer;
  sale.winningOffer = next.offer;
  sale.amount = next.amount;

  // Les traces de paiement appartiennent au gagnant écarté. Les conserver empêcherait le
  // nouveau gagnant de payer et pourrait permettre à une ancienne session Stripe encore en
  // attente d'être réconciliée sur cette nouvelle attribution.
  sale.commissionPaidAt = null;
  sale.documentsDelivery = null;
  sale.transferConfirmedAt = null;
  sale.commissionPayment = {
    provider: 'stripe',
    mode: null,
    checkoutSessionId: null,
    paymentIntentId: null,
    status: null,
    amount: null,
    currency: 'eur',
    initiatedAt: null,
  };
  const deadlineHours = await startPurchaseProcedure(sale);
  await sale.save();

  const [vehicle, session] = await Promise.all([
    VehicleDossier.findById(sale.vehicle).select('brand model year photos').lean(),
    Session.findById(sale.session).select('name').lean(),
  ]);
  await notifyReattributedParties(sale, next, vehicle, session, deadlineHours);

  return sale;
};

/**
 * Lorsqu'un acheteur est suspendu (délai dépassé, annulation, suspension admin...),
 * toutes ses autres ventes en cours à l'étape 1 lui sont retirées et attribuées
 * au candidat suivant.
 */
const revokeOngoingSalesForSuspendedBuyer = async (buyerId, reason = 'compte_suspendu', excludedSaleId = null) => {
  if (!buyerId) return;
  const ongoingSales = await Sale.find({
    winner: buyerId,
    status: 'en_cours',
    currentStep: 1,
    ...(excludedSaleId ? { _id: { $ne: excludedSaleId } } : {}),
  });

  for (const sale of ongoingSales) {
    try {
      await promoteNextBidder(sale._id, reason);
    } catch (err) {
      console.error(`Erreur réattribution de la vente ${sale._id} pour acheteur suspendu:`, err.message);
    }
  }
};

const serializeSale = (sale) => {
  const vehicle = sale.vehicle;
  const coverPhoto = vehicle && ((vehicle.photos || []).find((photo) => photo.isCover) || vehicle.photos?.[0]);

  return {
    id: String(sale._id),
    amount: sale.amount,
    status: sale.status,
    currentStep: sale.currentStep,
    stepKey: Sale.PURCHASE_STEPS[sale.currentStep - 1] || null,
    stepCount: Sale.PURCHASE_STEPS.length,
    steps: Sale.PURCHASE_STEPS,
    currentStepStartedAt: sale.currentStepStartedAt || null,
    currentStepDueAt: sale.currentStepDueAt || null,
    commissionPaidAt: sale.commissionPaidAt || null,
    documentsDelivery: sale.documentsDelivery || null,
    esignature: sale.esignature || null,
    certificate: {
      url: sale.certificate?.url || null,
      generatedAt: sale.certificate?.generatedAt || null,
      sellerSignedUrl: sale.certificate?.sellerSignedUrl || null,
      sellerSignedAt: sale.certificate?.sellerSignedAt || null,
      signedUrl: sale.certificate?.signedUrl || null,
      signedAt: sale.certificate?.signedAt || null,
      validatedAt: sale.certificate?.validatedAt || null,
      lastRejection: (sale.certificate?.rejections || []).at(-1) || null,
      rejectionCount: (sale.certificate?.rejections || []).length,
    },
    purchaseDeclaration: {
      url: sale.purchaseDeclaration?.url || null,
      generatedAt: sale.purchaseDeclaration?.generatedAt || null,
    },
    bonEnlevement: {
      url: sale.bonEnlevement?.url || null,
      generatedAt: sale.bonEnlevement?.generatedAt || null,
    },
    // L'acheteur détient le code : c'est lui qui le communique au vendeur à l'enlèvement
    handover: {
      declarationUrl: sale.handover?.declarationUrl || null,
      generatedAt: sale.handover?.generatedAt || null,
      otp: sale.handover?.otp || null,
      confirmedAt: sale.handover?.confirmedAt || null,
    },
    wonAt: sale.wonAt || null,
    closedAt: sale.closedAt || null,
    fees: sale.winningOffer?.fees || null,
    vehicle: vehicle ? {
      id: String(vehicle._id),
      brand: vehicle.brand || '',
      model: vehicle.model || '',
      year: vehicle.year ?? null,
      mileage: vehicle.mileage ?? null,
      registrationNumber: vehicle.registrationNumber || null,
      photoUrl: coverPhoto ? (coverPhoto.processedUrl || coverPhoto.originalUrl) : null,
    } : null,
    session: sale.session ? {
      id: String(sale.session._id),
      name: sale.session.name,
      endDate: sale.session.endDate,
    } : null,
    // Cahier des charges §6.5 : les coordonnées du vendeur ne sont débloquées
    // qu'une fois la commission plateforme réglée.
    seller: sale.commissionPaidAt && sale.seller && typeof sale.seller === 'object' ? {
      companyName: sale.seller.companyName || '',
      firstName: sale.seller.firstName || '',
      lastName: sale.seller.lastName || '',
      phone: sale.seller.phone || '',
      email: sale.seller.email || '',
      address: sale.seller.address || null,
      bankInfo: sale.seller.bankInfo ? {
        bankName: sale.seller.bankInfo.bankName || '',
        accountHolder: sale.seller.bankInfo.accountHolder || '',
        iban: sale.seller.bankInfo.iban || '',
        bic: sale.seller.bankInfo.bic || '',
      } : null,
    } : null,
  };
};

/**
 * Ventes remportées par un acheteur, séparées en procédures en cours et ventes clôturées.
 */
const listBuyerSales = async (buyerId) => {
  const sales = await Sale.find({ winner: buyerId, status: { $in: ['en_cours', 'cloturee'] } })
    .populate('vehicle', 'brand model year mileage registrationNumber photos')
    .populate('session', 'name endDate')
    .populate('winningOffer', 'fees')
    .sort({ wonAt: -1, createdAt: -1 })
    .lean();

  const serialized = sales.map(serializeSale);
  return {
    ongoing: serialized.filter((sale) => sale.status === 'en_cours'),
    closed: serialized.filter((sale) => sale.status === 'cloturee'),
  };
};

/**
 * Détail d'une vente remportée. Le filtre sur `winner` fait office de contrôle d'accès :
 * un acheteur ne peut jamais consulter la vente d'un autre.
 */
const getBuyerSale = async (saleId, buyerId) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, winner: buyerId })
    .populate('vehicle', 'brand model year mileage photos registrationNumber')
    .populate('session', 'name endDate')
    .populate('winningOffer', 'fees')
    .populate('seller', 'companyName firstName lastName phone email address bankInfo')
    .lean();

  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  return serializeSale(sale);
};

/**
 * Détail complet du véhicule lié à une vente remportée ou vendue.
 * Vérifie que l'utilisateur est soit l'acheteur (gagnant), soit le vendeur.
 */
const getSaleVehicle = async (saleId, userId) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({
    _id: saleId,
    $or: [{ winner: userId }, { seller: userId }]
  });

  if (!sale) {
    const err = new Error('Vente introuvable ou accès refusé.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const vehicle = await VehicleDossier.findById(sale.vehicle).lean();
  if (!vehicle) {
    const err = new Error('Véhicule introuvable.');
    err.codeName = 'vehicle.not_found';
    err.statusCode = 404;
    throw err;
  }

  const photos = (vehicle.photos || [])
    .map((photo) => ({
      id: String(photo._id || photo.id),
      url: photo.processedUrl || photo.originalUrl || photo.url,
      isCover: Boolean(photo.isCover),
      order: photo.order ?? 0,
      width: photo.width ?? null,
      height: photo.height ?? null,
    }))
    .filter((photo) => photo.url)
    .sort((a, b) => (Number(b.isCover) - Number(a.isCover)) || (a.order - b.order));

  return {
    ...vehicle,
    photos,
  };
};

const DOCUMENTS_DELIVERY_MODES = ['main_propre', 'poste'];

/**
 * Charger une vente sur laquelle l'acheteur peut encore régler la commission.
 * Sert de contrôle commun à l'ouverture du paiement et à sa confirmation.
 */
const loadSaleAwaitingCommission = async (saleId, buyerId) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, winner: buyerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 1) {
    const err = new Error('La commission de cette vente a déjà été réglée.');
    err.codeName = 'sale.step_already_done';
    throw err;
  }

  // Un compte suspendu ne peut pas démarrer une nouvelle vente (étape 1).
  // Les ventes déjà en cours à partir de l'étape 2 restent accessibles.
  const buyer = await User.findById(buyerId).select('status').lean();
  if (buyer && buyer.status === 'suspendu') {
    const err = new Error('Votre compte est suspendu. Réglez votre commission impayée pour débloquer votre compte.');
    err.codeName = 'auth.account_suspended';
    err.statusCode = 403;
    throw err;
  }

  return sale;
};

/**
 * Enregistrer un paiement de commission encaissé et faire passer la vente à l'étape 2
 * (virement au vendeur), avec le délai de virement de la configuration générale.
 * Idempotent : une vente déjà à l'étape 2 est renvoyée telle quelle.
 */
const settleCommissionPayment = async (sale, { paymentIntentId, amount, currency }) => {
  if (sale.currentStep !== 1) return sale;

  const { bankTransferDeadlineHours } = await generalConfigService.getConfig();
  sale.commissionPaidAt = new Date();
  sale.commissionPayment = {
    ...(sale.commissionPayment ? sale.commissionPayment.toObject?.() || sale.commissionPayment : {}),
    provider: 'stripe',
    status: 'paye',
    paymentIntentId: paymentIntentId || sale.commissionPayment?.paymentIntentId || null,
    amount: amount ?? sale.commissionPayment?.amount ?? null,
    currency: currency || sale.commissionPayment?.currency || 'eur',
  };
  enterStep(sale, 2, bankTransferDeadlineHours);
  await sale.save();

  try {
    const Payment = require('../models/payment.model');
    const frozenFees = sale.winningOffer?.fees || sale.fees;
    const amountInEuros = (amount ?? sale.commissionPayment?.amount)
      ? ((amount ?? sale.commissionPayment.amount) / 100)
      : (Number(frozenFees?.commission || 0) + Number(frozenFees?.taxAmount || 0));
    await Payment.create({
      user: sale.winner,
      sale: sale._id,
      type: 'paiement_commission',
      amount: amountInEuros,
      currency: currency || sale.commissionPayment?.currency || 'eur',
      stripeSessionId: sale.commissionPayment?.checkoutSessionId || null,
      stripePaymentIntentId: paymentIntentId || sale.commissionPayment?.paymentIntentId || null,
      status: 'paye',
      paidAt: new Date(),
    });
  } catch (err) {
    console.error('Erreur enregistrement Payment commission:', err.message);
  }

  // La commission encaissée confirme l'acheteur : le vendeur peut maintenant surveiller
  // son compte bancaire et valider le virement depuis la page de cette vente.
  try {
    const [saleContext, seller] = await Promise.all([
      Sale.findById(sale._id)
        .populate('vehicle', 'brand model year photos')
        .populate('session', 'name')
        .lean(),
      User.findById(sale.seller).select('email firstName lastName language').lean(),
    ]);
    if (seller) {
      const vehicle = saleContext?.vehicle;
      const email = emailTemplates.saleBuyerConfirmedSellerEmail({
        user: seller,
        brand: vehicle?.brand || '',
        model: vehicle?.model || '',
        year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle),
        sessionName: saleContext?.session?.name || '',
        saleId: String(sale._id),
      });
      await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
    }
  } catch (err) {
    console.error(`Impossible d'envoyer la confirmation de l'acheteur au vendeur (vente ${sale._id}) :`, err.message);
  }

  return sale;
};

/**
 * Relire auprès de Stripe le paiement en attente d'une vente, quel que soit le canal :
 * session Checkout ouverte depuis le web, ou PaymentIntent ouvert depuis l'application.
 */
const readPendingPayment = async (sale, checkoutSessionId) => {
  const payment = sale.commissionPayment || {};
  const sessionId = checkoutSessionId || payment.checkoutSessionId;

  if (payment.mode === 'payment_intent' && payment.paymentIntentId && !checkoutSessionId) {
    return paymentService.retrieveCommissionPaymentIntent(payment.paymentIntentId);
  }
  if (sessionId) {
    return paymentService.retrieveCommissionCheckout(sessionId);
  }
  if (payment.paymentIntentId) {
    return paymentService.retrieveCommissionPaymentIntent(payment.paymentIntentId);
  }

  const err = new Error('Aucun paiement en attente pour cette vente.');
  err.codeName = 'payment.not_started';
  throw err;
};

/**
 * Ouvrir le paiement de la commission depuis l'application mobile : la PaymentSheet de
 * Stripe consomme un PaymentIntent. Le mode de remise des papiers est enregistré dès
 * l'ouverture, mais la vente ne progresse qu'une fois le paiement réellement encaissé.
 */
const startCommissionPaymentIntent = async ({ saleId, buyerId, documentsDelivery }) => {
  if (!DOCUMENTS_DELIVERY_MODES.includes(documentsDelivery)) {
    const err = new Error('Choisissez comment récupérer les papiers du véhicule : en main propre ou par voie postale.');
    err.codeName = 'sale.invalid_documents_delivery';
    throw err;
  }

  const sale = await loadSaleAwaitingCommission(saleId, buyerId);
  if (sale.currentStepDueAt && new Date(sale.currentStepDueAt) <= new Date()) {
    const err = new Error('Le délai de paiement de la commission est dépassé.');
    err.codeName = 'sale.step_deadline_passed';
    throw err;
  }

  const [populated, buyer] = await Promise.all([
    Sale.findById(sale._id).populate('vehicle', 'brand model').populate('winningOffer', 'fees').lean(),
    User.findById(buyerId).select('email').lean(),
  ]);

  const vehicle = populated?.vehicle;
  const { intent, amount } = await paymentService.createCommissionPaymentIntent({
    sale: { _id: sale._id, fees: populated?.winningOffer?.fees },
    buyer: { _id: buyerId, email: buyer?.email },
    vehicleLabel: [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ') || 'Véhicule',
  });

  sale.documentsDelivery = documentsDelivery;
  sale.commissionPayment = {
    provider: 'stripe',
    mode: 'payment_intent',
    checkoutSessionId: null,
    paymentIntentId: intent.id,
    status: 'en_attente',
    amount,
    currency: 'eur',
    initiatedAt: new Date(),
  };
  await sale.save();

  return { clientSecret: intent.client_secret, amount };
};

/**
 * Ouvrir le paiement Stripe de la commission. Le mode de remise des papiers est enregistré
 * dès l'ouverture, mais la vente ne progresse qu'une fois le paiement réellement encaissé.
 */
const startCommissionPayment = async ({ saleId, buyerId, documentsDelivery, language }) => {
  if (!DOCUMENTS_DELIVERY_MODES.includes(documentsDelivery)) {
    const err = new Error('Choisissez comment récupérer les papiers du véhicule : en main propre ou par voie postale.');
    err.codeName = 'sale.invalid_documents_delivery';
    throw err;
  }

  const sale = await loadSaleAwaitingCommission(saleId, buyerId);
  // Le délai peut expirer entre l'affichage de la page et l'ouverture du paiement
  if (sale.currentStepDueAt && new Date(sale.currentStepDueAt) <= new Date()) {
    const err = new Error('Le délai de paiement de la commission est dépassé.');
    err.codeName = 'sale.step_deadline_passed';
    throw err;
  }

  const [populated, buyer] = await Promise.all([
    Sale.findById(sale._id).populate('vehicle', 'brand model').populate('winningOffer', 'fees').lean(),
    User.findById(buyerId).select('email').lean(),
  ]);

  const vehicle = populated?.vehicle;
  const { session, amount } = await paymentService.createCommissionCheckout({
    sale: { _id: sale._id, fees: populated?.winningOffer?.fees },
    buyer: { _id: buyerId, email: buyer?.email },
    vehicleLabel: [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ') || 'Véhicule',
    language,
  });

  sale.documentsDelivery = documentsDelivery;
  sale.commissionPayment = {
    provider: 'stripe',
    mode: 'checkout',
    checkoutSessionId: session.id,
    paymentIntentId: null,
    status: 'en_attente',
    amount,
    currency: 'eur',
    initiatedAt: new Date(),
  };
  await sale.save();

  return { clientSecret: session.client_secret, amount };
};

/**
 * Confirmer le paiement au retour de Stripe. La session est relue auprès de Stripe et
 * doit correspondre à cette vente et à cet acheteur : rien n'est cru sur parole.
 */
const confirmCommissionPayment = async ({ saleId, buyerId, checkoutSessionId }) => {
  const sale = await Sale.findOne({ _id: saleId, winner: buyerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  // Paiement déjà pris en compte (retour rejoué, ou réconciliation passée avant)
  if (sale.currentStep !== 1) return sale;

  const payment = await readPendingPayment(sale, checkoutSessionId);
  const matchesSale = payment.purpose === 'commission'
    && payment.saleId === String(sale._id)
    && payment.buyerId === String(buyerId);

  if (!matchesSale) {
    const err = new Error('Ce paiement ne correspond pas à cette vente.');
    err.codeName = 'payment.mismatch';
    err.statusCode = 403;
    throw err;
  }

  if (!payment.paid) {
    sale.commissionPayment.status = 'en_attente';
    await sale.save();
    const err = new Error("Le paiement de la commission n'a pas encore été confirmé par Stripe.");
    err.codeName = 'payment.not_completed';
    throw err;
  }

  return settleCommissionPayment(sale, {
    paymentIntentId: payment.paymentIntentId,
    amount: payment.amount,
    currency: payment.currency,
  });
};

/**
 * Rattraper les paiements encaissés dont le retour navigateur n'est jamais arrivé
 * (onglet fermé, coupure réseau). Relit les sessions Stripe encore en attente.
 */
const reconcilePendingCommissionPayments = async () => {
  if (!isStripeConfigured()) return;

  const sales = await Sale.find({
    status: 'en_cours',
    currentStep: 1,
    'commissionPayment.status': 'en_attente',
    $or: [
      { 'commissionPayment.checkoutSessionId': { $ne: null } },
      { 'commissionPayment.paymentIntentId': { $ne: null } },
    ],
  });

  for (const sale of sales) {
    try {
      const payment = await readPendingPayment(sale);
      if (payment.paid && payment.saleId === String(sale._id)) {
        await settleCommissionPayment(sale, {
          paymentIntentId: payment.paymentIntentId,
          amount: payment.amount,
          currency: payment.currency,
        });
        console.log(`Commission encaissée rattrapée pour la vente ${sale._id}.`);
      }
    } catch (error) {
      console.error(`Réconciliation du paiement impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
};

// Parts du délai écoulé déclenchant un rappel à l'acheteur
/**
 * Étapes dont l'avancement dépend d'une action du VENDEUR. Les autres attendent l'acheteur
 * ou la plateforme. Cette liste vit ici, à côté de PURCHASE_STEPS : l'interface ne doit pas
 * réinterpréter la sémantique des étapes.
 *
 *   virement            le vendeur confirme avoir reçu le virement
 *   validation_vendeur  le vendeur valide le certificat déposé par l'acheteur
 *   enlevement          le vendeur saisit le code remis par l'acheteur
 */
const SELLER_ACTION_STEPS = ['virement_carte_grise', 'signature_electronique', 'tampon_vendeur', 'validation_vendeur', 'enlevement'];

const REMINDER_THRESHOLDS = [50, 80];

/**
 * Envoyer un rappel ou l'information de retrait à l'acheteur concerné.
 * Les échecs d'envoi sont journalisés sans interrompre le traitement des autres ventes.
 */
const notifyBuyer = async (buyerId, build) => {
  try {
    const buyer = await User.findById(buyerId).select('email firstName lastName language');
    if (!buyer) return;
    const email = build(buyer);
    await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification de l'acheteur impossible : ${error.message}`);
  }
};

/**
 * Surveiller les échéances des étapes en cours :
 * - à 50 % puis 80 % du délai écoulé, l'acheteur reçoit un rappel ;
 * - à 100 %, il est écarté au profit du candidat suivant et en est informé par e-mail.
 * Les seuils déjà notifiés sont mémorisés sur la vente, donc jamais renvoyés.
 */
const processStepDeadlines = async () => {
  const now = new Date();
  const sales = await Sale.find({
    status: 'en_cours',
    currentStepDueAt: { $ne: null },
    timerPaused: { $ne: true }
  })
    .populate('vehicle', 'brand model year photos')
    .populate('session', 'name')
    .populate('winningOffer', 'fees');

  for (const sale of sales) {
    try {
      // Une autre vente expirée du même acheteur peut avoir réattribué celle-ci
      // depuis la lecture initiale du lot.
      const stillCurrent = await Sale.exists({
        _id: sale._id,
        status: 'en_cours',
        winner: sale.winner,
        currentStep: sale.currentStep,
        currentStepDueAt: sale.currentStepDueAt,
      });
      if (!stillCurrent) continue;
      const stepKey = Sale.PURCHASE_STEPS[sale.currentStep - 1];
      const vehicle = sale.vehicle;
      const sessionName = sale.session?.name || '';
      const dueAt = new Date(sale.currentStepDueAt);

      if (now >= dueAt) {
        const discardedBuyer = sale.winner;
        // Rang 1 : c'est le tout premier gagnant désigné à la clôture de la session. Un rang
        // supérieur signifie que ce gagnant a lui-même été promu après le retrait d'un
        // précédent — dans ce cas précis, ne pas payer la commission à temps ne suspend pas
        // son compte : on passe simplement au candidat suivant, sans pénalité.
        const isOriginalWinner = sale.currentRank === 1;
        const buyer = await User.findById(discardedBuyer);
        let suspended = false;

        if (buyer) {
          if (stepKey === 'commission' && isOriginalWinner) {
            // Étape 1 : le délai de paiement de la commission est dépassé pour le tout
            // premier gagnant. Il perd la vente, son compte est suspendu et il doit régler
            // la commission qu'il n'a pas payée pour débloquer son compte.
            if (!buyer.pendingCommission?.saleId) buyer.pendingCommission = {
              amount: getOfferCommissionTotal(sale.winningOffer),
              saleId: sale._id,
              reason: 'commission_impayee',
            };
            buyer.status = 'suspendu';
            await buyer.save();
            await revokeOngoingSalesForSuspendedBuyer(buyer._id, `${stepKey}_delai_depasse`, sale._id);
            suspended = true;
          } else if (stepKey === 'virement_carte_grise') {
            // Étape 2 : le délai de virement (paiement du véhicule) est dépassé.
            // L'acheteur perd la vente et son compte est suspendu.
            const { accountReactivationFee } = await generalConfigService.getConfig();
            if (!buyer.pendingCommission?.saleId) buyer.pendingCommission = {
              amount: accountReactivationFee,
              saleId: sale._id,
              reason: 'penalite_etape_2',
            };
            buyer.status = 'suspendu';
            await buyer.save();
            await revokeOngoingSalesForSuspendedBuyer(buyer._id, `${stepKey}_delai_depasse`, sale._id);
            suspended = true;
          }
        }

        await promoteNextBidder(sale._id, `${stepKey}_delai_depasse`);

        await notifyBuyer(discardedBuyer, (buyer) => emailTemplates.saleWinnerRemovedEmail({
          user: buyer,
          brand: vehicle?.brand || '',
          model: vehicle?.model || '',
          year: vehicle?.year || null,
          photoUrl: coverUrl(vehicle),
          sessionName,
          stepKey,
          suspended,
        }));
        continue;
      }

      const startedAt = new Date(sale.currentStepStartedAt || sale.wonAt || dueAt);
      const total = dueAt.getTime() - startedAt.getTime();
      if (total <= 0) continue;

      const elapsedPercent = ((now.getTime() - startedAt.getTime()) / total) * 100;
      const due = REMINDER_THRESHOLDS
        .filter((threshold) => elapsedPercent >= threshold && !sale.stepRemindersSent.includes(threshold));
      const adminAlertDue = stepKey === 'virement_carte_grise'
        && elapsedPercent >= 75 && !sale.stepRemindersSent.includes(75);
      if (due.length === 0 && !adminAlertDue) continue;

      // Un seul rappel par passage : le seuil le plus élevé atteint
      const remainingMs = dueAt.getTime() - now.getTime();
      if (due.length > 0) await notifyBuyer(sale.winner, (buyer) => emailTemplates.saleStepReminderEmail({
        user: buyer,
        brand: vehicle?.brand || '',
        model: vehicle?.model || '',
        year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle),
        sessionName,
        stepKey,
        saleId: String(sale._id),
        remainingMs,
      }));

      if (adminAlertDue) {
        try {
          const buyer = await User.findById(sale.winner);
          if (buyer) {
            await notificationService.createAdminLatePaymentNotification(sale, vehicle, buyer);
            
            const config = await generalConfigService.getConfig();
            const adminEmail = config?.adminEmail || 'contact@dealautopro.com';
            const vehicleLabel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Véhicule';
            const email = emailTemplates.adminLatePaymentAlertEmail({
              vehicleLabel,
              buyerName: `${buyer.firstName} ${buyer.lastName}`,
              buyerEmail: buyer.email,
              saleId: String(sale._id),
              remainingMs
            });
            await sendEmail({ to: adminEmail, subject: email.subject, text: email.text, html: email.html });
            sale.stepRemindersSent.push(75);
          }
        } catch (adminErr) {
          console.error(`Impossible de notifier l'admin du retard de paiement (vente ${sale._id}) :`, adminErr.message);
        }
      }

      sale.stepRemindersSent = [...sale.stepRemindersSent, ...due];
      await sale.save();
    } catch (error) {
      console.error(`Surveillance de l'échéance impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
};

const coverUrl = (vehicle) => {
  const photo = vehicle && ((vehicle.photos || []).find((item) => item.isCover) || vehicle.photos?.[0]);
  return photo ? (photo.processedUrl || photo.originalUrl) : null;
};

/**
 * Nombre d'offres actives et meilleur montant proposé, par couple véhicule/session,
 * en une seule agrégation. Le vendeur suit ainsi la meilleure enchère en cours face à
 * son prix de réserve ; l'identité des enchérisseurs, elle, reste couverte par le pli
 * fermé jusqu'à la clôture.
 */
const EMPTY_OFFER_STATS = { count: 0, bestOffer: null };

const offerStatsByListing = async (vehicleIds) => {
  if (vehicleIds.length === 0) return new Map();

  const rows = await Offer.aggregate([
    { $match: { vehicle: { $in: vehicleIds }, status: 'active' } },
    {
      $group: {
        _id: { vehicle: '$vehicle', session: '$session' },
        count: { $sum: 1 },
        bestOffer: { $max: '$amount' },
      },
    },
  ]);

  return new Map(rows.map((row) => [
    `${row._id.vehicle}:${row._id.session}`,
    { count: row.count, bestOffer: row.bestOffer ?? null },
  ]));
};

/**
 * Suivi commercial d'un vendeur, réparti en quatre états :
 * - inSession : véhicule publié, session encore ouverte aux offres
 * - ongoing   : gagnant désigné, procédure d'achat en cours
 * - closed    : vente menée à son terme
 * - unsold    : prix de réserve non atteint, véhicule à replacer
 */
/**
 * Le parcours d'un véhicule côté vendeur, en trois phases qui correspondent à trois postures
 * différentes — et donc à trois écrans.
 *
 *   PHASE 1 « depot »    le vendeur AGIT : compléter, corriger, attendre notre validation
 *   PHASE 2 « en_vente » le vendeur OBSERVE : le véhicule est validé, il suit son parcours
 *   PHASE 3 « vente »    un acheteur existe : c'est une vente, sur son propre écran
 *
 * Un véhicule occupe toujours exactement un état, déduit du dossier, de la session et de la
 * vente — jamais stocké, pour qu'aucune désynchronisation ne soit possible.
 */
const SELLER_PHASES = {
  depot: ['brouillon', 'en_validation', 'a_corriger', 'refuse'],
  en_vente: ['en_attente', 'programme', 'encheres_ouvertes'],
  vente: ['vente_en_cours', 'vendu', 'vente_annulee'],
};

const SELLER_VEHICLE_STATES = [...SELLER_PHASES.depot, ...SELLER_PHASES.en_vente, ...SELLER_PHASES.vente];

const phaseOfState = (state) => Object.keys(SELLER_PHASES).find((phase) => SELLER_PHASES[phase].includes(state)) || 'depot';

/**
 * Une ligne par véhicule, avec son état courant — et non une ligne par vente. Un véhicule
 * invendu puis republié possède plusieurs ventes ; seule la dernière décrit sa situation.
 */
const listSellerVehicles = async (sellerId) => {
  const [vehicles, sales] = await Promise.all([
    // Tous les dossiers, pas seulement les validés : la phase 1 vit précisément dans les
    // statuts amont (soumis, correction demandée, refusé).
    VehicleDossier.find({ seller: sellerId })
      .select('brand model registrationNumber photos listingCount reservePrice session lotNumber updatedAt status refusals')
      .sort({ updatedAt: -1 })
      .lean(),
    Sale.find({ seller: sellerId })
      .select('vehicle session status amount currentStep wonAt closedAt createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // La vente la plus récente de chaque véhicule fait foi
  const latestSaleByVehicle = new Map();
  for (const sale of sales) {
    const key = String(sale.vehicle);
    if (!latestSaleByVehicle.has(key)) latestSaleByVehicle.set(key, sale);
  }

  const sessionIds = vehicles.map((vehicle) => vehicle.session).filter(Boolean);
  const [sessions, offerStats] = await Promise.all([
    Session.find({ _id: { $in: sessionIds } }).select('name startDate endDate status').lean(),
    offerStatsByListing(vehicles.map((vehicle) => vehicle._id)),
  ]);
  const sessionsById = new Map(sessions.map((session) => [String(session._id), session]));

  const rows = vehicles.map((vehicle) => {
    const sale = latestSaleByVehicle.get(String(vehicle._id)) || null;
    const session = vehicle.session ? sessionsById.get(String(vehicle.session)) : null;

    // L'ordre compte. Une vente prime sur tout le reste — un véhicule attribué reste
    // rattaché à la session qui l'a vendu. Vient ensuite le statut du dossier, qui décide
    // si le véhicule est seulement vendable ; enfin l'état de sa session.
    let state;
    if (sale?.status === 'cloturee') state = 'vendu';
    else if (sale?.status === 'en_cours') state = 'vente_en_cours';
    else if (sale?.status === 'annulee') state = 'vente_annulee';
    else if (vehicle.status === 'brouillon') state = 'brouillon';
    else if (vehicle.status === 'soumis' || vehicle.status === 'en_attente_validation') state = 'en_validation';
    else if (vehicle.status === 'correction_demandee' || vehicle.status === 'a_corriger') state = 'a_corriger';
    else if (vehicle.status === 'refuse') state = 'refuse';
    else if (session && OPEN_SESSION_STATUSES.includes(session.status)) state = 'encheres_ouvertes';
    else if (session && session.status === 'upcoming') state = 'programme';
    else state = 'en_attente';

    // Motif du dernier renvoi : affiché tel quel au vendeur, il vaut mieux qu'un statut.
    const lastRefusal = (vehicle.refusals || []).slice(-1)[0] || null;

    const stats = vehicle.session
      ? (offerStats.get(`${vehicle._id}:${vehicle.session}`) || EMPTY_OFFER_STATS)
      : EMPTY_OFFER_STATS;

    return {
      id: String(vehicle._id),
      state,
      phase: phaseOfState(state),
      dossierStatus: vehicle.status,
      refusalReasons: lastRefusal ? (lastRefusal.motifsLabels || lastRefusal.motifs || []) : [],
      refusalComment: lastRefusal?.comment || null,
      lotNumber: vehicle.lotNumber ?? null,
      reservePrice: vehicle.reservePrice ?? null,
      // Affluence et meilleure enchère de la publication courante : le vendeur voit ainsi,
      // pendant la session, où en est le marché par rapport à son prix de réserve.
      offerCount: stats.count,
      bestOffer: stats.bestOffer,
      listingCount: vehicle.listingCount ?? 0,
      updatedAt: vehicle.updatedAt,
      vehicle: {
        id: String(vehicle._id),
        brand: vehicle.brand || '',
        model: vehicle.model || '',
        registrationNumber: vehicle.registrationNumber || null,
        photoUrl: coverUrl(vehicle),
      },
      session: session ? {
        id: String(session._id),
        name: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
        status: session.status,
      } : null,
      sale: sale ? {
        id: String(sale._id),
        status: sale.status,
        amount: sale.amount ?? null,
        currentStep: sale.status === 'en_cours' ? sale.currentStep : null,
        stepKey: sale.status === 'en_cours' ? (Sale.PURCHASE_STEPS[sale.currentStep - 1] || null) : null,
        stepCount: Sale.PURCHASE_STEPS.length,
        wonAt: sale.wonAt || null,
        closedAt: sale.closedAt || null,
      } : null,
    };
  });

  const counts = SELLER_VEHICLE_STATES.reduce((acc, state) => ({ ...acc, [state]: 0 }), {});
  const phaseCounts = { depot: 0, en_vente: 0, vente: 0 };
  for (const row of rows) {
    counts[row.state] += 1;
    phaseCounts[row.phase] += 1;
  }

  return { vehicles: rows, counts, phaseCounts, states: SELLER_VEHICLE_STATES, phases: SELLER_PHASES };
};

const listSellerSales = async (sellerId) => {
  const [sales, liveVehicles] = await Promise.all([
    Sale.find({ seller: sellerId })
      .populate('vehicle', 'brand model photos listingCount reservePrice registrationNumber')
      .populate('session', 'name endDate status')
      .sort({ createdAt: -1 })
      .lean(),
    // Véhicules encore rattachés à une session : leur vente n'existe pas avant la clôture
    VehicleDossier.find({ seller: sellerId, status: 'valide', session: { $ne: null } })
      .select('brand model photos listingCount reservePrice session registrationNumber')
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const liveSessions = await Session.find({
    _id: { $in: liveVehicles.map((vehicle) => vehicle.session) },
    status: { $in: OPEN_SESSION_STATUSES },
  }).select('name endDate status').lean();
  const liveSessionsById = new Map(liveSessions.map((session) => [String(session._id), session]));

  const offerStats = await offerStatsByListing([
    ...sales.map((sale) => sale.vehicle?._id).filter(Boolean),
    ...liveVehicles.map((vehicle) => vehicle._id),
  ]);
  const statsOn = (vehicleId, sessionId) => offerStats.get(`${vehicleId}:${sessionId}`) || EMPTY_OFFER_STATS;

  const inSession = liveVehicles
    .filter((vehicle) => liveSessionsById.has(String(vehicle.session)))
    .map((vehicle) => {
      const session = liveSessionsById.get(String(vehicle.session));
      const stats = statsOn(vehicle._id, vehicle.session);
      return {
        id: `listing-${vehicle._id}`,
        status: 'en_session',
        amount: null,
        reservePrice: vehicle.reservePrice ?? null,
        offerCount: stats.count,
        // Meilleure enchère en cours, à confronter au prix de réserve ci-dessus.
        bestOffer: stats.bestOffer,
        waitingCount: 0,
        currentStep: null,
        stepKey: null,
        stepCount: Sale.PURCHASE_STEPS.length,
        wonAt: null,
        closedAt: null,
        listingCount: vehicle.listingCount ?? 0,
        vehicle: {
          id: String(vehicle._id),
          brand: vehicle.brand || '',
          model: vehicle.model || '',
          registrationNumber: vehicle.registrationNumber || null,
          photoUrl: coverUrl(vehicle),
        },
        session: {
          id: String(session._id),
          name: session.name,
          endDate: session.endDate,
          status: session.status,
        },
      };
    });

  const serialized = sales.map((sale) => {
    const vehicle = sale.vehicle;
    return {
      id: String(sale._id),
      status: sale.status,
      amount: sale.amount,
      reservePrice: sale.reservePrice ?? null,
      offerCount: vehicle ? statsOn(vehicle._id, sale.session?._id).count : 0,
      waitingCount: (sale.waitingList || []).length,
      currentStep: sale.status === 'en_cours' ? sale.currentStep : null,
      currentStepDueAt: sale.status === 'en_cours' ? (sale.currentStepDueAt || null) : null,
      stepKey: sale.status === 'en_cours' ? (Sale.PURCHASE_STEPS[sale.currentStep - 1] || null) : null,
      stepCount: Sale.PURCHASE_STEPS.length,
      // Vrai quand la vente est bloquée en attente d'une action du vendeur : c'est ce qui
      // doit remonter en tête de son tableau de bord.
      awaitingSeller: sale.status === 'en_cours'
        && SELLER_ACTION_STEPS.includes(Sale.PURCHASE_STEPS[sale.currentStep - 1]),
      wonAt: sale.wonAt || null,
      closedAt: sale.closedAt || null,
      listingCount: vehicle?.listingCount ?? 0,
      vehicle: vehicle ? {
        id: String(vehicle._id),
        brand: vehicle.brand || '',
        model: vehicle.model || '',
        registrationNumber: vehicle.registrationNumber || null,
        photoUrl: coverUrl(vehicle),
      } : null,
      session: sale.session ? {
        id: String(sale.session._id),
        name: sale.session.name,
        endDate: sale.session.endDate,
        status: sale.session.status,
      } : null,
    };
  });

  return {
    inSession,
    ongoing: serialized.filter((sale) => sale.status === 'en_cours'),
    closed: serialized.filter((sale) => sale.status === 'cloturee'),
    unsold: serialized.filter((sale) => sale.status === 'sans_gagnant'),
  };
};

/**
 * Prévenir le vendeur que le certificat signé attend sa vérification.
 */
const notifySellerSignedCertificate = async (sale) => {
  try {
    const [seller, populated] = await Promise.all([
      User.findById(sale.seller).select('email firstName lastName language'),
      Sale.findById(sale._id).populate('vehicle', 'brand model year photos').populate('session', 'name').lean(),
    ]);
    if (!seller) return;

    const vehicle = populated?.vehicle;
    const email = emailTemplates.saleSignedCertificateSellerEmail({
      user: seller,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: populated?.session?.name || '',
      saleId: String(sale._id),
    });

    await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification du certificat signé impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Prévenir l'acheteur et l'administration qu'un certificat a été refusé.
 * Les envois sont indépendants : un échec sur l'un n'empêche pas les autres.
 */
const notifyCertificateRejected = async (sale, { reason, comment }) => {
  try {
    const [buyer, seller, config, populated] = await Promise.all([
      User.findById(sale.winner).select('email firstName lastName language companyName').lean(),
      User.findById(sale.seller).select('companyName firstName lastName').lean(),
      generalConfigService.getConfig(),
      Sale.findById(sale._id).populate('vehicle', 'brand model year photos').populate('session', 'name').lean(),
    ]);

    const vehicle = populated?.vehicle;
    const vehicleLabel = [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ') || 'Véhicule';
    const sessionName = populated?.session?.name || '';

    if (buyer) {
      const email = emailTemplates.saleCertificateRejectedBuyerEmail({
        user: buyer,
        brand: vehicle?.brand || '',
        model: vehicle?.model || '',
        year: vehicle?.year || null,
        photoUrl: coverUrl(vehicle),
        sessionName,
        saleId: String(sale._id),
        reason,
        comment,
      });
      await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html })
        .catch((error) => console.error(`Notification acheteur impossible : ${error.message}`));
    }

    const adminEmail = config?.adminEmail || 'contact@dealautopro.com';
    const email = emailTemplates.saleCertificateRejectedAdminEmail({
      user: { email: adminEmail, language: 'fr' },
      vehicleLabel,
      sessionName,
      sellerName: seller?.companyName || `${seller?.firstName || ''} ${seller?.lastName || ''}`.trim(),
      buyerName: buyer?.companyName || `${buyer?.firstName || ''} ${buyer?.lastName || ''}`.trim(),
      reason,
      comment,
    });
    await sendEmail({ to: adminEmail, subject: email.subject, text: email.text, html: email.html })
      .catch((error) => console.error(`Notification admin impossible : ${error.message}`));

    if (seller && buyer && vehicle) {
      await notificationService.createAdminCertificateRejectedNotification(sale, vehicle, buyer, seller)
        .catch((error) => console.error(`Création de notification in-app impossible : ${error.message}`));
    }
  } catch (error) {
    console.error(`Notification de refus impossible (vente ${sale._id}) : ${error.message}`);
  }
};


/**
 * Étape 4 : le vendeur refuse le certificat déposé. Le document écarté est archivé avec
 * son motif, et la vente revient à l'étape 3 pour que l'acheteur en redépose un conforme.
 */
const rejectSignedCertificate = async ({ saleId, sellerId, reason, comment }) => {
  if (!Sale.CERTIFICATE_REJECTION_REASONS.includes(reason)) {
    const err = new Error('Choisissez un motif de refus.');
    err.codeName = 'sale.invalid_rejection_reason';
    throw err;
  }
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 7) {
    const err = new Error("Cette vente n'est pas à l'étape de validation des documents.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }
  if (!sale.certificate?.signedUrl) {
    const err = new Error("Aucun certificat signé n'a été déposé par l'acheteur.");
    err.codeName = 'sale.certificate_missing';
    throw err;
  }

  const current = sale.certificate.toObject?.() || sale.certificate;
  const rejectionEntry = { url: current.signedUrl, rejectedBy: 'seller', reason, comment: comment || '', createdAt: new Date() };
  sale.certificate = {
    ...current,
    // Le document écarté est archivé avec son motif, puis retiré pour forcer un nouveau dépôt
    rejections: [
      ...(current.rejections || []),
      rejectionEntry,
    ],
    rejectionCount: (current.rejectionCount || 0) + 1,
    lastRejection: rejectionEntry,
    signedUrl: null,
    signedFilename: null,
    signedAt: null,
  };
  sale.esignature.buyerStampedUrl = null;
  sale.esignature.buyerStampedFilename = null;
  enterStep(sale, 6, null); // Retour au tampon acheteur pour un nouveau dépôt
  await sale.save();

  await notifyCertificateRejected(sale, { reason, comment });

  return sale;
};

// Nombre maximal de saisies d'OTP erronées avant blocage de la remise
const MAX_OTP_ATTEMPTS = 10;

/**
 * Charger, pour une vente, de quoi composer un e-mail : véhicule et session.
 */
const loadSaleContext = async (saleId) => Sale.findById(saleId)
  .populate('vehicle', 'brand model year photos')
  .populate('session', 'name')
  .lean();

/**
 * Prévenir l'acheteur que la remise peut avoir lieu. Le code de remise n'est
 * délibérément pas mis dans l'e-mail : une boîte compromise ne doit pas suffire
 * à déclencher la clôture de la vente.
 */
const notifyBuyerHandoverReady = async (sale) => {
  try {
    const [buyer, context] = await Promise.all([
      User.findById(sale.winner).select('email firstName lastName language'),
      loadSaleContext(sale._id),
    ]);
    if (!buyer) return;

    const vehicle = context?.vehicle;
    const email = emailTemplates.saleHandoverReadyBuyerEmail({
      user: buyer,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: context?.session?.name || '',
      saleId: String(sale._id),
    });

    await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification d'enlèvement impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Confirmer la clôture aux deux parties, chacune avec le lien vers son propre espace.
 */
const notifySaleClosed = async (sale) => {
  try {
    const [buyer, seller, context] = await Promise.all([
      User.findById(sale.winner).select('email firstName lastName language'),
      User.findById(sale.seller).select('email firstName lastName language'),
      loadSaleContext(sale._id),
    ]);

    const vehicle = context?.vehicle;
    const base = {
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      year: vehicle?.year || null,
      photoUrl: coverUrl(vehicle),
      sessionName: context?.session?.name || '',
      saleId: String(sale._id),
    };

    for (const [user, role] of [[buyer, 'acheteur'], [seller, 'vendeur']]) {
      if (!user) continue;
      const email = emailTemplates.saleClosedEmail({ user, role, ...base });
      await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html })
        .catch((error) => console.error(`Notification de clôture impossible (${role}) : ${error.message}`));
    }
  } catch (error) {
    console.error(`Notification de clôture impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/** Préparer l'étape 8 en générant uniquement le bon d'enlèvement. */
const prepareHandover = async (sale) => {
  const [vehicle, seller, buyer] = await Promise.all([
    VehicleDossier.findById(sale.vehicle)
      .select('brand model year mileage vin registrationNumber vehicleAddress vehicleAddressDetails')
      .lean(),
    User.findById(sale.seller).select('firstName lastName companyName siret address phone').lean(),
    User.findById(sale.winner).select('firstName lastName companyName siret address phone').lean(),
  ]);
  const bon = await generateBonEnlevement(sale, vehicle, seller, buyer);

  sale.handover = {
    ...(sale.handover?.toObject?.() || sale.handover || {}),
    generatedAt: new Date(),
    confirmedAt: null,
  };
  sale.bonEnlevement = {
    url: bon.url,
    filename: bon.filename,
    generatedAt: new Date(),
  };
};

/**
 * Étape 7 : le vendeur atteste
 * la remise du véhicule et clôture la vente.
 */
const confirmHandover = async ({ saleId, sellerId }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 8) {
    const err = new Error("Cette vente n'est pas à l'étape de l'enlèvement.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }

  sale.handover.confirmedAt = new Date();
  sale.status = 'cloturee';
  sale.closedAt = new Date();
  sale.currentStepDueAt = null;
  sale.stepRemindersSent = [];
  await sale.save();

  await notifySaleClosed(sale);

  return sale;
};

/**
 * Étape 4 : le vendeur atteste que le certificat déposé est bien signé et tamponné.
 * La vente passe alors à l'étape d'enlèvement.
 */
const validateSignedCertificate = async ({ saleId, sellerId }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 7) {
    const err = new Error("Cette vente n'est pas à l'étape de validation des documents.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }
  if (!sale.certificate?.signedUrl) {
    const err = new Error("Aucun certificat signé n'a été déposé par l'acheteur.");
    err.codeName = 'sale.certificate_missing';
    throw err;
  }

  sale.certificate = {
    ...(sale.certificate?.toObject?.() || sale.certificate || {}),
    validatedAt: new Date(),
  };

  // Le bon d'enlèvement doit exister avant d'ouvrir l'étape 8. En cas d'échec,
  // la vente reste à l'étape 7 afin que l'opération puisse être relancée proprement.
  await prepareHandover(sale);

  const closedAt = new Date();
  enterStep(sale, 8, null);
  sale.status = 'cloturee';
  sale.closedAt = closedAt;
  sale.currentStepDueAt = null;
  sale.stepRemindersSent = [];
  await sale.save();

  await notifySaleClosed(sale);

  return sale;
};

/**
 * Détail d'une vente vue par son vendeur. Le filtre sur `seller` fait office de contrôle
 * d'accès. L'identité de l'acheteur n'est révélée qu'une fois la commission réglée : elle
 * sert alors au vendeur à rapprocher le virement qu'il attend.
 */
const getSellerSale = async (saleId, sellerId) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId })
    .populate('vehicle', 'brand model year mileage photos listingCount registrationNumber registrationCardAvailable')
    .populate('session', 'name endDate')
    .populate('winner', 'companyName firstName lastName email phone address')
    .lean();

  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const vehicle = sale.vehicle;
  return {
    id: String(sale._id),
    status: sale.status,
    amount: sale.amount,
    reservePrice: sale.reservePrice ?? null,
    currentStep: sale.currentStep,
    stepKey: Sale.PURCHASE_STEPS[sale.currentStep - 1] || null,
    stepCount: Sale.PURCHASE_STEPS.length,
    steps: Sale.PURCHASE_STEPS,
    currentStepStartedAt: sale.currentStepStartedAt || null,
    currentStepDueAt: sale.currentStepDueAt || null,
    commissionPaidAt: sale.commissionPaidAt || null,
    documentsDelivery: sale.documentsDelivery || null,
    transferConfirmedAt: sale.transferConfirmedAt || null,
    esignature: sale.esignature || null,
    certificate: {
      url: sale.certificate?.url || null,
      generatedAt: sale.certificate?.generatedAt || null,
      signedUrl: sale.certificate?.signedUrl || null,
      signedAt: sale.certificate?.signedAt || null,
      validatedAt: sale.certificate?.validatedAt || null,
      lastRejection: (sale.certificate?.rejections || []).at(-1) || null,
      rejectionCount: (sale.certificate?.rejections || []).length,
    },
    purchaseDeclaration: {
      url: sale.purchaseDeclaration?.url || null,
      generatedAt: sale.purchaseDeclaration?.generatedAt || null,
    },
    bonEnlevement: {
      url: sale.bonEnlevement?.url || null,
      generatedAt: sale.bonEnlevement?.generatedAt || null,
    },
    // L'OTP n'est jamais transmis au vendeur : il doit le tenir de l'acheteur.
    // La déclaration ne lui est ouverte qu'une fois la remise confirmée.
    handover: {
      declarationUrl: sale.handover?.confirmedAt ? (sale.handover?.declarationUrl || null) : null,
      confirmedAt: sale.handover?.confirmedAt || null,
      otpAttempts: sale.handover?.otpAttempts || 0,
    },
    waitingCount: (sale.waitingList || []).length,
    wonAt: sale.wonAt || null,
    closedAt: sale.closedAt || null,
    vehicle: vehicle ? {
      id: String(vehicle._id),
      brand: vehicle.brand || '',
      model: vehicle.model || '',
      year: vehicle.year ?? null,
      mileage: vehicle.mileage ?? null,
      registrationNumber: vehicle.registrationNumber || null,
      registrationCardAvailable: vehicle.registrationCardAvailable ?? true,
      photoUrl: coverUrl(vehicle),
    } : null,
    session: sale.session ? {
      id: String(sale.session._id),
      name: sale.session.name,
      endDate: sale.session.endDate,
    } : null,
    buyer: sale.commissionPaidAt && sale.winner && typeof sale.winner === 'object' ? {
      companyName: sale.winner.companyName || '',
      firstName: sale.winner.firstName || '',
      lastName: sale.winner.lastName || '',
      email: sale.winner.email || '',
      phone: sale.winner.phone || '',
      address: sale.winner.address || null,
    } : null,
  };
};

/**
 * Générer le certificat de cession pré-rempli et l'attacher à la vente.
 * Les cachets déjà enregistrés par le vendeur et l'acheteur sont apposés pendant
 * la génération. Les signatures restent gérées par le parcours de signature.
 */
const generateCertificate = async (sale) => {
  const [vehicle, seller, buyer] = await Promise.all([
    VehicleDossier.findById(sale.vehicle)
      .select('brand model year mileage vin registrationNumber firstRegistrationDate vehicleGenre engine registrationCardAvailable formulaNumber registrationCardMissingMotif')
      .lean(),
    User.findById(sale.seller).select('firstName lastName email companyName siret address stampUrl language').lean(),
    User.findById(sale.winner).select('firstName lastName email companyName siret address stampUrl language').lean(),
  ]);

  const pdf = await fillCertificateOfTransfer({
    vehicle,
    seller: { ...seller, stampUrl: null },
    buyer: { ...buyer, stampUrl: null },
    transferredAt: sale.transferConfirmedAt || new Date(),
  });

  const filename = `ventes/certificats/${sale._id}_certificat-cession.pdf`;
  const stored = await saveBuffer({ buffer: pdf, filename, contentType: 'application/pdf' });

  sale.certificate = {
    ...(sale.certificate?.toObject?.() || sale.certificate || {}),
    url: stored.url,
    filename: stored.filename,
    generatedAt: new Date(),
  };

  return { vehicle, buyer, seller, buffer: pdf };
};

/**
 * Prévenir l'utilisateur (vendeur ou acheteur) que le document est prêt à être signé via OpenAPI
 */
const notifySignatureReady = async (user, signatureUrl, vehicle) => {
  try {
    const email = emailTemplates.signatureReadyEmail({
      user,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      signatureUrl,
    });
    await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification de signature OpenAPI impossible pour ${user.email} : ${error.message}`);
  }
};

/** Notifier la personne qui doit agir juste après la fin de la signature électronique. */
const notifyPostSignatureAction = async (sale, sellerStampApplied) => {
  try {
    const [seller, buyer, vehicle, session] = await Promise.all([
      User.findById(sale.seller).select('email firstName lastName language').lean(),
      User.findById(sale.winner).select('email firstName lastName language').lean(),
      VehicleDossier.findById(sale.vehicle).select('brand model').lean(),
      Session.findById(sale.session).select('name').lean(),
    ]);
    const common = {
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      sessionName: session?.name || '',
      saleId: String(sale._id),
    };

    if (sellerStampApplied && buyer) {
      const email = emailTemplates.buyerSellerStampValidationEmail({ user: buyer, ...common });
      await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html });
    } else if (!sellerStampApplied && seller) {
      const email = emailTemplates.sellerStampRequiredEmail({ user: seller, ...common });
      await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
    }
  } catch (error) {
    // La signature et le changement d'étape restent acquis même si le service mail est indisponible.
    console.error(`Notification post-signature impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Étape 2 : le virement est réalisé de banque à banque, hors plateforme. Seul le vendeur
 * peut attester l'avoir reçu ; sa confirmation ouvre l'état intermédiaire 2,5.
 */
const confirmTransferReceived = async ({ saleId, sellerId }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 2) {
    const err = new Error("Cette vente n'est pas à l'étape du virement.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }

  // État intermédiaire 2,5 : le virement est confirmé, mais la vente reste à l'étape 2
  // tant que les données carte grise n'ont pas été collectées et les documents générés.
  if (!sale.transferConfirmedAt) {
    sale.transferConfirmedAt = new Date();
    await sale.save();
  }
  return sale;
};


const generatePurchaseDeclarationDoc = async (sale, vehicle, seller, buyer) => {
  const pdf = await fillPurchaseDeclaration({
    vehicle,
    seller: { ...seller, stampUrl: null },
    buyer: { ...buyer, stampUrl: null },
    purchasedAt: sale.transferConfirmedAt || new Date(),
  });

  const filename = `ventes/declarations/${sale._id}_declaration-achat.pdf`;
  const stored = await saveBuffer({ buffer: pdf, filename, contentType: 'application/pdf' });

  sale.purchaseDeclaration = {
    ...(sale.purchaseDeclaration?.toObject?.() || sale.purchaseDeclaration || {}),
    url: stored.url,
    filename: stored.filename,
    generatedAt: new Date(),
  };

  return { buffer: pdf, ...stored };
};

const processRegistrationCard = async ({ saleId, sellerId, formulaNumber, registrationCardMissingMotif }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours' || sale.currentStep !== 2) {
    const err = new Error("Cette vente n'est plus à l'étape du virement.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }
  if (!sale.transferConfirmedAt) {
    const err = new Error("La réception du virement doit être confirmée avant le traitement de la carte grise.");
    err.codeName = 'sale.transfer_not_confirmed';
    err.statusCode = 400;
    throw err;
  }

  const vehicle = await VehicleDossier.findById(sale.vehicle).select('registrationCardAvailable');
  if (!vehicle) {
    const err = new Error('Dossier du véhicule introuvable.');
    err.codeName = 'vehicle_dossier.not_found';
    err.statusCode = 404;
    throw err;
  }

  const rawFormulaNumber = typeof formulaNumber === 'string' ? formulaNumber.trim() : '';
  // Le modal affiche déjà le préfixe « 20 ». Accepte aussi les anciens clients qui
  // n'envoient que la suite et persiste toujours le numéro complet dans le dossier.
  const normalizedFormulaNumber = rawFormulaNumber && !rawFormulaNumber.startsWith('20')
    ? `20${rawFormulaNumber}`
    : rawFormulaNumber;
  const normalizedMissingMotif = typeof registrationCardMissingMotif === 'string'
    ? registrationCardMissingMotif.trim()
    : '';

  if (vehicle.registrationCardAvailable === true && !normalizedFormulaNumber) {
    const err = new Error('Le numéro de formule de la carte grise est obligatoire.');
    err.codeName = 'sale.formula_number_required';
    err.statusCode = 400;
    throw err;
  }
  if (vehicle.registrationCardAvailable === false && !normalizedMissingMotif) {
    const err = new Error("Le motif d'absence de carte grise est obligatoire.");
    err.codeName = 'sale.registration_card_missing_motif_required';
    err.statusCode = 400;
    throw err;
  }
  if (vehicle.registrationCardAvailable == null) {
    const err = new Error("La disponibilité de la carte grise n'est pas renseignée dans le dossier du véhicule.");
    err.codeName = 'sale.registration_card_status_required';
    err.statusCode = 400;
    throw err;
  }

  const registrationCardUpdate = vehicle.registrationCardAvailable === true
    ? { $set: { formulaNumber: normalizedFormulaNumber }, $unset: { registrationCardMissingMotif: 1 } }
    : { $set: { registrationCardMissingMotif: normalizedMissingMotif }, $unset: { formulaNumber: 1 } };
  await VehicleDossier.updateOne({ _id: sale.vehicle }, registrationCardUpdate);

  // Le certificat est produit à cet instant précis : il porte la date de cession attestée.
  let generatedCert = null;
  let generatedDecl = null;
  try {
    generatedCert = await generateCertificate(sale);
    generatedDecl = await generatePurchaseDeclarationDoc(sale, generatedCert.vehicle, generatedCert.seller, generatedCert.buyer);
  } catch (error) {
    console.error(`Génération des documents impossible (vente ${sale._id}) : ${error.message}`);
  }

  if (!generatedCert || !generatedDecl) {
    const err = new Error('La génération des documents a échoué. Vous pouvez relancer le traitement.');
    err.codeName = 'sale.certificate_generation_failed';
    err.statusCode = 500;
    throw err;
  }

  // Création de la session de signature sur OpenAPI
  try {
    const signatureSession = await createSignatureSession({
      saleId: sale._id.toString(),
      seller: generatedCert.seller,
      buyer: generatedCert.buyer,
      certificateBuffer: generatedCert.buffer,
      purchaseDeclarationBuffer: generatedDecl.buffer
    });

    // Trouver les URLs de signature pour chaque signataire
    const sellerSigner = signatureSession.signers?.find(s => s.email === generatedCert.seller.email);
    const buyerSigner = signatureSession.signers?.find(s => s.email === generatedCert.buyer.email);

    sale.esignature = {
      operationId: signatureSession.id,
      status: signatureSession.state || 'WAIT_VALIDATION',
      sellerUrl: sellerSigner ? sellerSigner.url : null,
      buyerUrl: buyerSigner ? buyerSigner.url : null,
      initiatedAt: new Date(),
    };

    // On passe à l'étape 3 (attente de signature)
    enterStep(sale, 3, null);
    await sale.save();

    // Notifier le vendeur et l'acheteur
    if (sellerSigner && sellerSigner.url) {
      await notifySignatureReady(generatedCert.seller, sellerSigner.url, generatedCert.vehicle);
    }
    if (buyerSigner && buyerSigner.url) {
      await notifySignatureReady(generatedCert.buyer, buyerSigner.url, generatedCert.vehicle);
    }

  } catch (error) {
    console.error(`Création de la session de signature échouée (vente ${sale._id}) : ${error.message}`);
    const err = new Error('L\'intégration avec le service de signature a échoué.');
    err.codeName = 'sale.esignature_failed';
    err.statusCode = 500;
    throw err;
  }

  return sale;
};

/**
 * Étape 3 : le vendeur redépose le certificat signé et tamponné. La vente passe alors
 * à l'acheteur pour qu'il fasse de même.
 */
const submitSellerCertificate = async ({ saleId, sellerId, url, filename }) => {
  if (!url || typeof url !== 'string') {
    const err = new Error('Le certificat du vendeur est manquant.');
    err.codeName = 'sale.certificate_missing';
    throw err;
  }
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, seller: sellerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 4) {
    const err = new Error("Cette vente n'est pas en attente du certificat vendeur.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }

  sale.certificate.sellerSignedUrl = url;
  sale.certificate.sellerSignedFilename = filename;
  sale.certificate.sellerSignedAt = new Date();
  sale.esignature.sellerStampedUrl = url;
  sale.esignature.sellerStampedFilename = filename || null;
  if (sale.certificate.lastRejection?.rejectedBy === 'buyer') {
    sale.certificate.lastRejection = null;
  }

  // Le dossier tamponné par le vendeur passe obligatoirement par la validation de l'acheteur.
  enterStep(sale, 5, null);
  await sale.save();
  
  // Le dossier vendeur est prêt : l'acheteur doit maintenant le valider.
  await notifyPostSignatureAction(sale, true);

  return sale;
};

/**
 * Étape 4 : l'acheteur redépose le certificat signé et tamponné. La vente passe alors
 * à la validation des documents par le vendeur (Étape 5).
 */

/**
 * Étape 4 : l'acheteur valide le certificat du vendeur.
 * S'il a un tampon automatique, le document est tamponné et la vente passe à l'étape 6.
 * Sinon, la vente passe à l'étape 5 pour signature manuelle.
 */
const validateSellerCertificate = async ({ saleId, buyerId }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.'); err.codeName = 'sale.not_found'; err.statusCode = 404; throw err;
  }
  const sale = await Sale.findOne({ _id: saleId, winner: buyerId });
  if (!sale) {
    const err = new Error('Vente introuvable.'); err.codeName = 'sale.not_found'; err.statusCode = 404; throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours."); err.codeName = 'sale.not_ongoing'; throw err;
  }
  if (sale.currentStep !== 5) {
    const err = new Error("Cette vente n'est pas à l'étape de validation du certificat vendeur."); err.codeName = 'sale.step_mismatch'; throw err;
  }

  sale.certificate = {
    ...(sale.certificate?.toObject?.() || sale.certificate || {}),
    buyerValidatedAt: new Date(),
    ...(sale.certificate?.lastRejection?.rejectedBy === 'buyer' ? { lastRejection: null } : {}),
  };

  const buyer = await User.findById(buyerId).select('stampUrl').lean();
  if (buyer?.stampUrl) {
    const sourceUrl = sale.esignature?.sellerStampedUrl || sale.certificate.sellerSignedUrl;
    const stampedPdf = await stampSignedBundle({ sourceUrl, stampUrl: buyer.stampUrl, role: 'buyer' });
    const stored = await saveBuffer({
      buffer: stampedPdf,
      filename: `ventes/documents/${sale._id}/dossier-signe-tampons-vendeur-acheteur.pdf`,
      contentType: 'application/pdf',
    });
    sale.esignature.buyerStampedUrl = stored.url;
    sale.esignature.buyerStampedFilename = stored.filename;
    sale.certificate.signedUrl = stored.url;
    sale.certificate.signedFilename = stored.filename;
    sale.certificate.signedAt = new Date();
    
    enterStep(sale, 7, null);
    await sale.save();
    
    await notifySellerSignedCertificate(sale);
  } else {
    enterStep(sale, 6, null);
    await sale.save();
  }

  return sale;
};

/**
 * Étape 4 : l'acheteur refuse le certificat du vendeur. La vente retourne à l'étape 3.
 */
const rejectSellerCertificate = async ({ saleId, buyerId, reason, comment }) => {
  if (!Sale.CERTIFICATE_REJECTION_REASONS.includes(reason)) {
    const err = new Error('Choisissez un motif de refus.'); err.codeName = 'sale.invalid_rejection_reason'; throw err;
  }
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.'); err.codeName = 'sale.not_found'; err.statusCode = 404; throw err;
  }
  const sale = await Sale.findOne({ _id: saleId, winner: buyerId });
  if (!sale) {
    const err = new Error('Vente introuvable.'); err.codeName = 'sale.not_found'; err.statusCode = 404; throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours."); err.codeName = 'sale.not_ongoing'; throw err;
  }
  if (sale.currentStep !== 5) {
    const err = new Error("Cette vente n'est pas à l'étape de validation du certificat vendeur."); err.codeName = 'sale.step_mismatch'; throw err;
  }

  const current = sale.certificate.toObject?.() || sale.certificate;
  const rejectionEntry = { url: current.sellerSignedUrl, rejectedBy: 'buyer', reason, comment: comment || '', createdAt: new Date() };

  // Mettre à jour l'historique et réinitialiser les signatures vendeur
  sale.certificate.rejections = [
    ...(sale.certificate.rejections || []),
    rejectionEntry,
  ];
  sale.certificate.rejectionCount = (sale.certificate.rejectionCount || 0) + 1;
  sale.certificate.lastRejection = rejectionEntry;
  sale.certificate.sellerSignedUrl = null;
  sale.certificate.sellerSignedFilename = null;
  sale.certificate.sellerSignedAt = null;
  sale.certificate.buyerValidatedAt = null;
  sale.esignature.sellerStampedUrl = null;
  sale.esignature.sellerStampedFilename = null;
  sale.esignature.buyerStampedUrl = null;
  sale.esignature.buyerStampedFilename = null;

  enterStep(sale, 4, null); // Retour au tampon vendeur
  await sale.save();

  // On notifie le vendeur
  await notifyCertificateRejected(sale, { reason, comment });

  return sale;
};

const submitSignedCertificate = async ({ saleId, buyerId, url, filename }) => {
  if (!url || typeof url !== 'string') {
    const err = new Error('Le certificat signé est manquant.');
    err.codeName = 'sale.certificate_missing';
    throw err;
  }
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, winner: buyerId });
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    throw err;
  }
  if (sale.currentStep !== 6) {
    const err = new Error("Cette vente n'est pas à l'étape du certificat de cession.");
    err.codeName = 'sale.step_mismatch';
    throw err;
  }

  sale.certificate = {
    ...(sale.certificate?.toObject?.() || sale.certificate || {}),
    signedUrl: url,
    signedFilename: filename || null,
    signedAt: new Date(),
    ...(sale.certificate?.lastRejection?.rejectedBy === 'seller' ? { lastRejection: null } : {}),
  };
  sale.esignature.buyerStampedUrl = url;
  sale.esignature.buyerStampedFilename = filename || null;
  // Le vendeur doit maintenant vérifier les documents déposés
  enterStep(sale, 7, null);
  await sale.save();

  await notifySellerSignedCertificate(sale);

  return sale;
};

/**
 * Annulation de l'achat par l'acheteur à l'étape 1.
 * La vente est annulée (et potentiellement réattribuée), et l'acheteur
 * se voit attribuer la commission qu'il devait régler, suspendant immédiatement son compte.
 */
const cancelSaleByBuyer = async ({ saleId, buyerId }) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const sale = await Sale.findOne({ _id: saleId, winner: buyerId }).populate('winningOffer', 'fees');
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  if (sale.status !== 'en_cours' || sale.currentStep !== 1) {
    const err = new Error("L'annulation n'est possible qu'à l'étape 1.");
    err.codeName = 'sale.cancel_not_allowed';
    throw err;
  }

  const buyer = await User.findById(buyerId);
  if (!buyer) {
    const err = new Error("Acheteur introuvable.");
    err.statusCode = 404;
    throw err;
  }

  buyer.pendingCommission = {
    amount: getOfferCommissionTotal(sale.winningOffer),
    saleId: sale._id,
    reason: 'commission_impayee',
  };
  buyer.status = 'suspendu';
  await buyer.save();

  // On passe la vente courante et toutes les autres ventes en cours à l'étape 1 ou 2 au candidat suivant
  await promoteNextBidder(sale._id, 'annulation_volontaire');
  await revokeOngoingSalesForSuspendedBuyer(buyer._id, 'annulation_volontaire');

  return sale;
};

/**
 * Repousse l'échéance de l'étape courante d'un nombre d'heures donné.
 *
 * Réservé aux deux premières étapes — paiement de la commission et virement — les seules
 * dont le dépassement écarte automatiquement l'acheteur. Les suivantes attendent une action
 * du vendeur ou de la plateforme et n'ont pas de couperet à repousser.
 *
 * Les rappels déjà envoyés restent marqués : allonger le délai ne doit pas déclencher une
 * seconde salve d'e-mails pour des seuils déjà franchis.
 */
const EXTENDABLE_STEPS = [1, 2];
const MAX_EXTENSION_HOURS = 720; // 30 jours : au-delà, c'est une décision, pas un ajustement

const extendCurrentStepDeadline = async (saleId, hours) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }

  const added = Number(hours);
  if (!Number.isFinite(added) || added <= 0 || added > MAX_EXTENSION_HOURS) {
    const err = new Error(`La prolongation doit être comprise entre 1 et ${MAX_EXTENSION_HOURS} heures.`);
    err.codeName = 'sale.invalid_extension';
    err.statusCode = 400;
    throw err;
  }

  const sale = await Sale.findById(saleId);
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }
  if (sale.status !== 'en_cours') {
    const err = new Error("Cette vente n'est plus en cours.");
    err.codeName = 'sale.not_ongoing';
    err.statusCode = 409;
    throw err;
  }
  if (!EXTENDABLE_STEPS.includes(sale.currentStep)) {
    const err = new Error("Seules les étapes 1 (commission) et 2 (virement) ont un délai prolongeable.");
    err.codeName = 'sale.step_not_extendable';
    err.statusCode = 409;
    throw err;
  }

  // Une échéance déjà dépassée repart de maintenant : la prolonger depuis le passé
  // laisserait l'acheteur avec un délai déjà consommé.
  const base = sale.currentStepDueAt && sale.currentStepDueAt > new Date()
    ? new Date(sale.currentStepDueAt)
    : new Date();

  sale.currentStepDueAt = new Date(base.getTime() + added * 3600 * 1000);
  await sale.save();

  return sale;
};

const toggleSaleTimer = async (saleId, pause) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }
  const sale = await Sale.findById(saleId);
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }

  if (pause && !sale.timerPaused) {
    sale.timerPaused = true;
    sale.timerPausedAt = new Date();
  } else if (!pause && sale.timerPaused) {
    sale.timerPaused = false;
    if (sale.currentStepDueAt && sale.timerPausedAt) {
      const pausedDuration = new Date().getTime() - sale.timerPausedAt.getTime();
      sale.currentStepDueAt = new Date(sale.currentStepDueAt.getTime() + pausedDuration);
    }
    sale.timerPausedAt = null;
  }

  await sale.save();
  return sale;
};

const forceEndSale = async (saleId, suspendBuyer, suspendSeller, promoteNext) => {
  if (!mongoose.isValidObjectId(saleId)) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }
  const sale = await Sale.findById(saleId);
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.statusCode = 404;
    throw err;
  }

  if (suspendBuyer && sale.winner) {
    const buyer = await User.findById(sale.winner);
    if (buyer) {
      buyer.status = 'suspendu';
      await buyer.save();
      await revokeOngoingSalesForSuspendedBuyer(buyer._id, 'suspension_admin');
    }
  }

  if (suspendSeller && sale.seller) {
    const seller = await User.findById(sale.seller);
    if (seller) {
      seller.status = 'suspendu';
      await seller.save();
    }
  }

  if (promoteNext) {
    await promoteNextBidder(sale._id, 'annulation_forcee_admin');
  } else {
    sale.status = 'annulee';
    await sale.save();
  }

  return Sale.findById(saleId);
};

/**
 * Récupère le document signé depuis OpenAPI et fait avancer la vente à l'étape 7
 */
const finalizeSignature = async (saleId, signatureId) => {
  const sale = await Sale.findById(saleId);
  if (!sale) {
    throw new Error('Vente introuvable.');
  }

  // Vérifier qu'on est bien à l'étape où on attend la signature
  if (sale.currentStep !== 3) {
    console.warn(`La vente ${saleId} n'est pas à l'étape 3. Ignoré.`);
    return sale;
  }
  if (!sale.esignature?.operationId || String(sale.esignature.operationId) !== String(signatureId)) {
    const error = new Error('La signature reçue ne correspond pas à cette vente.');
    error.codeName = 'sale.esignature_mismatch';
    error.statusCode = 403;
    throw error;
  }

  try {
    // 1. Récupérer le document signé d'OpenAPI (Buffer)
    const signedPdfBuffer = await fetchSignedDocument(signatureId);

    // 2. Sauvegarder dans notre espace de stockage
    const filename = `ventes/documents/${saleId}/documents_signes_${Date.now()}.pdf`;
    const stored = await saveBuffer({
      buffer: signedPdfBuffer,
      filename,
      contentType: 'application/pdf',
    });
    const finalUrl = stored.url;

    let auditStored = null;
    try {
      const auditBuffer = await fetchAuditTrail(signatureId);
      auditStored = await saveBuffer({
        buffer: auditBuffer,
        filename: `ventes/documents/${saleId}/audit-signature.pdf`,
        contentType: 'application/pdf',
      });
    } catch (auditError) {
      console.error(`Archivage de la piste d'audit impossible (vente ${saleId}) : ${auditError.message}`);
    }

    // 3. Mettre à jour l'objet Sale
    sale.esignature = {
      ...(sale.esignature?.toObject?.() || sale.esignature || {}),
      status: 'DONE',
      signedDocumentUrl: finalUrl,
      signedDocumentFilename: stored.filename,
      auditUrl: auditStored?.url || null,
      auditFilename: auditStored?.filename || null,
      completedAt: new Date(),
    };

    // L'original OpenAPI reste archivé sans modification. L'étape 4 travaille sur une copie.
    const seller = await User.findById(sale.seller).select('stampUrl').lean();
    if (seller?.stampUrl) {
      const sellerStampedPdf = await stampSignedBundle({
        sourceBuffer: signedPdfBuffer,
        stampUrl: seller.stampUrl,
        role: 'seller',
      });
      const sellerStamped = await saveBuffer({
        buffer: sellerStampedPdf,
        filename: `ventes/documents/${saleId}/dossier-signe-tampon-vendeur.pdf`,
        contentType: 'application/pdf',
      });
      sale.esignature.sellerStampedUrl = sellerStamped.url;
      sale.esignature.sellerStampedFilename = sellerStamped.filename;
      sale.certificate.sellerSignedUrl = sellerStamped.url;
      sale.certificate.sellerSignedFilename = sellerStamped.filename;
      sale.certificate.sellerSignedAt = new Date();
      enterStep(sale, 5, null);
    } else {
      enterStep(sale, 4, null);
    }
    await sale.save();

    await notifyPostSignatureAction(sale, Boolean(seller?.stampUrl));

    console.log(`Signature finalisée pour la vente ${saleId}. Passage à l'étape ${sale.currentStep}.`);
    return sale;
  } catch (error) {
    console.error(`Erreur lors de la finalisation de la signature (vente ${saleId}) :`, error.message);
    throw error;
  }
};

module.exports = {
  validateSellerCertificate,
  rejectSellerCertificate,
  buildWaitingList,
  attributeVehicle,
  processSessionAttributions,
  processClosedSessions,
  processPendingAttributionEmails,
  promoteNextBidder,
  listBuyerSales,
  getBuyerSale,
  getSaleVehicle,
  startCommissionPayment,
  startCommissionPaymentIntent,
  confirmCommissionPayment,
  reconcilePendingCommissionPayments,
  processStepDeadlines,
  listSellerSales,
  listSellerVehicles,
  getSellerSale,
  confirmTransferReceived,
  processRegistrationCard,
  submitSellerCertificate,
  submitSignedCertificate,
  validateSignedCertificate,
  rejectSignedCertificate,
  confirmHandover,
  cancelSaleByBuyer,
  toggleSaleTimer,
  forceEndSale,
  extendCurrentStepDeadline,
  revokeOngoingSalesForSuspendedBuyer,
  finalizeSignature,
};
