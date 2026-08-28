const express = require('express');
const mongoose = require('mongoose');

const Session = require('../models/session.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const Offer = require('../models/offer.model');
const sessionService = require('../services/session.service');
const { attachUserIfAuthenticated } = require('../middlewares/auth.middleware');

const router = express.Router();

// Taille d'une page de résultats, et plafond de ce qu'un client peut demander d'un coup.
const PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

/**
 * Seuls les vendeurs et acheteurs dont le compte est validé (et les administrateurs) peuvent
 * parcourir l'intégralité du catalogue. Les visiteurs anonymes et les comptes non validés
 * n'obtiennent que la première page (cahier des charges §7 : accès limité sans compte).
 */
const resolveAccess = (user) => {
  if (!user) return { canLoadMore: false, reason: 'anonymous' };
  if (user.role === 'admin' || user.status === 'valide') return { canLoadMore: true, reason: 'ok' };
  return { canLoadMore: false, reason: 'account_not_validated' };
};

/** Filtres de recherche, appliqués côté base pour rester cohérents avec la pagination. */
const buildVehicleQuery = (sessionIds, query) => {
  const filters = { status: 'valide', session: { $in: sessionIds } };

  if (query.brand) filters.brand = query.brand;
  if (query.model) filters.model = query.model;
  if (query.energy) filters.fuelType = query.energy;
  if (query.procedure) filters.procedure = query.procedure;
  if (query.gearbox) filters.gearbox = query.gearbox;
  if (query.registrationCardAvailable === 'true' || query.registrationCardAvailable === 'false') {
    filters.registrationCardAvailable = query.registrationCardAvailable === 'true';
  }

  const range = (from, to) => {
    const bounds = {};
    if (from !== undefined && from !== '' && Number.isFinite(Number(from))) bounds.$gte = Number(from);
    if (to !== undefined && to !== '' && Number.isFinite(Number(to))) bounds.$lte = Number(to);
    return Object.keys(bounds).length ? bounds : null;
  };

  const yearRange = range(query.yearFrom, query.yearTo);
  if (yearRange) filters.year = yearRange;
  const mileageRange = range(query.mileageFrom, query.mileageTo);
  if (mileageRange) filters.mileage = mileageRange;

  return filters;
};

// Données publiques strictement nécessaires aux pages Accueil / Vente en cours.
router.get('/current-sales', attachUserIfAuthenticated, async (req, res) => {
  try {
    await sessionService.syncSessionStatuses();

    const sessions = await Session.find({ status: { $in: ['open', 'active'] } })
      .select('name startDate endDate status')
      .sort({ endDate: 1 })
      .lean();

    const access = resolveAccess(req.user);

    const requestedLimit = Number(req.query.limit);
    // Un accès restreint est plafonné à une page standard : sans ça, un `limit` élevé
    // suffirait à récupérer tout le catalogue en une seule requête.
    const maxLimit = access.canLoadMore ? MAX_PAGE_SIZE : PAGE_SIZE;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), maxLimit)
      : PAGE_SIZE;
    const requestedPage = Number(req.query.page);
    // Un accès restreint ne franchit jamais la première page, quels que soient les paramètres reçus
    const page = access.canLoadMore && Number.isFinite(requestedPage) && requestedPage > 1
      ? Math.trunc(requestedPage)
      : 1;

    const sessionIds = sessions.map((session) => session._id);
    const filters = buildVehicleQuery(sessionIds, req.query);

    const [total, dossiers, brandCounts] = sessionIds.length
      ? await Promise.all([
          VehicleDossier.countDocuments(filters),
          VehicleDossier.find(filters)
            .select('brand model year mileage fuelType energyLabel procedure gearbox bodyType registrationCardAvailable photos session lotNumber')
            .sort({ updatedAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          // Compteurs par marque sur l'ensemble des véhicules en session, hors filtres et hors pagination
          VehicleDossier.aggregate([
            { $match: { status: 'valide', session: { $in: sessionIds }, brand: { $nin: [null, ''] } } },
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ]),
        ])
      : [0, [], []];

    const sessionsById = new Map(sessions.map((session) => [String(session._id), session]));
    const vehicles = dossiers.map((dossier) => {
      const session = sessionsById.get(String(dossier.session));
      const coverPhoto = (dossier.photos || []).find((photo) => photo.isCover) || dossier.photos?.[0];

      return {
        id: String(dossier._id),
        brand: dossier.brand || '',
        model: dossier.model || '',
        year: dossier.year ?? null,
        mileage: dossier.mileage ?? null,
        fuelType: dossier.fuelType || '',
        energyLabel: dossier.energyLabel || '',
        procedure: dossier.procedure || '',
        gearbox: dossier.gearbox || '',
        registrationCardAvailable: dossier.registrationCardAvailable ?? null,
        bodyType: dossier.bodyType || '',
        lotNumber: dossier.lotNumber ?? null,
        photoUrl: coverPhoto?.processedUrl || coverPhoto?.originalUrl || null,
        session: session ? {
          id: String(session._id),
          name: session.name,
          startDate: session.startDate,
          endDate: session.endDate,
          status: session.status,
        } : null,
      };
    });

    res.json({
      sessions,
      vehicles,
      brands: brandCounts.map((entry) => ({ name: entry._id, count: entry.count })),
      pagination: {
        page,
        limit,
        total,
        // Reste-t-il des véhicules après ceux déjà renvoyés ?
        hasMore: page * limit < total,
      },
      access,
    });
  } catch (error) {
    console.error('Erreur GET /public/current-sales:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des ventes en cours.' });
  }
});

// Fiche publique d'un véhicule d'une session en cours : caractéristiques techniques et photos.
// Volontairement exclus tant que la commission n'est pas payée (cahier des charges §6.5/6.12) :
// identité et coordonnées du vendeur, adresse du véhicule, prix de réserve, documents.
// Le VIN et l'immatriculation sont également exclus, cet endpoint étant accessible sans compte.
router.get('/vehicles/:id', attachUserIfAuthenticated, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Véhicule introuvable.' });
    }

    await sessionService.syncSessionStatuses();

    const dossier = await VehicleDossier.findOne({ _id: req.params.id, status: 'valide' })
      .select([
        'brand', 'model', 'year', 'mileage', 'engine', 'fuelType', 'energyLabel', 'co2',
        'firstRegistrationDate', 'vehicleGenre', 'fiscalPower', 'bodyType', 'gearbox',
        'passengerCount', 'doorCount', 'color', 'vrade', 'procedure', 'registrationCardAvailable',
        'identificationSheetAvailable', 'description', 'conditionDetails', 'listingCount',
        'photos', 'session', 'lotNumber',
      ].join(' '))
      .lean();

    if (!dossier) {
      return res.status(404).json({ message: 'Véhicule introuvable.' });
    }

    // Un véhicule n'est consultable publiquement que tant qu'il est dans une session ouverte.
    const session = dossier.session
      ? await Session.findOne({ _id: dossier.session, status: { $in: ['open', 'active'] } })
          .select('name startDate endDate status')
          .lean()
      : null;

    if (!session) {
      return res.status(404).json({ message: 'Véhicule introuvable.' });
    }

    // Les photos floutées (processedUrl) priment sur les originales, et la couverture passe en tête.
    const photos = (dossier.photos || [])
      .map((photo) => ({
        id: String(photo._id),
        url: photo.processedUrl || photo.originalUrl,
        isCover: Boolean(photo.isCover),
        order: photo.order ?? 0,
        width: photo.width ?? null,
        height: photo.height ?? null,
      }))
      .filter((photo) => photo.url)
      .sort((a, b) => (Number(b.isCover) - Number(a.isCover)) || (a.order - b.order));

    // Offre déjà déposée par l'acheteur connecté sur ce véhicule dans cette session :
    // la fiche propose alors de la modifier, jamais d'en déposer une seconde.
    const myOffer = req.user?.role === 'acheteur'
      ? await Offer.findOne({
          vehicle: dossier._id,
          session: session._id,
          buyer: req.user._id,
          status: 'active',
        }).select('amount fees createdAt').lean()
      : null;

    res.json({
      vehicle: {
        id: String(dossier._id),
        brand: dossier.brand || '',
        model: dossier.model || '',
        year: dossier.year ?? null,
        mileage: dossier.mileage ?? null,
        engine: dossier.engine || '',
        fuelType: dossier.fuelType || '',
        energyLabel: dossier.energyLabel || '',
        co2: dossier.co2 || '',
        firstRegistrationDate: dossier.firstRegistrationDate || '',
        vehicleGenre: dossier.vehicleGenre || '',
        fiscalPower: dossier.fiscalPower || '',
        bodyType: dossier.bodyType || '',
        gearbox: dossier.gearbox || '',
        passengerCount: dossier.passengerCount || '',
        doorCount: dossier.doorCount || '',
        color: dossier.color || '',
        vrade: dossier.vrade || '',
        procedure: dossier.procedure || '',
        registrationCardAvailable: dossier.registrationCardAvailable ?? null,
        identificationSheetAvailable: dossier.identificationSheetAvailable ?? null,
        description: dossier.description || '',
        conditionDetails: dossier.conditionDetails || '',
        listingCount: dossier.listingCount ?? 0,
        lotNumber: dossier.lotNumber ?? null,
        photos,
        myOffer: myOffer
          ? {
              id: String(myOffer._id),
              amount: myOffer.amount,
              fees: myOffer.fees,
              createdAt: myOffer.createdAt,
            }
          : null,
        session: {
          id: String(session._id),
          name: session.name,
          startDate: session.startDate,
          endDate: session.endDate,
          status: session.status,
        },
      },
    });
  } catch (error) {
    console.error('Erreur GET /public/vehicles/:id:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du véhicule.' });
  }
});

module.exports = router;
