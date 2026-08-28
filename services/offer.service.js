const mongoose = require('mongoose');
const Offer = require('../models/offer.model');
const Session = require('../models/session.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const commissionService = require('./commission.service');
const taxService = require('./tax.service');

const OPEN_SESSION_STATUSES = ['open', 'active'];

const offerError = (message, codeName, statusCode) => {
  const err = new Error(message);
  err.codeName = codeName;
  if (statusCode) err.statusCode = statusCode;
  return err;
};

const roundToCents = (value) => Math.round(value * 100) / 100;

/**
 * Charger le véhicule et sa session, en refusant tout ce sur quoi on ne peut pas enchérir :
 * dossier non validé, véhicule sans session, ou session qui n'est plus ouverte.
 */
const loadBiddableVehicle = async (vehicleId) => {
  if (!mongoose.isValidObjectId(vehicleId)) {
    throw offerError('Véhicule introuvable.', 'offer.vehicle_not_found', 404);
  }

  const vehicle = await VehicleDossier.findOne({ _id: vehicleId, status: 'valide' })
    .select('brand model session status')
    .lean();

  if (!vehicle || !vehicle.session) {
    throw offerError('Véhicule introuvable.', 'offer.vehicle_not_found', 404);
  }

  const session = await Session.findOne({ _id: vehicle.session, status: { $in: OPEN_SESSION_STATUSES } })
    .select('name startDate endDate status commission')
    .lean();

  if (!session) {
    throw offerError("Ce véhicule n'est pas dans une session ouverte aux offres.", 'offer.session_closed');
  }

  // Une session peut être encore marquée ouverte entre deux synchronisations de statut
  if (session.endDate && new Date(session.endDate) <= new Date()) {
    throw offerError('La session est clôturée, les offres ne sont plus acceptées.', 'offer.session_closed');
  }

  return { vehicle, session };
};

const parseAmount = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw offerError('Le montant de votre offre doit être un nombre supérieur à 0.', 'offer.invalid_amount');
  }
  return roundToCents(numericAmount);
};

/**
 * Détail des frais supplémentaires appliqués à une offre : commission de la session
 * (barème propre à la session ou barème par défaut) puis taxe calculée sur la seule
 * commission — jamais sur le prix proposé par l'acheteur.
 */
const quoteOffer = async ({ vehicleId, amount }) => {
  const { vehicle, session } = await loadBiddableVehicle(vehicleId);
  const numericAmount = parseAmount(amount);

  const { commission, tier } = await commissionService.calculateSessionCommission(session, numericAmount);
  const tax = await taxService.getPlatformTax();
  const taxAmount = roundToCents((commission * tax.rate) / 100);

  return {
    vehicle: {
      id: String(vehicle._id),
      brand: vehicle.brand || '',
      model: vehicle.model || '',
    },
    session: {
      id: String(session._id),
      name: session.name,
      endDate: session.endDate,
    },
    amount: numericAmount,
    commission,
    commissionTier: tier ? {
      minAmount: tier.minAmount,
      maxAmount: tier.maxAmount ?? null,
      type: tier.type,
      value: tier.value,
    } : null,
    taxName: tax.name,
    taxRate: tax.rate,
    taxAmount,
    total: roundToCents(numericAmount + commission + taxAmount),
  };
};

/**
 * Créer l'offre après approbation du récapitulatif des frais par l'acheteur.
 * Les frais sont recalculés côté serveur : le devis affiché n'est jamais pris pour argent comptant.
 */
const createOffer = async ({ vehicleId, amount, buyer }) => {
  if (!buyer || buyer.role !== 'acheteur') {
    throw offerError('Seuls les acheteurs peuvent déposer une offre.', 'offer.forbidden_role', 403);
  }
  if (buyer.status !== 'valide') {
    throw offerError('Votre compte acheteur doit être validé pour déposer une offre.', 'offer.buyer_not_validated', 403);
  }

  const quote = await quoteOffer({ vehicleId, amount });

  // Une seule offre active par acheteur et par véhicule dans une session donnée : une
  // deuxième mise se fait en modifiant la première, jamais en empilant les offres.
  const existing = await Offer.findOne({
    vehicle: quote.vehicle.id,
    session: quote.session.id,
    buyer: buyer._id,
    status: 'active',
  }).select('_id');

  if (existing) {
    throw offerError(
      'Vous avez déjà déposé une offre sur ce véhicule. Modifiez-la depuis vos offres.',
      'offer.already_exists',
      409,
    );
  }

  const offer = await Offer.create({
    vehicle: quote.vehicle.id,
    session: quote.session.id,
    buyer: buyer._id,
    amount: quote.amount,
    fees: {
      commission: quote.commission,
      commissionTier: quote.commissionTier || undefined,
      taxName: quote.taxName,
      taxRate: quote.taxRate,
      taxAmount: quote.taxAmount,
      total: quote.total,
    },
  });

  return { offer, quote };
};

/**
 * Une offre est « en cours » tant qu'elle est active et que sa session accepte encore
 * des offres ; sinon elle bascule dans l'historique (session clôturée ou offre annulée).
 */
const isOngoing = (offer) => {
  if (offer.status !== 'active') return false;
  const session = offer.session;
  if (!session || !OPEN_SESSION_STATUSES.includes(session.status)) return false;
  return !session.endDate || new Date(session.endDate) > new Date();
};

const serializeOffer = (offer) => {
  const vehicle = offer.vehicle;
  const session = offer.session;
  const coverPhoto = vehicle && (vehicle.photos || []).find((photo) => photo.isCover) || vehicle?.photos?.[0];

  return {
    id: String(offer._id),
    amount: offer.amount,
    fees: offer.fees,
    status: offer.status,
    ongoing: isOngoing(offer),
    revisionCount: (offer.revisions || []).length,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    cancelledAt: offer.cancelledAt || null,
    vehicle: vehicle ? {
      id: String(vehicle._id),
      brand: vehicle.brand || '',
      model: vehicle.model || '',
      photoUrl: coverPhoto ? (coverPhoto.processedUrl || coverPhoto.originalUrl) : null,
    } : null,
    session: session ? {
      id: String(session._id),
      name: session.name,
      endDate: session.endDate,
      status: session.status,
    } : null,
  };
};

/**
 * Offres d'un acheteur, de la plus récente à la plus ancienne, séparées en offres
 * en cours (modifiables/annulables) et offres passées.
 */
const listBuyerOffers = async (buyerId) => {
  const offers = await Offer.find({ buyer: buyerId })
    .populate('vehicle', 'brand model photos')
    .populate('session', 'name endDate status')
    .sort({ createdAt: -1 })
    .lean();

  const serialized = offers.map(serializeOffer);
  return {
    ongoing: serialized.filter((offer) => offer.ongoing),
    past: serialized.filter((offer) => !offer.ongoing),
  };
};

/**
 * Charger une offre modifiable : elle doit appartenir à l'acheteur, être encore active
 * et porter sur une session qui accepte toujours les offres.
 */
const loadEditableOffer = async (offerId, buyerId) => {
  if (!mongoose.isValidObjectId(offerId)) {
    throw offerError('Offre introuvable.', 'offer.not_found', 404);
  }

  const offer = await Offer.findOne({ _id: offerId, buyer: buyerId }).populate('session', 'name endDate status');
  if (!offer) {
    throw offerError('Offre introuvable.', 'offer.not_found', 404);
  }
  if (offer.status !== 'active') {
    throw offerError('Cette offre a été annulée et ne peut plus être modifiée.', 'offer.not_active');
  }

  const session = offer.session;
  const stillOpen = session
    && OPEN_SESSION_STATUSES.includes(session.status)
    && (!session.endDate || new Date(session.endDate) > new Date());

  if (!stillOpen) {
    throw offerError('La session est clôturée : votre offre ne peut plus être modifiée.', 'offer.session_closed');
  }

  return offer;
};

/**
 * Modifier le montant d'une offre : mêmes règles de calcul qu'à la création, les frais
 * sont recalculés sur le barème courant de la session et l'ancien montant est archivé.
 */
const updateOffer = async ({ offerId, buyerId, amount }) => {
  const offer = await loadEditableOffer(offerId, buyerId);
  const quote = await quoteOffer({ vehicleId: String(offer.vehicle), amount });

  offer.revisions.push({ amount: offer.amount, fees: offer.fees, replacedAt: new Date() });
  offer.amount = quote.amount;
  offer.fees = {
    commission: quote.commission,
    commissionTier: quote.commissionTier || undefined,
    taxName: quote.taxName,
    taxRate: quote.taxRate,
    taxAmount: quote.taxAmount,
    total: quote.total,
  };
  await offer.save();

  return { offer, quote };
};

const cancelOffer = async ({ offerId, buyerId }) => {
  const offer = await loadEditableOffer(offerId, buyerId);
  offer.status = 'annulee';
  offer.cancelledAt = new Date();
  await offer.save();
  return offer;
};

module.exports = {
  quoteOffer,
  createOffer,
  listBuyerOffers,
  updateOffer,
  cancelOffer,
};
