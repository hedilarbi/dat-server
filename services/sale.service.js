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
const { createSignatureSession, fetchSignedDocument, fetchAuditTrail, fetchSignatureProgress } = require('./esignature.service');

// Numéros des étapes de PURCHASE_STEPS (sale.model.js). Les étapes 3 à 5 sont présentées aux
// utilisateurs comme 3.1, 3.2 et 3.3 de l'étape « Documents administratifs ».
const STEP = { COMMISSION: 1, VIREMENT: 2, PREPARATION: 3, VERIFICATION: 4, SIGNATURE: 5 };

const saleError = (message, codeName, statusCode) => {
  const err = new Error(message);
  err.codeName = codeName;
  if (statusCode) err.statusCode = statusCode;
  return err;
};
const saleDocuments = require('./saleDocuments.service');
const { isStripeConfigured } = require('../config/stripe');

const CLOSED_SESSION_STATUSES = ['closed', 'cloturee'];
const OPEN_SESSION_STATUSES = ['open', 'active'];
const SUSPENSION_NOTES = {
  commission_impayee: "N'a pas payé la commission dans les délais prévus.",
  penalite_etape_2: "N'a pas effectué le virement dans les délais prévus.",
};

const notifySellerInApp = async (sellerId, type, title, message, sale, vehicle) => {
  try {
    await notificationService.createSellerNotification({
      sellerId, type, category: 'ventes', title, message,
      metadata: {
        saleId: sale?._id ? String(sale._id) : undefined,
        vehicleId: vehicle?._id ? String(vehicle._id) : (sale?.vehicle ? String(sale.vehicle) : undefined)
      }
    });
  } catch (error) {
    // Une indisponibilité ponctuelle du centre de notifications ne doit jamais rejouer
    // l'e-mail métier ni annuler une transition de vente déjà enregistrée.
    console.error(`Notification vendeur interne impossible (${type}) : ${error.message}`);
  }
};

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

const getSellerDecisionDeadlineHours = async () => {
  const config = await generalConfigService.getConfig();
  const hours = Number(config?.sellerOfferDecisionDeadlineHours);
  return Number.isFinite(hours) && hours >= 1 ? hours : 48;
};

const applySellerDecisionDeadline = async (sale) => {
  const hours = await getSellerDecisionDeadlineHours();
  sale.sellerDecisionDueAt = new Date(Date.now() + hours * 3600 * 1000);
  return hours;
};

const expireSellerDecision = async (sale) => {
  sale.status = 'sans_gagnant';
  sale.sellerDecisionDueAt = null;
  await sale.save();
  await VehicleDossier.updateOne({ _id: sale.vehicle }, { $set: { session: null } });
  return sale;
};

/**
 * Prévenir le gagnant par e-mail. Un échec d'envoi ne doit jamais faire échouer
 * l'attribution elle-même : la vente reste créée et le courriel est simplement journalisé.
 */
const notifyWinner = async (sale, vehicle, session, deadlineHours) => {
  try {
    const winner = await User.findById(sale.winner).select('email firstName lastName language role');
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
    .select('email firstName lastName language role')
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
    User.findById(entry.buyer).select('email firstName lastName language role').lean(),
    User.findById(sale.seller).select('email firstName lastName language role').lean(),
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
      await notifySellerInApp(seller._id, 'sale_reattributed', 'Nouvel acheteur retenu', `Une nouvelle offre a été retenue pour votre véhicule.`, sale, vehicle);
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
const notifySellerAwarded = async (sale, vehicle, session, { email: sendSellerEmail = true } = {}) => {
  try {
    const seller = await User.findById(sale.seller).select('email firstName lastName language role');
    if (!seller) return;

    if (sendSellerEmail) {
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
    }
    await notifySellerInApp(seller._id, 'sale_awarded', 'Offre retenue', `Une offre a été retenue pour votre véhicule.`, sale, vehicle);
  } catch (error) {
    console.error(`Notification du vendeur impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Prévenir le vendeur que son véhicule n'a pas trouvé preneur : le prix de réserve n'a pas
 * été atteint. Comme les autres notifications, un échec d'envoi n'interrompt pas l'attribution.
 */
const notifySellerUnsold = async (sale, vehicle, session, {
  bestOffer,
  offerCount,
  topOffers = [],
  sellerDecisionDeadlineHours,
  sellerDecisionDueAt,
  email: sendSellerEmail = true,
}) => {
  try {
    const seller = await User.findById(sale.seller).select('email firstName lastName language role');
    if (!seller) return;

    if (sendSellerEmail) {
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
        topOffers,
        saleId: String(sale._id),
        sellerDecisionDeadlineHours,
        sellerDecisionDueAt,
      });
      await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
    }
    await notifySellerInApp(seller._id, 'sale_unsold', 'Véhicule en attente de votre décision', `La session est terminée. Consultez les offres reçues pour votre véhicule.`, sale, vehicle);
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
 * Offres d'un véhicule proposées au vendeur. On ne montre que les choix encore possibles :
 * acheteur actif et offre jamais consommée par une attribution précédente sur cette vente.
 */
const discardedOfferIds = (sale) => new Set(
  (sale?.waitingList || [])
    .filter((entry) => entry.status === 'ecarte' || entry.discardReason)
    .map((entry) => String(entry.offer))
);

const serializeSellerOffers = async (vehicleId, sessionId, excludedOfferIds = new Set()) => {
  const offers = await Offer.find({ vehicle: vehicleId, session: sessionId, status: 'active' })
    .populate('buyer', 'companyName firstName lastName status')
    .sort({ amount: -1, updatedAt: 1 })
    .lean();
  return offers
    .filter((offer) => (
      offer.buyer
      && !['suspendu', 'bloque'].includes(offer.buyer.status)
      && !excludedOfferIds.has(String(offer._id))
    ))
    .map((offer) => ({
      id: String(offer._id),
      amount: offer.amount,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
      selectable: true,
      buyer: {
        companyName: offer.buyer.companyName || '',
        firstName: offer.buyer.firstName || '',
        lastName: offer.buyer.lastName || '',
      },
    }));
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
    const activeOffers = offers.filter((offer) => offer.status === 'active');
    sale.status = activeOffers.length > 0 ? 'suspendue' : 'sans_gagnant';
    sale.currentRank = 0;
    let sellerDecisionDeadlineHours = null;
    if (sale.status === 'suspendue') {
      sellerDecisionDeadlineHours = await applySellerDecisionDeadline(sale);
    } else {
      sale.sellerDecisionDueAt = null;
    }
    await sale.save();
    // Sans aucune offre, le véhicule redevient disponible automatiquement. S'il existe
    // des offres sous la réserve, il reste rattaché à la session clôturée et attend la
    // décision explicite du vendeur (accepter une offre ou le remettre en vente).
    if (activeOffers.length === 0) {
      await VehicleDossier.updateOne({ _id: vehicle._id }, { $set: { session: null } });
    }

    // La meilleure offre reçue, même sous la réserve, aide le vendeur à décider s'il
    // republie au même prix : on la lui transmet plutôt que de dire seulement « invendu ».
    const bestOffer = activeOffers.length
      ? Math.max(...activeOffers.map((offer) => offer.amount))
      : null;
    const topOffers = activeOffers
      .filter((offer) => offer.amount < reservePrice)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((offer) => offer.amount);
    await notifySellerUnsold(sale, vehicle, session, {
      bestOffer,
      offerCount: activeOffers.length,
      topOffers,
      sellerDecisionDeadlineHours,
      sellerDecisionDueAt: sale.sellerDecisionDueAt,
      email: false,
    });

    return sale;
  }

  const best = waitingList[0];
  sale.status = 'en_cours';
  sale.currentRank = 1;
  sale.winner = best.buyer;
  sale.winningOffer = best.offer;
  sale.amount = best.amount;
  sale.sellerDecisionDueAt = null;
  const deadlineHours = await startPurchaseProcedure(sale);
  await sale.save();

  await notifyWinner(sale, vehicle, session, deadlineHours);
  await notifySellerAwarded(sale, vehicle, session, { email: false });
  await notifyWaitingList(sale, vehicle, session);
  return sale;
};

const sendSellerClosureSummaries = async ({ session, vehicles, sales }) => {
  const vehicleIds = vehicles.map((vehicle) => vehicle._id);
  const offers = await Offer.find({ vehicle: { $in: vehicleIds }, session: session._id, status: 'active' })
    .select('vehicle amount')
    .lean();
  const offersByVehicle = new Map();
  for (const offer of offers) {
    const key = String(offer.vehicle);
    const list = offersByVehicle.get(key) || [];
    list.push(offer);
    offersByVehicle.set(key, list);
  }

  const salesByVehicle = new Map(sales.filter(Boolean).map((sale) => [String(sale.vehicle), sale]));
  // Un seul e-mail par vendeur, avec tous ses véhicules de la session répartis en trois sections
  const groups = new Map();
  const groupFor = (sellerId) => {
    if (!groups.has(sellerId)) groups.set(sellerId, { sellerId, awarded: [], belowReserve: [], noOffers: [] });
    return groups.get(sellerId);
  };

  for (const vehicle of vehicles) {
    const sale = salesByVehicle.get(String(vehicle._id));
    if (!sale) continue;
    const vehicleOffers = offersByVehicle.get(String(vehicle._id)) || [];
    const bestOffer = vehicleOffers.length ? Math.max(...vehicleOffers.map((offer) => offer.amount)) : null;
    const item = {
      vehicleLabel: [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Véhicule',
      registrationNumber: vehicle.registrationNumber || null,
      photoUrl: coverUrl(vehicle),
      reservePrice: sale.reservePrice ?? vehicle.reservePrice ?? null,
      bestOffer,
      offerCount: vehicleOffers.length,
      saleId: String(sale._id),
    };
    const group = groupFor(String(vehicle.seller));

    if (sale.status === 'en_cours') {
      group.awarded.push({ ...item, bestOffer: sale.amount ?? bestOffer });
    } else if (vehicleOffers.length === 0) {
      group.noOffers.push(item);
    } else {
      group.belowReserve.push(item);
    }
  }

  const sellerDecisionDeadlineHours = await getSellerDecisionDeadlineHours();
  for (const group of groups.values()) {
    try {
      const seller = await User.findById(group.sellerId).select('email firstName lastName language role').lean();
      if (!seller?.email) continue;
      const email = emailTemplates.saleClosureSummarySellerEmail({
        user: seller,
        sessionName: session.name,
        awarded: group.awarded,
        belowReserve: group.belowReserve,
        noOffers: group.noOffers,
        sellerDecisionDeadlineHours,
      });
      await sendEmail({ to: seller.email, subject: email.subject, text: email.text, html: email.html });
    } catch (error) {
      console.error(`Résumé de clôture vendeur impossible (${group.sellerId}) : ${error.message}`);
    }
  }
};

/**
 * Désigner les gagnants de tous les véhicules d'une session clôturée.
 */
const processSessionAttributions = async (session) => {
  // year et photos alimentent la carte véhicule de l'e-mail envoyé au gagnant
  const vehicles = await VehicleDossier.find({ session: session._id, status: 'valide' })
    .select('brand model year registrationNumber photos seller reservePrice listingCount')
    .lean();

  const results = [];
  for (const vehicle of vehicles) {
    try {
      results.push(await attributeVehicle(vehicle, session));
    } catch (error) {
      console.error(`Attribution impossible pour le véhicule ${vehicle._id} : ${error.message}`);
    }
  }
  await sendSellerClosureSummaries({ session, vehicles, sales: results });
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
    .populate('vehicle', 'brand model year registrationNumber photos')
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
const notifySellerReattributionExhausted = async (sale, suspended = false, sellerDecisionDeadlineHours = null) => {
  try {
    const [seller, vehicle] = await Promise.all([
      User.findById(sale.seller).select('email firstName lastName language role').lean(),
      VehicleDossier.findById(sale.vehicle).select('brand model year').lean(),
    ]);
    if (!seller?.email) return;
    const email = emailTemplates.saleReattributionExhaustedSellerEmail({
      user: seller,
      vehicle,
      saleId: String(sale._id),
      suspended,
      sellerDecisionDeadlineHours,
    });
    await sendEmail({ to: seller.email, ...email });
    await notifySellerInApp(seller._id, 'sale_reattribution_exhausted', suspended ? 'Véhicule suspendu' : 'Véhicule à nouveau disponible', suspended ? 'Aucun acheteur éligible ne reste. Vous pouvez choisir une offre ou remettre le véhicule en vente.' : 'Aucun acheteur éligible ne reste. Le véhicule peut être remis en session.', sale, vehicle);
  } catch (error) {
    console.error(`Notification de retour en attente impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Les traces de la procédure appartiennent au gagnant précédent. Conserver celles du paiement
 * empêcherait le nouveau gagnant de payer et pourrait permettre à une ancienne session Stripe
 * encore en attente d'être réconciliée sur cette nouvelle attribution — y compris quand le
 * vendeur choisit à nouveau le même acheteur, dont la première tentative avait échoué. Les
 * documents et la signature, établis au nom de l'ancien acheteur, sont refaits pour le nouveau.
 */
const resetPurchaseProgress = (sale) => {
  sale.registrationCardSubmittedAt = null;
  sale.certificate = undefined;
  sale.purchaseDeclaration = undefined;
  sale.documentsReview = { version: 0, correctionOpen: false, seller: null, buyer: null, history: [] };
  sale.esignature = undefined;
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
    .filter((entry) => entry.rank > sale.currentRank && entry.status !== 'ecarte')
    .sort((a, b) => a.rank - b.rank);

  for (const candidate of candidates) {
    const user = await User.findById(candidate.buyer).select('status').lean();
    if (user && ['suspendu', 'bloque'].includes(user.status)) {
      candidate.status = 'ecarte';
      candidate.discardedAt = new Date();
      candidate.discardReason = 'compte_suspendu';
    } else {
      next = candidate;
      break;
    }
  }

  if (!next) {
    const remainingOffers = await serializeSellerOffers(sale.vehicle, sale.session, discardedOfferIds(sale));
    const hasSelectableOffer = remainingOffers.length > 0;
    // Les offres encore exploitables restent proposées au vendeur, même sous la réserve.
    // Si tous les offrants ont été épuisés/suspendus, le véhicule redevient disponible.
    sale.status = hasSelectableOffer ? 'suspendue' : 'sans_gagnant';
    sale.currentRank = 0;
    sale.winner = null;
    sale.winningOffer = null;
    sale.amount = null;
    let sellerDecisionDeadlineHours = null;
    if (hasSelectableOffer) {
      sellerDecisionDeadlineHours = await applySellerDecisionDeadline(sale);
    } else {
      sale.sellerDecisionDueAt = null;
    }
    await sale.save();
    if (!hasSelectableOffer) {
      await VehicleDossier.updateOne({ _id: sale.vehicle }, { $set: { session: null } });
    }
    await notifySellerReattributionExhausted(sale, hasSelectableOffer, sellerDecisionDeadlineHours);
    return sale;
  }

  next.status = 'gagnant';
  sale.currentRank = next.rank;
  sale.winner = next.buyer;
  sale.winningOffer = next.offer;
  sale.amount = next.amount;
  sale.sellerDecisionDueAt = null;

  resetPurchaseProgress(sale);
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
 * Un compte qui passe en suspendu/bloqué ne peut plus exposer de véhicule : s'il s'agit d'un
 * vendeur (y compris un vendeur pénalisé sur un achat), ses véhicules sortent des sessions pas
 * encore clôturées. Sans effet pour un acheteur, qui n'a aucun véhicule. Un échec ne doit pas
 * annuler la suspension elle-même, déjà enregistrée.
 */
const withdrawSuspendedSellerVehicles = async (userId) => {
  try {
    // Chargé à l'appel : session.service charge lui-même sale.service (cycle de require).
    await require('./session.service').withdrawSuspendedSellerVehicles(userId);
  } catch (error) {
    console.error(`Retrait des véhicules en session impossible (compte ${userId}) : ${error.message}`);
  }
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

// Chaque partie ne reçoit que son propre lien de signature : celui de l'autre lui donnerait
// accès à sa session de signature.
const serializeEsignature = (esignature, side) => {
  if (!esignature) return null;
  // Le motif technique d'un échec reste réservé à l'administration : les parties n'en voient que la date.
  const { sellerUrl, buyerUrl, setupError: _setupError, ...rest } = esignature;
  return side === 'seller' ? { ...rest, sellerUrl } : { ...rest, buyerUrl };
};

// Étape 3 vue par l'une des parties : documents courants, avis des deux parties et présence des
// tampons. Les deux parties voient exactement la même chose.
const serializeDocuments = (sale, stamps = {}) => {
  const document = (doc) => (doc?.url ? {
    url: doc.url,
    source: doc.source || 'generated',
    updatedAt: doc.updatedAt || doc.generatedAt || null,
  } : null);
  const decision = (review) => (review?.decision ? {
    decision: review.decision,
    reason: review.reason || null,
    comment: review.comment || null,
    decidedAt: review.decidedAt || null,
  } : null);
  return {
    registrationCardSubmittedAt: sale.registrationCardSubmittedAt || null,
    stamps: { seller: Boolean(stamps.seller), buyer: Boolean(stamps.buyer) },
    certificate: document(sale.certificate),
    purchaseDeclaration: document(sale.purchaseDeclaration),
    review: {
      version: sale.documentsReview?.version || 0,
      correctionOpen: Boolean(sale.documentsReview?.correctionOpen),
      seller: decision(sale.documentsReview?.seller),
      buyer: decision(sale.documentsReview?.buyer),
    },
  };
};

const serializeSale = (sale, stamps) => {
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
    // Étape 2 terminée : date à laquelle le vendeur a confirmé avoir reçu le virement
    transferConfirmedAt: sale.transferConfirmedAt || null,
    esignature: serializeEsignature(sale.esignature, 'buyer'),
    documents: serializeDocuments(sale, stamps),
    pendingAction: pendingActionFor(sale, 'buyer', Boolean(stamps?.buyer)),
    bonEnlevement: {
      url: sale.bonEnlevement?.url || null,
      generatedAt: sale.bonEnlevement?.generatedAt || null,
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
      // Vérifié par l'acheteur sur les documents tamponnés (étape « Validation des documents »)
      siret: sale.seller.siret || null,
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
  const [sales, buyer] = await Promise.all([
    Sale.find({ winner: buyerId, status: { $in: ['en_cours', 'cloturee'] } })
      .populate('vehicle', 'brand model year mileage registrationNumber photos')
      .populate('session', 'name endDate')
      .populate('winningOffer', 'fees')
      .populate('seller', 'stampUrl')
      .sort({ wonAt: -1, createdAt: -1 })
      .lean(),
    User.findById(buyerId).select('stampUrl').lean(),
  ]);

  const serialized = sales.map((sale) => serializeSale(sale, {
    seller: Boolean(sale.seller?.stampUrl),
    buyer: Boolean(buyer?.stampUrl),
  }));
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
    .populate('seller', 'companyName firstName lastName phone email address siret bankInfo stampUrl')
    .lean();

  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  const buyer = await User.findById(buyerId).select('stampUrl').lean();
  return serializeSale(sale, { seller: Boolean(sale.seller?.stampUrl), buyer: Boolean(buyer?.stampUrl) });
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
      User.findById(sale.seller).select('email firstName lastName language role').lean(),
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
      await notifySellerInApp(seller._id, 'buyer_confirmed', 'Acheteur confirmé', 'Le paiement de la commission est confirmé. Vérifiez maintenant la réception du virement.', sale, vehicle);
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

/**
 * Action attendue d'une partie sur une vente en cours, ou null quand elle attend l'autre partie.
 * Alimente les pastilles « à traiter » des listes et tableaux de bord : l'interface ne
 * réinterprète pas la sémantique des étapes. `hasStamp` : la partie a déposé son tampon.
 */
const pendingActionFor = (sale, side, hasStamp) => {
  if (sale.status !== 'en_cours') return null;
  const review = sale.documentsReview;
  switch (sale.currentStep) {
    case STEP.COMMISSION: return side === 'buyer' ? 'pay_commission' : null;
    case STEP.VIREMENT: return side === 'seller' ? 'confirm_transfer' : null;
    case STEP.PREPARATION:
      if (side === 'seller' && !sale.registrationCardSubmittedAt) return 'registration_card';
      return hasStamp ? null : 'upload_stamp';
    case STEP.VERIFICATION:
      if (!((review?.version || 0) > 0)) return hasStamp ? null : 'upload_stamp';
      return review?.[side]?.decision === 'valide' ? null : 'review_documents';
    case STEP.SIGNATURE:
      return sale.esignature?.[`${side}SignedAt`] ? null : 'sign';
    default: return null;
  }
};

// Parts du délai écoulé déclenchant un rappel à l'acheteur
const REMINDER_THRESHOLDS = [50, 80];

/**
 * Envoyer un rappel ou l'information de retrait à l'acheteur concerné.
 * Les échecs d'envoi sont journalisés sans interrompre le traitement des autres ventes.
 */
const notifyBuyer = async (buyerId, build) => {
  try {
    const buyer = await User.findById(buyerId).select('email firstName lastName language role');
    if (!buyer) return;
    const email = build(buyer);
    await sendEmail({ to: buyer.email, subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification de l'acheteur impossible : ${error.message}`);
  }
};

const processSellerDecisionDeadlines = async () => {
  const now = new Date();
  const sales = await Sale.find({
    status: 'suspendue',
    sellerDecisionDueAt: { $ne: null, $lte: now },
  });

  for (const sale of sales) {
    try {
      await expireSellerDecision(sale);
    } catch (error) {
      console.error(`Expiration décision vendeur impossible (vente ${sale._id}) : ${error.message}`);
    }
  }

  return sales.length;
};

/**
 * Surveiller les échéances des étapes en cours :
 * - à 50 % puis 80 % du délai écoulé, l'acheteur reçoit un rappel ;
 * - à 100 %, il est écarté au profit du candidat suivant et en est informé par e-mail.
 * Les seuils déjà notifiés sont mémorisés sur la vente, donc jamais renvoyés.
 */
const processStepDeadlines = async () => {
  await processSellerDecisionDeadlines();

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
            buyer.suspension = {
              note: SUSPENSION_NOTES.commission_impayee,
              source: 'system',
              reason: 'commission_impayee',
              date: new Date(),
            };
            await buyer.save();
            try {
              await notificationService.createAdminSaleDeadlineSuspensionNotification({
                sale,
                vehicle,
                user: buyer,
                stepKey,
                reason: SUSPENSION_NOTES.commission_impayee,
              });
            } catch (error) {
              console.error(`Notification admin de suspension impossible (${buyer._id}) : ${error.message}`);
            }
            await revokeOngoingSalesForSuspendedBuyer(buyer._id, `${stepKey}_delai_depasse`, sale._id);
            await withdrawSuspendedSellerVehicles(buyer._id);
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
            buyer.suspension = {
              note: SUSPENSION_NOTES.penalite_etape_2,
              source: 'system',
              reason: 'penalite_etape_2',
              date: new Date(),
            };
            await buyer.save();
            try {
              await notificationService.createAdminSaleDeadlineSuspensionNotification({
                sale,
                vehicle,
                user: buyer,
                stepKey,
                reason: SUSPENSION_NOTES.penalite_etape_2,
              });
            } catch (error) {
              console.error(`Notification admin de suspension impossible (${buyer._id}) : ${error.message}`);
            }
            await revokeOngoingSalesForSuspendedBuyer(buyer._id, `${stepKey}_delai_depasse`, sale._id);
            await withdrawSuspendedSellerVehicles(buyer._id);
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
 * Nombre d'offres actives et trois meilleurs montants, par couple véhicule/session.
 * Le vendeur suit ainsi les meilleures enchères en cours face à
 * son prix de réserve ; l'identité des enchérisseurs, elle, reste couverte par le pli
 * fermé jusqu'à la clôture.
 */
const EMPTY_OFFER_STATS = { count: 0, bestOffer: null, topOffers: [] };

const offerStatsByListing = async (vehicleIds) => {
  if (vehicleIds.length === 0) return new Map();

  const offers = await Offer.find({ vehicle: { $in: vehicleIds }, status: 'active' })
    .select('vehicle session amount')
    .sort({ amount: -1, updatedAt: 1 })
    .lean();

  const statsByListing = new Map();
  for (const offer of offers) {
    const key = `${offer.vehicle}:${offer.session}`;
    const stats = statsByListing.get(key) || { count: 0, bestOffer: null, topOffers: [] };
    stats.count += 1;
    if (stats.bestOffer == null) stats.bestOffer = offer.amount;
    // La requête est décroissante : on ne conserve que les trois meilleurs montants.
    if (stats.topOffers.length < 3) stats.topOffers.push(offer.amount);
    statsByListing.set(key, stats);
  }

  // L'affichage demandé est croissant parmi les trois meilleures offres.
  for (const stats of statsByListing.values()) stats.topOffers.reverse();
  return statsByListing;
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
  en_vente: ['en_attente', 'programme', 'encheres_ouvertes', 'offres_a_decider'],
  vente: ['vente_en_cours', 'vendu', 'vente_annulee'],
};

const SELLER_VEHICLE_STATES = [...SELLER_PHASES.depot, ...SELLER_PHASES.en_vente, ...SELLER_PHASES.vente];

const phaseOfState = (state) => Object.keys(SELLER_PHASES).find((phase) => SELLER_PHASES[phase].includes(state)) || 'depot';

/**
 * Une ligne par véhicule, avec son état courant — et non une ligne par vente. Un véhicule
 * invendu puis republié possède plusieurs ventes ; seule la dernière décrit sa situation.
 */
const listSellerVehicles = async (sellerId) => {
  const sellerHasStamp = Boolean((await User.findById(sellerId).select('stampUrl').lean())?.stampUrl);
  const [vehicles, sales] = await Promise.all([
    // Tous les dossiers, pas seulement les validés : la phase 1 vit précisément dans les
    // statuts amont (soumis, correction demandée, refusé).
    VehicleDossier.find({ seller: sellerId })
      .select('brand model registrationNumber photos listingCount reservePrice session lotNumber updatedAt status refusals')
      .sort({ updatedAt: -1 })
      .lean(),
    Sale.find({ seller: sellerId })
      .select('vehicle session status amount currentStep wonAt closedAt createdAt sellerDecisionDueAt waitingList registrationCardSubmittedAt documentsReview esignature.sellerSignedAt')
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

  const selectableOffersBySale = new Map(await Promise.all(
    sales
      .filter((sale) => sale.status === 'suspendue')
      .map(async (sale) => [
        String(sale._id),
        await serializeSellerOffers(sale.vehicle, sale.session, discardedOfferIds(sale)),
      ])
  ));

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
    else if (sale?.status === 'suspendue') state = 'offres_a_decider';
    else if (vehicle.status === 'brouillon') state = 'brouillon';
    else if (vehicle.status === 'soumis' || vehicle.status === 'en_attente_validation') state = 'en_validation';
    else if (vehicle.status === 'correction_demandee' || vehicle.status === 'a_corriger') state = 'a_corriger';
    else if (vehicle.status === 'refuse') state = 'refuse';
    else if (session && OPEN_SESSION_STATUSES.includes(session.status)) state = 'encheres_ouvertes';
    else if (session && session.status === 'upcoming') state = 'programme';
    else state = 'en_attente';

    // Motif du dernier renvoi : affiché tel quel au vendeur, il vaut mieux qu'un statut.
    const lastRefusal = (vehicle.refusals || []).slice(-1)[0] || null;

    const selectableOffers = sale?.status === 'suspendue'
      ? (selectableOffersBySale.get(String(sale._id)) || [])
      : null;
    const stats = selectableOffers
      ? {
          count: selectableOffers.length,
          bestOffer: selectableOffers[0]?.amount ?? null,
          topOffers: selectableOffers.slice(0, 3).map((offer) => offer.amount).reverse(),
        }
      : vehicle.session
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
      topOffers: stats.topOffers,
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
        pendingAction: pendingActionFor(sale, 'seller', sellerHasStamp),
        wonAt: sale.wonAt || null,
        closedAt: sale.closedAt || null,
        sellerDecisionDueAt: sale.sellerDecisionDueAt || null,
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
  const sellerHasStamp = Boolean((await User.findById(sellerId).select('stampUrl').lean())?.stampUrl);
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
  const selectableOffersBySale = new Map(await Promise.all(
    sales
      .filter((sale) => sale.status === 'suspendue' && sale.vehicle)
      .map(async (sale) => [
        String(sale._id),
        await serializeSellerOffers(sale.vehicle._id, sale.session?._id, discardedOfferIds(sale)),
      ])
  ));

  const inSession = liveVehicles
    .filter((vehicle) => liveSessionsById.has(String(vehicle.session)))
    .map((vehicle) => {
      const session = liveSessionsById.get(String(vehicle.session));
      const stats = statsOn(vehicle._id, vehicle.session);
      return {
        // Avant l'attribution il n'existe pas encore de Sale : le détail vendeur utilise
        // donc l'identifiant du véhicule, reconnu par getSellerSale.
        id: String(vehicle._id),
        status: 'en_session',
        amount: null,
        reservePrice: vehicle.reservePrice ?? null,
        offerCount: stats.count,
        // Meilleure enchère en cours, à confronter au prix de réserve ci-dessus.
        bestOffer: stats.bestOffer,
        topOffers: stats.topOffers,
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
    const selectableOffers = sale.status === 'suspendue'
      ? (selectableOffersBySale.get(String(sale._id)) || [])
      : null;
    const stats = selectableOffers
      ? {
          count: selectableOffers.length,
          bestOffer: selectableOffers[0]?.amount ?? null,
          topOffers: selectableOffers.slice(0, 3).map((offer) => offer.amount).reverse(),
        }
      : vehicle ? statsOn(vehicle._id, sale.session?._id) : EMPTY_OFFER_STATS;
    return {
      id: String(sale._id),
      status: sale.status,
      amount: sale.amount,
      reservePrice: sale.reservePrice ?? null,
      offerCount: stats.count,
      bestOffer: stats.bestOffer,
      topOffers: stats.topOffers,
      waitingCount: (sale.waitingList || []).length,
      currentStep: sale.status === 'en_cours' ? sale.currentStep : null,
      currentStepDueAt: sale.status === 'en_cours' ? (sale.currentStepDueAt || null) : null,
      sellerDecisionDueAt: sale.status === 'suspendue' ? (sale.sellerDecisionDueAt || null) : null,
      stepKey: sale.status === 'en_cours' ? (Sale.PURCHASE_STEPS[sale.currentStep - 1] || null) : null,
      stepCount: Sale.PURCHASE_STEPS.length,
      // Vrai quand la vente est bloquée en attente d'une action du vendeur : c'est ce qui
      // doit remonter en tête de son tableau de bord.
      pendingAction: pendingActionFor(sale, 'seller', sellerHasStamp),
      awaitingSeller: Boolean(pendingActionFor(sale, 'seller', sellerHasStamp)),
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
    unsold: serialized.filter((sale) => ['suspendue', 'sans_gagnant'].includes(sale.status)),
  };
};

/**
 * Charger, pour une vente, de quoi composer un e-mail : véhicule et session.
 */
const loadSaleContext = async (saleId) => Sale.findById(saleId)
  .populate('vehicle', 'brand model year photos')
  .populate('session', 'name')
  .lean();

/**
 * Confirmer la clôture aux deux parties, chacune avec le lien vers son propre espace.
 */
/**
 * Côté du premier signataire, d'après les signatures relevées pendant l'étape 3.3, ou null si
 * l'ordre n'a pas pu être relevé (les deux ont signé entre deux relectures).
 */
const firstSignerSide = (esignature) => {
  const seller = esignature?.sellerSignedAt ? new Date(esignature.sellerSignedAt) : null;
  const buyer = esignature?.buyerSignedAt ? new Date(esignature.buyerSignedAt) : null;
  if (seller && buyer) return buyer < seller ? 'buyer' : 'seller';
  if (seller) return 'seller';
  if (buyer) return 'buyer';
  return null;
};

/**
 * Vente clôturée à la signature : le second signataire vient de terminer sur la plateforme de
 * signature et n'est pas prévenu ; le premier, qui attendait, reçoit l'e-mail avec le lien vers
 * le bon d'enlèvement. Si l'ordre des signatures est inconnu, les deux sont prévenus.
 */
const notifySaleClosed = async (sale) => {
  try {
    const [buyer, seller, context] = await Promise.all([
      User.findById(sale.winner).select('email firstName lastName language role'),
      User.findById(sale.seller).select('email firstName lastName language role'),
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

    const firstSigner = firstSignerSide(sale.esignature);
    for (const [user, role, side] of [[buyer, 'acheteur', 'buyer'], [seller, 'vendeur', 'seller']]) {
      if (!user) continue;
      try {
        if (!firstSigner || firstSigner === side) {
          const email = emailTemplates.saleClosedEmail({ user, role, ...base });
          await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
        }
        if (role === 'vendeur') await notifySellerInApp(user._id, 'sale_closed', 'Vente terminée', 'La vente de votre véhicule est maintenant clôturée.', sale, vehicle);
      } catch (error) {
        console.error(`Notification de clôture impossible (${role}) : ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Notification de clôture impossible (vente ${sale._id}) : ${error.message}`);
  }
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

  let sale = await Sale.findOne({ _id: saleId, seller: sellerId })
    .populate('vehicle', 'brand model year mileage photos listingCount registrationNumber registrationCardAvailable formulaNumber registrationCardMissingMotif')
    .populate('session', 'name endDate')
    .populate('winner', 'companyName firstName lastName email phone address siret stampUrl')
    .lean();
  const sellerStamp = await User.findById(sellerId).select('stampUrl').lean();

  // Une vente « sans gagnant » appartient à une session passée : si le véhicule a depuis été
  // republié dans une session encore ouverte, c'est cette mise en vente qui compte. On affiche
  // alors ses offres en direct plutôt que l'ancien résultat « véhicule de nouveau disponible ».
  let liveVehicleId = saleId;
  if (sale && sale.status === 'sans_gagnant' && sale.vehicle) {
    const republished = await VehicleDossier.findOne({ _id: sale.vehicle._id, seller: sellerId, session: { $ne: null } })
      .select('session')
      .lean();
    if (republished && String(republished.session) !== String(sale.session?._id)) {
      const openSession = await Session.exists({ _id: republished.session, status: { $in: OPEN_SESSION_STATUSES } });
      if (openSession) {
        liveVehicleId = String(sale.vehicle._id);
        sale = null;
      }
    }
  }

  if (!sale) {
    // Pendant une session ouverte aucune vente n'existe encore : l'identifiant reçu est
    // alors celui du véhicule. Cette vue permet tout de même au vendeur de voir les offres.
    const vehicle = await VehicleDossier.findOne({ _id: liveVehicleId, seller: sellerId, session: { $ne: null } })
      .populate('session', 'name endDate status')
      .lean();
    if (!vehicle) {
      const err = new Error('Vente introuvable.');
      err.codeName = 'sale.not_found';
      err.statusCode = 404;
      throw err;
    }
    const offers = await serializeSellerOffers(vehicle._id, vehicle.session._id);
    return {
      id: String(vehicle._id), status: 'en_session', amount: null,
      reservePrice: vehicle.reservePrice ?? null, currentStep: 0, stepKey: null,
      stepCount: Sale.PURCHASE_STEPS.length, steps: Sale.PURCHASE_STEPS, offers,
      vehicle: {
        id: String(vehicle._id), brand: vehicle.brand || '', model: vehicle.model || '',
        year: vehicle.year ?? null, mileage: vehicle.mileage ?? null,
        registrationNumber: vehicle.registrationNumber || null,
        registrationCardAvailable: vehicle.registrationCardAvailable ?? true,
        photoUrl: coverUrl(vehicle),
      },
      session: {
        id: String(vehicle.session._id), name: vehicle.session.name,
        endDate: vehicle.session.endDate, status: vehicle.session.status,
      },
    };
  }

  const vehicle = sale.vehicle;
  const offers = sale.status === 'suspendue'
    ? await serializeSellerOffers(vehicle._id, sale.session._id, discardedOfferIds(sale))
    : [];
  const unsoldReason = sale.status === 'sans_gagnant'
    ? ((sale.waitingList || []).some((entry) => entry.status === 'ecarte' || entry.discardReason)
      ? 'buyer_default'
      : 'reserve_not_met')
    : null;
  return {
    id: String(sale._id),
    status: sale.status,
    unsoldReason,
    amount: sale.amount,
    reservePrice: sale.reservePrice ?? null,
    sellerDecisionDueAt: sale.status === 'suspendue' ? (sale.sellerDecisionDueAt || null) : null,
    currentStep: sale.currentStep,
    stepKey: Sale.PURCHASE_STEPS[sale.currentStep - 1] || null,
    stepCount: Sale.PURCHASE_STEPS.length,
    steps: Sale.PURCHASE_STEPS,
    currentStepStartedAt: sale.currentStepStartedAt || null,
    currentStepDueAt: sale.currentStepDueAt || null,
    commissionPaidAt: sale.commissionPaidAt || null,
    documentsDelivery: sale.documentsDelivery || null,
    transferConfirmedAt: sale.transferConfirmedAt || null,
    esignature: serializeEsignature(sale.esignature, 'seller'),
    documents: serializeDocuments(sale, {
      seller: Boolean(sellerStamp?.stampUrl),
      buyer: Boolean(sale.winner && typeof sale.winner === 'object' && sale.winner.stampUrl),
    }),
    bonEnlevement: {
      url: sale.bonEnlevement?.url || null,
      generatedAt: sale.bonEnlevement?.generatedAt || null,
    },
    waitingCount: (sale.waitingList || []).length,
    wonAt: sale.wonAt || null,
    closedAt: sale.closedAt || null,
    offers,
    vehicle: vehicle ? {
      id: String(vehicle._id),
      brand: vehicle.brand || '',
      model: vehicle.model || '',
      year: vehicle.year ?? null,
      mileage: vehicle.mileage ?? null,
      registrationNumber: vehicle.registrationNumber || null,
      registrationCardAvailable: vehicle.registrationCardAvailable ?? true,
      // Saisis par le vendeur à l'étape 3.1, réaffichés dans l'historique de cette étape
      formulaNumber: vehicle.formulaNumber || null,
      registrationCardMissingMotif: vehicle.registrationCardMissingMotif || null,
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
      // Vérifié par le vendeur sur les documents tamponnés (étape « Validation des documents »)
      siret: sale.winner.siret || null,
    } : null,
  };
};

/**
 * Prévenir l'administrateur (notification in-app et e-mail) qu'un vendeur a retenu une offre
 * avant la clôture de la session. Un échec d'envoi n'annule jamais le choix du vendeur.
 */
const notifyAdminOfEarlyAcceptance = async (sale, vehicle, session, buyerId) => {
  try {
    const [seller, buyer, config] = await Promise.all([
      User.findById(sale.seller).select('companyName firstName lastName').lean(),
      User.findById(buyerId).select('companyName firstName lastName').lean(),
      generalConfigService.getConfig(),
    ]);
    await notificationService.createAdminSellerEarlyAcceptanceNotification(sale, vehicle, seller, session, sale.amount);

    const fullName = (user) => user?.companyName || [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    const email = emailTemplates.adminSellerEarlyAcceptanceEmail({
      saleId: String(sale._id),
      vehicleLabel: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Véhicule',
      sellerLabel: fullName(seller) || 'Vendeur inconnu',
      buyerLabel: fullName(buyer) || 'Acheteur inconnu',
      sessionName: session?.name || '',
      amount: sale.amount,
    });
    await sendEmail({ to: config?.adminEmail || 'contact@dealautopro.com', subject: email.subject, text: email.text, html: email.html });
  } catch (error) {
    console.error(`Notification admin (offre retenue avant clôture, vente ${sale._id}) impossible : ${error.message}`);
  }
};

const acceptSellerOffer = async ({ vehicleId, offerId, sellerId }) => {
  const vehicle = await VehicleDossier.findOne({ _id: vehicleId, seller: sellerId });
  if (!vehicle) {
    const err = new Error('Véhicule introuvable.');
    err.codeName = 'sale.vehicle_not_found';
    err.statusCode = 404;
    throw err;
  }
  const offer = await Offer.findOne({ _id: offerId, vehicle: vehicle._id, status: 'active' })
    .populate('buyer', 'status');
  if (!offer || !offer.buyer || ['suspendu', 'bloque'].includes(offer.buyer.status)) {
    const err = new Error("Cette offre n'est plus disponible.");
    err.codeName = 'sale.offer_not_available';
    err.statusCode = 409;
    throw err;
  }

  let sale = await Sale.findOne({ vehicle: vehicle._id, session: offer.session });
  if (sale && discardedOfferIds(sale).has(String(offer._id))) {
    const err = new Error("Cette offre a déjà été consommée et n'est plus disponible.");
    err.codeName = 'sale.offer_not_available';
    err.statusCode = 409;
    throw err;
  }
  if (sale?.status === 'suspendue' && sale.sellerDecisionDueAt && new Date(sale.sellerDecisionDueAt) <= new Date()) {
    await expireSellerDecision(sale);
    const err = new Error("Le délai de décision vendeur est dépassé. Le véhicule est revenu en attente de session.");
    err.codeName = 'sale.seller_decision_expired';
    err.statusCode = 409;
    throw err;
  }
  if (sale && !['suspendue', 'sans_gagnant'].includes(sale.status)) {
    const err = new Error('Une procédure de vente est déjà engagée pour ce véhicule.');
    err.codeName = 'sale.already_started';
    err.statusCode = 409;
    throw err;
  }
  // Sans vente existante, la session est encore ouverte : le vendeur choisit son acheteur avant
  // la clôture. L'offre doit alors appartenir à la session en cours du véhicule.
  const isEarlyAcceptance = !sale;
  if (isEarlyAcceptance) {
    const openSession = vehicle.session && String(vehicle.session) === String(offer.session)
      ? await Session.exists({ _id: offer.session, status: { $in: OPEN_SESSION_STATUSES } })
      : null;
    if (!openSession) {
      const err = new Error("Cette offre n'est plus disponible.");
      err.codeName = 'sale.offer_not_available';
      err.statusCode = 409;
      throw err;
    }
    sale = new Sale({ vehicle: vehicle._id, session: offer.session, seller: sellerId, reservePrice: vehicle.reservePrice || 0 });
  }

  sale.waitingList = [{ buyer: offer.buyer._id, offer: offer._id, amount: offer.amount,
    offeredAt: offeredAt(offer), rank: 1, status: 'gagnant' }];
  sale.status = 'en_cours';
  sale.currentRank = 1;
  sale.winner = offer.buyer._id;
  sale.winningOffer = offer._id;
  sale.amount = offer.amount;
  sale.sellerDecisionDueAt = null;
  // La vente peut être réutilisée après l'échec d'un précédent gagnant (liste d'attente épuisée)
  resetPurchaseProgress(sale);
  const deadlineHours = await startPurchaseProcedure(sale);
  await sale.save();

  // Avant la clôture, retirer le véhicule empêche toute nouvelle offre. Après la clôture,
  // conserver sa session d'origine : elle reste la session qui a produit la vente et doit
  // demeurer visible dans le suivi administratif.
  vehicle.session = isEarlyAcceptance ? null : offer.session;
  await vehicle.save();
  const session = await Session.findById(offer.session).lean();
  await notifyWinner(sale, vehicle, session || { name: '' }, deadlineHours);
  await notifySellerAwarded(sale, vehicle, session || { name: '' });
  if (isEarlyAcceptance) await notifyAdminOfEarlyAcceptance(sale, vehicle, session, offer.buyer._id);
  return sale;
};

const relistSuspendedVehicle = async ({ saleId, sellerId }) => {
  const sale = await Sale.findOne({ _id: saleId, seller: sellerId, status: 'suspendue' });
  if (!sale) {
    const err = new Error("Ce véhicule n'attend pas de décision vendeur.");
    err.codeName = 'sale.not_suspended';
    err.statusCode = 409;
    throw err;
  }
  if (sale.sellerDecisionDueAt && new Date(sale.sellerDecisionDueAt) <= new Date()) {
    await expireSellerDecision(sale);
    const err = new Error("Le délai de décision vendeur est dépassé. Le véhicule est déjà revenu en attente de session.");
    err.codeName = 'sale.seller_decision_expired';
    err.statusCode = 409;
    throw err;
  }
  return expireSellerDecision(sale);
};

/**
 * Étape 3.3 : inviter la partie qui a validé les documents en premier à venir les signer,
 * maintenant que l'autre partie les a validés à son tour.
 */
const notifySignatureReady = async (user, side, signatureUrl, vehicle, sale) => {
  try {
    const email = emailTemplates.signatureReadyEmail({
      user,
      side,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      signatureUrl,
    });
    await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
    if (side === 'seller') await notifySellerInApp(user._id, 'signature_ready', 'Documents à signer', 'L’acheteur a validé les documents : vous pouvez les signer.', sale, vehicle);
  } catch (error) {
    console.error(`Notification de signature OpenAPI impossible pour ${user.email} : ${error.message}`);
  }
};

/**
 * Charge une vente en cours dont l'utilisateur est le vendeur ou l'acheteur, à l'étape attendue.
 * Le filtre sur les parties fait office de contrôle d'accès.
 */
const loadPartySale = async (saleId, userId, step, stepMessage) => {
  const sale = mongoose.isValidObjectId(saleId)
    ? await Sale.findOne({ _id: saleId, $or: [{ seller: userId }, { winner: userId }] })
    : null;
  if (!sale) throw saleError('Vente introuvable.', 'sale.not_found', 404);
  if (sale.status !== 'en_cours') throw saleError("Cette vente n'est plus en cours.", 'sale.not_ongoing', 409);
  if (sale.currentStep !== step) throw saleError(stepMessage, 'sale.step_mismatch', 409);
  return { sale, side: String(sale.seller) === String(userId) ? 'seller' : 'buyer' };
};

/**
 * Prévenir les parties d'un événement de l'étape 3 (documents administratifs). Chaque
 * destinataire reçoit un e-mail, et le vendeur une notification dans son espace.
 * `recipients` : côtés à prévenir ('seller', 'buyer').
 */
const notifyDocumentsEvent = async (sale, kind, recipients, extra = {}) => {
  try {
    const [seller, buyer, vehicle] = await Promise.all([
      User.findById(sale.seller).select('email firstName lastName language role').lean(),
      User.findById(sale.winner).select('email firstName lastName language role').lean(),
      VehicleDossier.findById(sale.vehicle).select('brand model').lean(),
    ]);
    const users = { seller, buyer };
    for (const side of recipients) {
      const user = users[side];
      if (!user) continue;
      const email = emailTemplates.saleDocumentsEmail({
        user,
        side,
        kind,
        brand: vehicle?.brand || '',
        model: vehicle?.model || '',
        saleId: String(sale._id),
        ...extra,
      });
      try {
        await sendEmail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
      } catch (error) {
        console.error(`E-mail « ${kind} » impossible (${side}, vente ${sale._id}) : ${error.message}`);
      }
      if (side === 'seller') {
        await notifySellerInApp(user._id, `documents_${kind}`, email.inAppTitle, email.inAppMessage, sale, vehicle);
      }
    }
  } catch (error) {
    console.error(`Notification « ${kind} » impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Étape 2 : le virement est réalisé de banque à banque, hors plateforme. Seul le vendeur
 * peut attester l'avoir reçu ; sa confirmation ouvre l'étape 3.1 (carte grise et tampons).
 */
const confirmTransferReceived = async ({ saleId, sellerId }) => {
  const { sale, side } = await loadPartySale(saleId, sellerId, STEP.VIREMENT, "Cette vente n'est pas à l'étape du virement.");
  if (side !== 'seller') throw saleError('Vente introuvable.', 'sale.not_found', 404);

  sale.transferConfirmedAt = new Date();
  enterStep(sale, STEP.PREPARATION, null);
  await sale.save();
  return sale;
};

/**
 * Étape 3.1 : le vendeur complète les données de la carte grise. La vente passe à la
 * vérification (3.2), où les documents sont générés dès que les deux tampons existent.
 */
const submitRegistrationCard = async ({ saleId, sellerId, formulaNumber, registrationCardMissingMotif }) => {
  const { sale, side } = await loadPartySale(saleId, sellerId, STEP.PREPARATION, "Cette vente n'est pas à l'étape de la carte grise.");
  if (side !== 'seller') throw saleError('Vente introuvable.', 'sale.not_found', 404);

  const vehicle = await VehicleDossier.findById(sale.vehicle).select('registrationCardAvailable');
  if (!vehicle) throw saleError('Dossier du véhicule introuvable.', 'vehicle_dossier.not_found', 404);

  const rawFormulaNumber = typeof formulaNumber === 'string' ? formulaNumber.trim() : '';
  // Le modal affiche déjà le préfixe « 20 ». Accepte aussi les clients qui n'envoient que
  // la suite et persiste toujours le numéro complet dans le dossier.
  const normalizedFormulaNumber = rawFormulaNumber && !rawFormulaNumber.startsWith('20')
    ? `20${rawFormulaNumber}`
    : rawFormulaNumber;
  const normalizedMissingMotif = typeof registrationCardMissingMotif === 'string'
    ? registrationCardMissingMotif.trim()
    : '';

  if (vehicle.registrationCardAvailable == null) {
    throw saleError("La disponibilité de la carte grise n'est pas renseignée dans le dossier du véhicule.", 'sale.registration_card_status_required', 400);
  }
  if (vehicle.registrationCardAvailable === true && !normalizedFormulaNumber) {
    throw saleError('Le numéro de formule de la carte grise est obligatoire.', 'sale.formula_number_required', 400);
  }
  if (vehicle.registrationCardAvailable === false && !normalizedMissingMotif) {
    throw saleError("Le motif d'absence de carte grise est obligatoire.", 'sale.registration_card_missing_motif_required', 400);
  }

  const registrationCardUpdate = vehicle.registrationCardAvailable === true
    ? { $set: { formulaNumber: normalizedFormulaNumber }, $unset: { registrationCardMissingMotif: 1 } }
    : { $set: { registrationCardMissingMotif: normalizedMissingMotif }, $unset: { formulaNumber: 1 } };
  await VehicleDossier.updateOne({ _id: sale.vehicle }, registrationCardUpdate);

  sale.registrationCardSubmittedAt = new Date();
  enterStep(sale, STEP.VERIFICATION, null);
  await sale.save();

  // L'acheteur est invité à vérifier les documents s'ils sont prêts ; sinon, s'il lui manque son
  // tampon, à le déposer. Si c'est le tampon du vendeur qui manque, il voit la bannière à l'écran.
  const generated = await prepareSaleDocuments(sale._id, { triggeredBy: 'seller' });
  if (!generated) {
    const buyer = await User.findById(sale.winner).select('stampUrl').lean();
    if (!buyer?.stampUrl) await notifyDocumentsEvent(sale, 'stamp_needed', ['buyer']);
  }
  return Sale.findById(sale._id);
};

/**
 * Étape 3.2 : génère le certificat de cession et la déclaration d'achat, remplis et tamponnés
 * par les deux parties, dès que leurs deux tampons existent. Appelée après la saisie de la
 * carte grise, à chaque dépôt de tampon, et par la tâche de fond en filet de sécurité.
 * `triggeredBy` : partie dont l'action a débloqué la génération ; seule l'autre est prévenue par
 * e-mail (celle qui agit est déjà sur la vente). Sans elle (tâche de fond), les deux le sont.
 * Renvoie true quand les documents viennent d'être générés.
 */
const prepareSaleDocuments = async (saleId, { triggeredBy } = {}) => {
  const sale = await Sale.findById(saleId).lean();
  if (!sale || sale.status !== 'en_cours' || sale.currentStep !== STEP.VERIFICATION) return false;
  if ((sale.documentsReview?.version || 0) > 0) return false;

  const [vehicle, seller, buyer] = await Promise.all([
    VehicleDossier.findById(sale.vehicle)
      .select('brand model year mileage vin registrationNumber firstRegistrationDate vehicleGenre engine registrationCardAvailable formulaNumber registrationCardMissingMotif')
      .lean(),
    User.findById(sale.seller).select('firstName lastName email companyName siret address stampUrl').lean(),
    User.findById(sale.winner).select('firstName lastName email companyName siret address stampUrl').lean(),
  ]);
  // Le dossier reste figé tant qu'il manque un tampon : chaque partie voit une bannière.
  if (!seller?.stampUrl || !buyer?.stampUrl) return false;

  // Les tampons sont apposés à part, à des emplacements qui laissent la place aux signatures.
  const parties = { seller: { ...seller, stampUrl: null }, buyer: { ...buyer, stampUrl: null } };
  const transferredAt = sale.transferConfirmedAt || new Date();
  const [certificate, declaration] = await Promise.all([
    fillCertificateOfTransfer({ vehicle, ...parties, transferredAt }),
    fillPurchaseDeclaration({ vehicle, ...parties, purchasedAt: transferredAt }),
  ]);
  const stamps = { sellerStampUrl: seller.stampUrl, buyerStampUrl: buyer.stampUrl };
  const [stampedCertificate, stampedDeclaration] = await Promise.all([
    saleDocuments.stampDocument({ buffer: certificate, document: 'certificate', ...stamps }),
    saleDocuments.stampDocument({ buffer: declaration, document: 'purchaseDeclaration', ...stamps }),
  ]);
  const [storedCertificate, storedDeclaration] = await Promise.all([
    saveBuffer({ buffer: stampedCertificate, filename: `ventes/certificats/${sale._id}_certificat-cession.pdf`, contentType: 'application/pdf' }),
    saveBuffer({ buffer: stampedDeclaration, filename: `ventes/declarations/${sale._id}_declaration-achat.pdf`, contentType: 'application/pdf' }),
  ]);

  const now = new Date();
  const documentOf = (stored) => ({ url: stored.url, filename: stored.filename, source: 'generated', generatedAt: now, updatedAt: now });
  // Mise à jour conditionnelle : un dépôt de tampon et la tâche de fond peuvent arriver ensemble.
  const result = await Sale.updateOne(
    { _id: sale._id, status: 'en_cours', currentStep: STEP.VERIFICATION, 'documentsReview.version': { $in: [0, null] } },
    {
      $set: {
        certificate: documentOf(storedCertificate),
        purchaseDeclaration: documentOf(storedDeclaration),
        'documentsReview.version': 1,
        'documentsReview.correctionOpen': false,
        'documentsReview.seller': null,
        'documentsReview.buyer': null,
      },
    },
  );
  if (result.modifiedCount !== 1) return false;

  const recipients = triggeredBy ? [triggeredBy === 'seller' ? 'buyer' : 'seller'] : ['seller', 'buyer'];
  await notifyDocumentsEvent(sale, 'ready', recipients);
  return true;
};

/** Un tampon vient d'être déposé : génère les documents des ventes qui n'attendaient que lui. */
const prepareDocumentsForUser = async (userId) => {
  const sales = await Sale.find({
    status: 'en_cours',
    currentStep: STEP.VERIFICATION,
    'documentsReview.version': { $in: [0, null] },
    $or: [{ seller: userId }, { winner: userId }],
  }).select('_id seller').lean();

  for (const sale of sales) {
    try {
      await prepareSaleDocuments(sale._id, { triggeredBy: String(sale.seller) === String(userId) ? 'seller' : 'buyer' });
    } catch (error) {
      console.error(`Génération des documents impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
};

const REVIEW_DOCUMENTS = ['certificate', 'purchaseDeclaration'];

/**
 * Étape 3.2 : une partie valide les documents ou signale une erreur. Un signalement ouvre la
 * correction : chaque partie peut alors redéposer chaque document. Dès que les deux parties
 * ont validé la même version, la vente passe à la signature électronique (3.3).
 */
const reviewDocuments = async ({ saleId, userId, decision, reason, comment }) => {
  if (!['valide', 'erreur'].includes(decision)) throw saleError('Avis invalide.', 'sale.review_invalid', 400);
  const note = typeof comment === 'string' ? comment.trim().slice(0, 1000) : '';
  if (decision === 'erreur' && !Sale.DOCUMENT_REPORT_REASONS.includes(reason)) {
    throw saleError("Choisissez le motif de l'erreur.", 'sale.report_reason_required', 400);
  }
  if (decision === 'erreur' && reason === 'autre' && !note) {
    throw saleError("Précisez l'erreur constatée.", 'sale.report_comment_required', 400);
  }

  const { sale, side } = await loadPartySale(saleId, userId, STEP.VERIFICATION, "Les documents ne sont pas à l'étape de vérification.");
  const version = sale.documentsReview?.version || 0;
  if (version === 0) throw saleError('Les documents ne sont pas encore prêts.', 'sale.documents_not_ready', 409);

  const isReport = decision === 'erreur';
  sale.documentsReview[side] = {
    decision,
    reason: isReport ? reason : null,
    comment: isReport ? (note || null) : null,
    decidedAt: new Date(),
  };
  if (isReport) sale.documentsReview.correctionOpen = true;
  sale.documentsReview.history.push({
    type: decision, by: side, reason: isReport ? reason : null, comment: isReport ? (note || null) : null, version,
  });
  await sale.save();

  if (isReport) {
    await notifyDocumentsEvent(sale, 'reported', [side === 'seller' ? 'buyer' : 'seller'], { by: side, reason, comment: note });
    return { side };
  }

  // Passage conditionnel à la signature : une seule fois, même si les deux parties valident
  // au même instant, et seulement pour la version qu'elles ont toutes deux vérifiée.
  const now = new Date();
  const claim = await Sale.updateOne(
    {
      _id: sale._id,
      status: 'en_cours',
      currentStep: STEP.VERIFICATION,
      'documentsReview.version': version,
      'documentsReview.seller.decision': 'valide',
      'documentsReview.buyer.decision': 'valide',
    },
    { $set: { currentStep: STEP.SIGNATURE, currentStepStartedAt: now, currentStepDueAt: null, stepRemindersSent: [] } },
  );
  if (claim.modifiedCount === 1) {
    try {
      await startSignature(sale._id);
    } catch (error) {
      // La vente est déjà à l'étape 3.3 : la tâche de fond relancera la création de la session.
      console.error(`Lancement de la signature impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
  return { side };
};

/**
 * Étape 3.2, après un signalement : une partie redépose une version corrigée d'un document.
 * Elle remplace la précédente et les deux parties doivent de nouveau vérifier.
 */
const uploadReviewDocument = async ({ saleId, userId, document, url, filename }) => {
  if (!REVIEW_DOCUMENTS.includes(document)) throw saleError('Document inconnu.', 'sale.document_unknown', 400);
  const documentUrl = typeof url === 'string' ? url.trim() : '';
  if (!saleDocuments.isPlatformStorageUrl(documentUrl)) {
    throw saleError('Le document doit être déposé sur la plateforme.', 'sale.document_missing', 400);
  }

  const { sale, side } = await loadPartySale(saleId, userId, STEP.VERIFICATION, "Les documents ne sont pas à l'étape de vérification.");
  if (!sale.documentsReview?.correctionOpen) {
    throw saleError("Un document ne peut être redéposé qu'après le signalement d'une erreur.", 'sale.correction_closed', 409);
  }

  // Le document part ensuite à la signature : il doit être un PDF exploitable.
  await saleDocuments.countPages(await saleDocuments.downloadPdf(documentUrl));

  const version = (sale.documentsReview.version || 0) + 1;
  sale[document] = {
    url: documentUrl,
    filename: typeof filename === 'string' ? filename : null,
    source: side,
    generatedAt: sale[document]?.generatedAt || null,
    updatedAt: new Date(),
  };
  sale.documentsReview.version = version;
  sale.documentsReview.seller = null;
  sale.documentsReview.buyer = null;
  sale.documentsReview.history.push({ type: 'depot', by: side, document, url: documentUrl, version });
  await sale.save();

  await notifyDocumentsEvent(sale, 'uploaded', [side === 'seller' ? 'buyer' : 'seller'], { by: side, document });
  return { side };
};

// Au-delà, une création de session ou une finalisation interrompue peut être reprise
const LEASE_MS = 5 * 60 * 1000;

/**
 * Étape 3.3 : envoie à OpenAPI le dossier regroupant les deux documents validés (certificat puis
 * déclaration), puis transmet à chaque partie son lien de signature. Le verrou posé sur
 * `esignature.initiatedAt` empêche la tâche de fond de créer une seconde session en parallèle.
 */
const startSignature = async (saleId) => {
  const now = new Date();
  const lease = await Sale.findOneAndUpdate(
    {
      _id: saleId,
      status: 'en_cours',
      currentStep: STEP.SIGNATURE,
      'esignature.operationId': { $in: [null, ''] },
      $or: [{ 'esignature.initiatedAt': null }, { 'esignature.initiatedAt': { $lt: new Date(now.getTime() - LEASE_MS) } }],
    },
    { $set: { 'esignature.initiatedAt': now } },
    { returnDocument: 'after' },
  );
  if (!lease) return null;

  const [certificateBuffer, declarationBuffer] = await Promise.all([
    saleDocuments.downloadPdf(lease.certificate.url),
    saleDocuments.downloadPdf(lease.purchaseDeclaration.url),
  ]);
  const certificatePageCount = await saleDocuments.countPages(certificateBuffer);
  const bundleBuffer = await saleDocuments.mergePdfs([certificateBuffer, declarationBuffer]);

  const [seller, buyer, vehicle] = await Promise.all([
    User.findById(lease.seller).select('_id email firstName lastName companyName language').lean(),
    User.findById(lease.winner).select('_id email firstName lastName companyName language').lean(),
    VehicleDossier.findById(lease.vehicle).select('brand model').lean(),
  ]);

  let session;
  try {
    session = await createSignatureSession({
      saleId: String(lease._id),
      seller,
      buyer,
      bundleBuffer,
      declarationFirstPage: certificatePageCount + 1,
    });
  } catch (error) {
    // Libère le verrou (la prochaine tentative n'attend pas son expiration) et garde la trace de
    // l'échec : sans elle, les parties attendraient un lien qui ne vient pas.
    await Sale.updateOne({ _id: lease._id, 'esignature.initiatedAt': now }, {
      $set: { 'esignature.initiatedAt': null, 'esignature.setupError': error.message, 'esignature.setupErrorAt': new Date() },
    });
    throw error;
  }

  // Les signataires sont envoyés vendeur puis acheteur : la position sert de repli.
  const signerOf = (user, position) => session.signers?.find((signer) => signer.email === user.email) || session.signers?.[position];
  const sellerUrl = signerOf(seller, 0)?.url || null;
  const buyerUrl = signerOf(buyer, 1)?.url || null;

  await Sale.updateOne({ _id: lease._id }, {
    $set: {
      'esignature.operationId': session.id,
      'esignature.status': session.state || 'WAIT_VALIDATION',
      'esignature.sellerUrl': sellerUrl,
      'esignature.buyerUrl': buyerUrl,
      'esignature.certificatePageCount': certificatePageCount,
      'esignature.sellerSignedAt': null,
      'esignature.buyerSignedAt': null,
      'esignature.setupError': null,
      'esignature.setupErrorAt': null,
    },
  });

  // Le second à valider est sur la vente et y trouve le bouton de signature : seul le premier,
  // qui attendait l'autre partie, est invité par e-mail à venir signer.
  const sellerDecidedAt = lease.documentsReview?.seller?.decidedAt;
  const buyerDecidedAt = lease.documentsReview?.buyer?.decidedAt;
  const firstValidator = sellerDecidedAt && buyerDecidedAt && buyerDecidedAt < sellerDecidedAt ? 'buyer' : 'seller';
  if (firstValidator === 'seller' && sellerUrl) await notifySignatureReady(seller, 'seller', sellerUrl, vehicle, lease);
  if (firstValidator === 'buyer' && buyerUrl) await notifySignatureReady(buyer, 'buyer', buyerUrl, vehicle, lease);
  return session.id;
};

/**
 * Filet de sécurité de l'étape 3 : génère les documents qui n'attendaient plus qu'un tampon
 * (dépôt fait sans passer par la mise à jour du tampon, échec ponctuel du stockage) et relance
 * les signatures dont la création de session a échoué.
 */
const reconcilePendingDocuments = async () => {
  const [awaitingDocuments, awaitingSignature] = await Promise.all([
    Sale.find({ status: 'en_cours', currentStep: STEP.VERIFICATION, 'documentsReview.version': { $in: [0, null] } }).select('_id').lean(),
    Sale.find({ status: 'en_cours', currentStep: STEP.SIGNATURE, 'esignature.operationId': { $in: [null, ''] } }).select('_id').lean(),
  ]);
  for (const sale of awaitingDocuments) {
    try {
      await prepareSaleDocuments(sale._id);
    } catch (error) {
      console.error(`Génération des documents impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
  for (const sale of awaitingSignature) {
    try {
      await startSignature(sale._id);
    } catch (error) {
      console.error(`Lancement de la signature impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
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
  buyer.suspension = {
    note: SUSPENSION_NOTES.commission_impayee,
    source: 'system',
    reason: 'commission_impayee',
    date: new Date(),
  };
  await buyer.save();

  // On passe la vente courante et toutes les autres ventes en cours à l'étape 1 ou 2 au candidat suivant
  await promoteNextBidder(sale._id, 'annulation_volontaire');
  await revokeOngoingSalesForSuspendedBuyer(buyer._id, 'annulation_volontaire');
  await withdrawSuspendedSellerVehicles(buyer._id);

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

const FORCE_END_SUSPENSION_NOTE = "Suspendu lors de la fin forcée d'une vente par l'administration.";

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
      // Renseigne l'historique de suspension du compte (voir user.model.js)
      buyer.suspension = { source: 'admin', reason: 'admin', note: FORCE_END_SUSPENSION_NOTE, date: new Date() };
      await buyer.save();
      await revokeOngoingSalesForSuspendedBuyer(buyer._id, 'suspension_admin');
      await withdrawSuspendedSellerVehicles(buyer._id);
    }
  }

  if (suspendSeller && sale.seller) {
    const seller = await User.findById(sale.seller);
    if (seller) {
      seller.status = 'suspendu';
      seller.suspension = { source: 'admin', reason: 'admin', note: FORCE_END_SUSPENSION_NOTE, date: new Date() };
      await seller.save();
      await withdrawSuspendedSellerVehicles(seller._id);
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
 * Étape 3.3 terminée : archive le dossier signé, en extrait une copie de chaque document pour
 * la consultation, génère le bon d'enlèvement et clôture la vente. Le verrou posé sur
 * `esignature.finalizingAt` évite une double clôture quand le webhook et la tâche de fond
 * constatent la fin de la signature en même temps.
 */
const finalizeSignature = async (saleId, signatureId) => {
  const existing = await Sale.findById(saleId).select('status currentStep esignature.operationId').lean();
  if (!existing) throw saleError('Vente introuvable.', 'sale.not_found', 404);
  if (existing.status !== 'en_cours' || existing.currentStep !== STEP.SIGNATURE) {
    console.warn(`La vente ${saleId} n'attend plus de signature. Ignoré.`);
    return existing;
  }
  if (!existing.esignature?.operationId || String(existing.esignature.operationId) !== String(signatureId)) {
    throw saleError('La signature reçue ne correspond pas à cette vente.', 'sale.esignature_mismatch', 403);
  }

  const now = new Date();
  const sale = await Sale.findOneAndUpdate(
    {
      _id: saleId,
      status: 'en_cours',
      currentStep: STEP.SIGNATURE,
      $or: [{ 'esignature.finalizingAt': null }, { 'esignature.finalizingAt': { $lt: new Date(now.getTime() - LEASE_MS) } }],
    },
    { $set: { 'esignature.finalizingAt': now } },
    { returnDocument: 'after' },
  );
  if (!sale) return existing;

  try {
    const signedPdfBuffer = Buffer.from(await fetchSignedDocument(signatureId));
    const folder = `ventes/documents/${saleId}`;
    const signedBundle = await saveBuffer({ buffer: signedPdfBuffer, filename: `${folder}/dossier-signe.pdf`, contentType: 'application/pdf' });

    let auditStored = null;
    try {
      const auditBuffer = await fetchAuditTrail(signatureId);
      auditStored = await saveBuffer({ buffer: auditBuffer, filename: `${folder}/audit-signature.pdf`, contentType: 'application/pdf' });
    } catch (auditError) {
      console.error(`Archivage de la piste d'audit impossible (vente ${saleId}) : ${auditError.message}`);
    }

    // Copies de consultation : la signature électronique ne vaut que pour le dossier complet.
    let signedCertificate = null;
    let signedDeclaration = null;
    try {
      const split = sale.esignature?.certificatePageCount || 1;
      const [certificateCopy, declarationCopy] = await Promise.all([
        saleDocuments.extractPages(signedPdfBuffer, 0, split),
        saleDocuments.extractPages(signedPdfBuffer, split),
      ]);
      [signedCertificate, signedDeclaration] = await Promise.all([
        saveBuffer({ buffer: certificateCopy, filename: `${folder}/certificat-cession-signe.pdf`, contentType: 'application/pdf' }),
        saveBuffer({ buffer: declarationCopy, filename: `${folder}/declaration-achat-signee.pdf`, contentType: 'application/pdf' }),
      ]);
    } catch (splitError) {
      console.error(`Copies des documents signés impossibles (vente ${saleId}) : ${splitError.message}`);
    }

    const [vehicle, seller, buyer] = await Promise.all([
      VehicleDossier.findById(sale.vehicle)
        .select('brand model year mileage vin registrationNumber vehicleAddress vehicleAddressDetails')
        .lean(),
      User.findById(sale.seller).select('firstName lastName companyName siret address phone').lean(),
      User.findById(sale.winner).select('firstName lastName companyName siret address phone').lean(),
    ]);
    const bon = await generateBonEnlevement(sale, vehicle, seller, buyer);

    sale.esignature.status = 'DONE';
    sale.esignature.signedDocumentUrl = signedBundle.url;
    sale.esignature.signedDocumentFilename = signedBundle.filename;
    sale.esignature.signedCertificateUrl = signedCertificate?.url || null;
    sale.esignature.signedPurchaseDeclarationUrl = signedDeclaration?.url || null;
    sale.esignature.auditUrl = auditStored?.url || null;
    sale.esignature.auditFilename = auditStored?.filename || null;
    sale.esignature.completedAt = now;
    sale.bonEnlevement = { url: bon.url, filename: bon.filename, generatedAt: now };
    sale.status = 'cloturee';
    sale.closedAt = now;
    sale.currentStepDueAt = null;
    sale.stepRemindersSent = [];
    await sale.save();
  } catch (error) {
    // Libère le verrou : la tâche de fond retentera sans attendre son expiration.
    await Sale.updateOne({ _id: saleId, 'esignature.finalizingAt': now }, { $set: { 'esignature.finalizingAt': null } });
    console.error(`Erreur lors de la finalisation de la signature (vente ${saleId}) :`, error.message);
    throw error;
  }

  await notifySaleClosed(sale);
  console.log(`Signature finalisée pour la vente ${saleId} : vente clôturée.`);
  return sale;
};

/**
 * Première signature : aucun e-mail. Le premier signataire le sera à la clôture, et le second
 * a déjà été invité à signer (ou est sur la vente). Le vendeur garde une notification interne
 * quand c'est l'acheteur qui a signé en premier.
 */
const notifyFirstSignature = async (sale, signedSide) => {
  if (signedSide !== 'buyer') return;
  try {
    const vehicle = await VehicleDossier.findById(sale.vehicle).select('brand model').lean();
    await notifySellerInApp(sale.seller, 'signature_your_turn', 'À vous de signer', 'L’acheteur a signé les documents. Il ne manque plus que votre signature.', sale, vehicle);
  } catch (error) {
    console.error(`Notification de première signature impossible (vente ${sale._id}) : ${error.message}`);
  }
};

/**
 * Relit l'avancement de la signature électronique (étape 3.3) sur OpenAPI : enregistre qui a déjà
 * signé, garde la trace de la première signature, et finalise la vente dès que les deux
 * ont signé.
 */
const refreshSignatureProgress = async (saleId) => {
  const sale = await Sale.findById(saleId).select('seller winner vehicle status currentStep esignature').lean();
  if (!sale || sale.status !== 'en_cours' || sale.currentStep !== STEP.SIGNATURE || !sale.esignature?.operationId) return;

  const operationId = sale.esignature.operationId;
  const { state, signers } = await fetchSignatureProgress(operationId);
  if (state === 'DONE') {
    await finalizeSignature(sale._id, operationId);
    return;
  }

  const [seller, buyer] = await Promise.all([
    User.findById(sale.seller).select('email').lean(),
    User.findById(sale.winner).select('email').lean(),
  ]);
  // Les signataires sont envoyés vendeur puis acheteur : la position sert de repli si l'adresse
  // du compte a changé depuis la création de la session.
  const signerOf = (user, position) =>
    signers.find((signer) => user?.email && signer.email === user.email.trim().toLowerCase()) || signers[position];

  const justSigned = [];
  for (const [side, user, position] of [['seller', seller, 0], ['buyer', buyer, 1]]) {
    const field = `esignature.${side}SignedAt`;
    if (sale.esignature[`${side}SignedAt`] || !signerOf(user, position)?.signed) continue;
    // Mise à jour conditionnelle : le webhook, la tâche de fond et le retour navigateur peuvent
    // constater la même signature en même temps, une seule notification doit partir.
    const result = await Sale.updateOne(
      { _id: sale._id, currentStep: STEP.SIGNATURE, 'esignature.operationId': operationId, [field]: null },
      { $set: { [field]: new Date() } },
    );
    if (result.modifiedCount === 1) justSigned.push(side);
  }

  // Si les deux signatures arrivent ensemble, la finalisation se charge des notifications.
  const otherAlreadySigned = justSigned.length === 1
    && sale.esignature[`${justSigned[0] === 'seller' ? 'buyer' : 'seller'}SignedAt`];
  if (justSigned.length === 1 && !otherAlreadySigned) {
    await notifyFirstSignature(sale, justSigned[0]);
  }
};

/**
 * Appelé par la page de vente au retour de la plateforme de signature (étape 3.3) (et quand l'onglet reprend
 * le focus) : relit l'avancement sans attendre le webhook ni la tâche de fond, et indique de
 * quel côté de la vente se trouve l'utilisateur pour le rediriger vers la bonne page.
 */
const syncSignatureForUser = async (saleId, userId) => {
  const sale = mongoose.isValidObjectId(saleId)
    ? await Sale.findOne({ _id: saleId, $or: [{ seller: userId }, { winner: userId }] }).select('seller').lean()
    : null;
  if (!sale) {
    const err = new Error('Vente introuvable.');
    err.codeName = 'sale.not_found';
    err.statusCode = 404;
    throw err;
  }

  try {
    await refreshSignatureProgress(sale._id);
  } catch (error) {
    // OpenAPI indisponible : la page affiche l'état connu, la tâche de fond reprendra.
    console.error(`Relecture de la signature impossible (vente ${sale._id}) : ${error.message}`);
  }
  return { side: String(sale.seller) === String(userId) ? 'seller' : 'buyer' };
};

/**
 * Rattrape les signatures électroniques terminées dont le webhook OpenAPI n'est jamais arrivé.
 * Sans ce filet, l'étape 3 ne pouvait avancer que par le webhook : s'il se perd, ou s'il ne peut
 * pas joindre le serveur (APP_BASE_URL en localhost pendant le développement), la vente restait
 * bloquée alors que les deux parties avaient signé. Même principe que
 * reconcilePendingCommissionPayments pour les paiements. Relève aussi la première signature
 * pour prévenir l'autre partie.
 */
const reconcilePendingSignatures = async () => {
  const sales = await Sale.find({
    status: 'en_cours',
    currentStep: STEP.SIGNATURE,
    'esignature.operationId': { $nin: [null, ''] },
  }).select('_id').lean();

  for (const sale of sales) {
    try {
      await refreshSignatureProgress(sale._id);
    } catch (error) {
      console.error(`Vérification de la signature impossible (vente ${sale._id}) : ${error.message}`);
    }
  }
};

module.exports = {
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
  acceptSellerOffer,
  relistSuspendedVehicle,
  confirmTransferReceived,
  submitRegistrationCard,
  prepareDocumentsForUser,
  reviewDocuments,
  uploadReviewDocument,
  reconcilePendingDocuments,
  cancelSaleByBuyer,
  toggleSaleTimer,
  forceEndSale,
  extendCurrentStepDeadline,
  revokeOngoingSalesForSuspendedBuyer,
  withdrawSuspendedSellerVehicles,
  finalizeSignature,
  refreshSignatureProgress,
  syncSignatureForUser,
  reconcilePendingSignatures,
};
