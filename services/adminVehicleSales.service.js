const VehicleDossier = require('../models/vehicleDossier.model');
const User = require('../models/user.model');
const Offer = require('../models/offer.model');
const Sale = require('../models/sale.model');
const Session = require('../models/session.model');
const mongoose = require('mongoose');
const generalConfigService = require('./generalConfig.service');
const { buildBuyerOfferHistory } = require('../utils/offerHistory');
const { findCriticalSales } = require('../utils/criticalSales');

/**
 * Suivi commercial des véhicules validés, côté administration.
 *
 * Un véhicule validé traverse quatre états, déduits — et non stockés — de sa session et de
 * sa vente. Les stocker en double exposerait à des désynchronisations : c'est la session et
 * la vente qui font foi.
 *
 *   en_attente     validé, rattaché à aucune session : en attente d'affectation
 *   en_enchere     rattaché à une session non close (à venir, ouverte ou active)
 *   decision_vendeur offres sous la réserve après clôture : décision du vendeur attendue
 *   en_cours_vente une vente est en cours (gagnant désigné, procédure d'achat en cours)
 *   vendu          la vente est clôturée
 *
 * L'ordre de priorité compte : une vente prime toujours sur l'état de la session, car un
 * véhicule attribué reste rattaché à la session qui l'a vendu.
 */
const SALE_STATES = ['en_attente', 'en_enchere', 'decision_vendeur', 'en_cours_vente', 'vendu'];

// Statuts de session qui n'acceptent plus d'offres : un véhicule qui y reste rattaché
// n'est plus « en enchère ».
const FINISHED_SESSION_STATUSES = ['closed', 'cloturee', 'annulee'];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Champs libres filtrables par simple sous-chaîne, insensible à la casse. */
const TEXT_FIELDS = [
  'brand', 'model', 'registrationNumber', 'registrationCountry', 'procedure', 'co2',
  'energyLabel', 'fuelType', 'vehicleGenre', 'fiscalPower', 'bodyType', 'vin', 'gearbox',
  'color', 'vrade', 'engine', 'firstRegistrationDate', 'passengerCount', 'doorCount',
  'policeBookNumber', 'description', 'conditionDetails', 'vehicleAddress',
  'vehicleCity', 'vehiclePostalCode', 'registrationCardMissingReasons',
];

// Colonnes dont le nom d'affichage diffère du chemin réel dans le document.
const COLUMN_PATHS = {
  vehicleCity: 'vehicleAddressDetails.city',
  vehiclePostalCode: 'vehicleAddressDetails.postalCode',
};

// Champs volumineux ou internes, sans intérêt dans un tableau : les transporter
// multiplierait le poids de la réponse sans rien afficher de plus.
const HEAVY_FIELDS = [
  'photos', 'expertReport', 'additionalDocuments', 'refusals',
  'sessionDoc', 'saleSessionDoc', 'effectiveSessionDoc', 'saleDoc', 'offerStats', '__v',
];

const parseColumnFilters = (raw) => {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
};

/**
 * Construit le `$match` initial sur le dossier véhicule. Seuls les véhicules validés
 * entrent dans ce suivi : un dossier en attente de validation n'a pas d'existence commerciale.
 */
const buildDossierMatch = async (columnFilters) => {
  const match = { status: 'valide' };

  for (const field of TEXT_FIELDS) {
    if (columnFilters[field]) {
      match[COLUMN_PATHS[field] || field] = new RegExp(escapeRegExp(columnFilters[field]), 'i');
    }
  }

  if (columnFilters.year && Number.isFinite(Number(columnFilters.year))) {
    match.year = Number(columnFilters.year);
  }
  if (columnFilters.mileage && Number.isFinite(Number(columnFilters.mileage))) {
    match.mileage = Number(columnFilters.mileage);
  }
  for (const flag of ['registrationCardAvailable', 'identificationSheetAvailable']) {
    if (columnFilters[flag] === 'true') match[flag] = true;
    if (columnFilters[flag] === 'false') match[flag] = false;
  }

  if (columnFilters.reservePrice && Number.isFinite(Number(columnFilters.reservePrice))) {
    match.reservePrice = Number(columnFilters.reservePrice);
  }
  if (columnFilters.listingCount && Number.isFinite(Number(columnFilters.listingCount))) {
    match.listingCount = Number(columnFilters.listingCount);
  }
  if (columnFilters.lotNumber && Number.isFinite(Number(columnFilters.lotNumber))) {
    match.lotNumber = Number(columnFilters.lotNumber);
  }

  if (columnFilters.submittedAt) {
    const start = new Date(`${columnFilters.submittedAt}T00:00:00.000Z`);
    const end = new Date(`${columnFilters.submittedAt}T23:59:59.999Z`);
    if (!Number.isNaN(start.getTime())) match.submittedAt = { $gte: start, $lte: end };
  }

  // Carte « Véhicules invendus » : tentatives de mise en vente épuisées (même seuil que le tableau de bord)
  if (columnFilters.maxedOut === 'true') {
    const config = await generalConfigService.getConfig();
    match.listingCount = { $gte: Number(config?.vehicleListingAttempts) || 3 };
  }

  if (columnFilters.seller) {
    const sellerRegex = new RegExp(escapeRegExp(columnFilters.seller), 'i');
    const sellerIds = await User.find({
      $or: [{ companyName: sellerRegex }, { firstName: sellerRegex }, { lastName: sellerRegex }],
    }).distinct('_id');
    match.seller = { $in: sellerIds };
  }

  return match;
};

/**
 * Étapes communes au comptage et à la page de résultats : jointure de la session et de la
 * vente la plus récente, puis calcul de l'état commercial.
 */
const enrichmentStages = () => [
  {
    $lookup: {
      from: 'sessions',
      localField: 'session',
      foreignField: '_id',
      as: 'sessionDoc',
    },
  },
  { $unwind: { path: '$sessionDoc', preserveNullAndEmptyArrays: true } },
  {
    // La vente la plus récente porte l'état courant : un véhicule invendu puis republié
    // possède plusieurs ventes, seule la dernière décrit sa situation.
    $lookup: {
      from: 'sales',
      let: { vehicleId: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$vehicle', '$$vehicleId'] } } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
      ],
      as: 'saleDoc',
    },
  },
  { $unwind: { path: '$saleDoc', preserveNullAndEmptyArrays: true } },
  {
    // Certaines ventes sous réserve créées avant le correctif ont conservé leur session sur
    // la vente, mais plus sur le dossier véhicule. Cette jointure garde leur historique lisible.
    $lookup: {
      from: 'sessions',
      localField: 'saleDoc.session',
      foreignField: '_id',
      as: 'saleSessionDoc',
    },
  },
  { $unwind: { path: '$saleSessionDoc', preserveNullAndEmptyArrays: true } },
  { $addFields: { effectiveSessionDoc: { $ifNull: ['$sessionDoc', '$saleSessionDoc'] } } },
  {
    $lookup: {
      from: 'offers',
      let: { vehicleId: '$_id', sessionId: '$effectiveSessionDoc._id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$vehicle', '$$vehicleId'] },
                { $eq: ['$session', '$$sessionId'] },
              ],
            },
          },
        },
        { $count: 'n' },
      ],
      as: 'offerStats',
    },
  },
  {
    $addFields: {
      offerCount: { $ifNull: [{ $arrayElemAt: ['$offerStats.n', 0] }, 0] },
      saleState: {
        $switch: {
          branches: [
            { case: { $eq: ['$saleDoc.status', 'cloturee'] }, then: 'vendu' },
            { case: { $eq: ['$saleDoc.status', 'en_cours'] }, then: 'en_cours_vente' },
            { case: { $eq: ['$saleDoc.status', 'suspendue'] }, then: 'decision_vendeur' },
            {
              // `$unwind` avec preserveNullAndEmptyArrays laisse le champ ABSENT quand la
              // jointure ne trouve rien : il faut le normaliser avant de le comparer à null,
              // un `$ne` direct sur un champ manquant ne se comporte pas comme attendu.
              case: {
                $and: [
                  { $ne: [{ $ifNull: ['$effectiveSessionDoc._id', null] }, null] },
                  { $not: [{ $in: [{ $ifNull: ['$effectiveSessionDoc.status', ''] }, FINISHED_SESSION_STATUSES] }] },
                ],
              },
              then: 'en_enchere',
            },
          ],
          default: 'en_attente',
        },
      },
    },
  },
];

/**
 * Liste paginée des véhicules validés avec leur état commercial.
 *
 * @param {object} filters
 * @param {string} [filters.state] un des SALE_STATES, ou 'all'
 * @param {string|object} [filters.columnFilters] filtres par colonne, comme sur /dossiers
 * @param {number} [filters.page]
 * @param {number} [filters.limit]
 */
const adminListVehicleSales = async (filters = {}) => {
  const columnFilters = parseColumnFilters(filters.columnFilters);
  const dossierMatch = await buildDossierMatch(columnFilters);

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const requestedState = columnFilters.saleState && SALE_STATES.includes(columnFilters.saleState)
    ? columnFilters.saleState 
    : (SALE_STATES.includes(filters.state) ? filters.state : null);
  const stateMatch = requestedState ? [{ $match: { saleState: requestedState } }] : [];

  const postEnrichmentMatch = [];
  if (columnFilters.session) {
    postEnrichmentMatch.push({
      $match: { 'effectiveSessionDoc.name': new RegExp(escapeRegExp(columnFilters.session), 'i') }
    });
  }

  const [result] = await VehicleDossier.aggregate([
    { $match: dossierMatch },
    ...enrichmentStages(),
    ...postEnrichmentMatch,
    {
      $facet: {
        // Les compteurs portent sur l'ensemble filtré, sans le filtre d'état : ils doivent
        // rester lisibles quand une pastille est sélectionnée.
        counts: [{ $group: { _id: '$saleState', n: { $sum: 1 } } }],
        rows: [
          ...stateMatch,
          { $sort: { updatedAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            // Le dossier véhicule est conservé INTÉGRALEMENT : toute colonne configurable
            // dans /dossiers doit rester affichable ici. Seuls la session et la vente sont
            // remplacées par un résumé, et les pièces jointes retirées.
            $addFields: {
              coverPhotoUrl: {
                $let: {
                  vars: {
                    coverPhoto: {
                      $ifNull: [
                        {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: { $ifNull: ['$photos', []] },
                                as: 'photo',
                                cond: { $eq: ['$$photo.isCover', true] },
                              },
                            },
                            0,
                          ],
                        },
                        { $arrayElemAt: [{ $ifNull: ['$photos', []] }, 0] },
                      ],
                    },
                  },
                  in: { $ifNull: ['$$coverPhoto.processedUrl', '$$coverPhoto.originalUrl'] },
                },
              },
              session: {
                $cond: [
                  { $ifNull: ['$effectiveSessionDoc._id', false] },
                  { _id: '$effectiveSessionDoc._id', name: '$effectiveSessionDoc.name', status: '$effectiveSessionDoc.status', endDate: '$effectiveSessionDoc.endDate' },
                  null,
                ],
              },
              sale: {
                $cond: [
                  { $ifNull: ['$saleDoc._id', false] },
                  { _id: '$saleDoc._id', status: '$saleDoc.status', amount: '$saleDoc.amount', currentStep: '$saleDoc.currentStep', winner: '$saleDoc.winner' },
                  null,
                ],
              },
              photoCount: { $size: { $ifNull: ['$photos', []] } },
              hasExpertReport: { $ne: [{ $ifNull: ['$expertReport.originalUrl', null] }, null] },
            },
          },
          { $unset: HEAVY_FIELDS },
        ],
        totalFiltered: [...stateMatch, { $count: 'n' }],
      },
    },
  ]);

  const rows = result?.rows || [];

  // Le vendeur et le gagnant ne sont peuplés qu'une fois la page réduite : inutile de
  // joindre les utilisateurs de toute la collection pour n'en afficher que vingt.
  await User.populate(rows, [
    { path: 'seller', select: 'companyName firstName lastName email' },
    { path: 'sale.winner', select: 'companyName firstName lastName email' },
  ]);

  const counts = SALE_STATES.reduce((acc, state) => ({ ...acc, [state]: 0 }), {});
  for (const entry of result?.counts || []) {
    if (entry._id in counts) counts[entry._id] = entry.n;
  }

  const total = result?.totalFiltered?.[0]?.n || 0;

  return {
    vehicles: rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
};

// Statuts d'une vente (Sale.status) : chacun est un état à part entière dans la liste des ventes.
const SALE_STATUSES = ['en_cours', 'suspendue', 'cloturee', 'sans_gagnant', 'annulee'];

const userSummary = 'companyName firstName lastName email';

/** Id des utilisateurs dont le nom, le prénom ou la raison sociale contient `text`. */
const findUserIdsByName = (text) => {
  const regex = new RegExp(escapeRegExp(text), 'i');
  return User.find({ $or: [{ companyName: regex }, { firstName: regex }, { lastName: regex }] }).distinct('_id');
};

/**
 * Liste paginée des ventes — une ligne par vente, quel que soit son état (en cours, sous
 * réserve, clôturée, sans gagnant, annulée). Contrairement à `adminListVehicleSales`, qui part
 * des véhicules validés, celle-ci part des ventes : un véhicule remis en vente plusieurs fois
 * y apparaît autant de fois qu'il a donné lieu à une vente.
 *
 * @param {object} filters
 * @param {string|object} [filters.columnFilters] brand, model, registrationNumber, seller,
 *   winner, session, status, currentStep, createdAt (jour)
 * @param {number} [filters.page]
 * @param {number} [filters.limit]
 */
const adminListSales = async (filters = {}) => {
  const columnFilters = parseColumnFilters(filters.columnFilters);

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  // Le statut est exclu de ce premier filtre : les compteurs doivent rester lisibles quand
  // un statut est sélectionné.
  const match = {};

  const vehicleFilter = {};
  for (const field of ['brand', 'model', 'registrationNumber']) {
    if (columnFilters[field]) vehicleFilter[field] = new RegExp(escapeRegExp(columnFilters[field]), 'i');
  }
  if (Object.keys(vehicleFilter).length > 0) {
    match.vehicle = { $in: await VehicleDossier.find(vehicleFilter).distinct('_id') };
  }
  if (columnFilters.seller) match.seller = { $in: await findUserIdsByName(columnFilters.seller) };
  if (columnFilters.winner) match.winner = { $in: await findUserIdsByName(columnFilters.winner) };
  if (columnFilters.session) {
    match.session = { $in: await Session.find({ name: new RegExp(escapeRegExp(columnFilters.session), 'i') }).distinct('_id') };
  }
  // Carte « Ventes critiques » du tableau de bord : étape 1 ou 2 au-delà de 80 % du délai
  if (columnFilters.critical === 'true') {
    const critical = await findCriticalSales(Sale);
    match._id = { $in: critical.map((sale) => sale._id) };
  }
  if (columnFilters.currentStep && Number.isFinite(Number(columnFilters.currentStep))) {
    match.currentStep = Number(columnFilters.currentStep);
  }
  if (columnFilters.createdAt) {
    const start = new Date(`${columnFilters.createdAt}T00:00:00.000Z`);
    const end = new Date(`${columnFilters.createdAt}T23:59:59.999Z`);
    if (!Number.isNaN(start.getTime())) match.createdAt = { $gte: start, $lte: end };
  }

  const rowsMatch = SALE_STATUSES.includes(columnFilters.status) ? { ...match, status: columnFilters.status } : match;

  const [rows, total, statusCounts] = await Promise.all([
    Sale.find(rowsMatch)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('vehicle session seller winner amount reservePrice status currentStep createdAt wonAt closedAt timerPaused')
      .populate('vehicle', 'brand model registrationNumber photos')
      .populate('session', 'name status')
      .populate('seller', userSummary)
      .populate('winner', userSummary)
      .lean(),
    Sale.countDocuments(rowsMatch),
    Sale.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  const sales = rows.map(({ vehicle, ...sale }) => {
    const photos = vehicle?.photos || [];
    const cover = photos.find((photo) => photo.isCover) || photos[0];
    return {
      ...sale,
      vehicle: vehicle
        ? {
            _id: vehicle._id,
            brand: vehicle.brand,
            model: vehicle.model,
            registrationNumber: vehicle.registrationNumber,
            coverPhotoUrl: cover?.processedUrl || cover?.originalUrl || null,
          }
        : null,
    };
  });

  const counts = SALE_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  for (const entry of statusCounts) {
    if (entry._id in counts) counts[entry._id] = entry.n;
  }

  return {
    sales,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
};

/** Toutes les offres déposées pendant la session courante ou la dernière session de vente. */
const adminListVehicleOffers = async (vehicleId, requestedSessionId = null) => {
  if (!mongoose.isValidObjectId(vehicleId)) {
    const error = new Error('Véhicule introuvable.');
    error.statusCode = 404;
    throw error;
  }

  const vehicle = await VehicleDossier.findById(vehicleId)
    .select('brand model registrationNumber reservePrice session')
    .populate('session', 'name startDate endDate status')
    .lean();
  if (!vehicle) {
    const error = new Error('Véhicule introuvable.');
    error.statusCode = 404;
    throw error;
  }

  const sale = await Sale.findOne({ vehicle: vehicle._id })
    .sort({ createdAt: -1 })
    .select('session winner winningOffer currentRank waitingList status')
    .populate('session', 'name startDate endDate status')
    .lean();
  const sessionId = (requestedSessionId && mongoose.isValidObjectId(requestedSessionId) ? requestedSessionId : null)
    || vehicle.session?._id || sale?.session?._id;
  const waitingByOffer = new Map((sale?.waitingList || []).map((entry) => [String(entry.offer), entry]));

  const offers = sessionId
    ? await Offer.find({ vehicle: vehicle._id, session: sessionId })
        .populate('buyer', 'companyName firstName lastName email phone role status')
        .sort({ amount: -1, updatedAt: 1 })
        .lean()
    : [];

  // Historique par acheteur : une offre annulée puis redéposée forme deux documents, mais une
  // seule histoire pour l'acheteur dans cette session.
  const offersByBuyer = new Map();
  for (const offer of offers) {
    const key = String(offer.buyer?._id || offer.buyer);
    offersByBuyer.set(key, [...(offersByBuyer.get(key) || []), offer]);
  }

  return {
    vehicle: { ...vehicle, session: vehicle.session || sale?.session || null },
    sale: sale ? { _id: sale._id, status: sale.status } : null,
    offers: offers.map((offer) => {
      const waitingEntry = waitingByOffer.get(String(offer._id));
      const history = buildBuyerOfferHistory(offersByBuyer.get(String(offer.buyer?._id || offer.buyer)) || [offer]);
      return {
        ...offer,
        history,
        hasHistory: history.length > 1,
        rank: waitingEntry?.rank || null,
        attributionStatus: waitingEntry?.status || null,
        discardReason: waitingEntry?.discardReason || null,
        isWinningOffer: String(sale?.winningOffer || '') === String(offer._id),
        isCurrentWinner: Boolean(sale?.winner && offer.buyer?._id && String(sale.winner) === String(offer.buyer._id)),
      };
    }),
  };
};

/**
 * Véhicules ayant atteint ou dépassé le nombre de mises en vente autorisé
 * (Configuration > Configuration générale, champ « Tentatives de mise en vente »).
 *
 * La limite ne bloque pas l'affectation — c'est un repère pour l'administrateur, qui reste
 * libre de republier. Cette liste sert à ne pas les oublier : ils ne se signalent nulle part
 * ailleurs, et un véhicule qui a épuisé ses tentatives demande une décision commerciale.
 *
 * @param {object} [options]
 * @param {number} [options.limit] nombre maximal de lignes renvoyées
 */
const adminListMaxedOutVehicles = async ({ limit } = {}) => {
  const config = await generalConfigService.getConfig();
  const threshold = Number(config?.vehicleListingAttempts) || 3;
  const cap = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

  const match = { status: 'valide', listingCount: { $gte: threshold } };

  const [rows, total] = await Promise.all([
    VehicleDossier.aggregate([
      { $match: match },
      ...enrichmentStages(),
      // Les plus obstinés d'abord : c'est là que la décision presse le plus.
      { $sort: { listingCount: -1, updatedAt: -1 } },
      { $limit: cap },
      {
        $addFields: {
          session: {
            $cond: [
              { $ifNull: ['$effectiveSessionDoc._id', false] },
              { _id: '$effectiveSessionDoc._id', name: '$effectiveSessionDoc.name', status: '$effectiveSessionDoc.status' },
              null,
            ],
          },
        },
      },
      {
        $project: {
          brand: 1, model: 1, registrationNumber: 1, vin: 1, year: 1, mileage: 1,
          reservePrice: 1, listingCount: 1, lotNumber: 1, seller: 1, saleState: 1,
          session: 1, updatedAt: 1,
        },
      },
    ]),
    VehicleDossier.countDocuments(match),
  ]);

  await User.populate(rows, { path: 'seller', select: 'companyName firstName lastName email' });

  return { vehicles: rows, total, threshold };
};

module.exports = {
  adminListVehicleSales,
  adminListSales,
  adminListVehicleOffers,
  adminListMaxedOutVehicles,
  SALE_STATES,
  SALE_STATUSES,
};
