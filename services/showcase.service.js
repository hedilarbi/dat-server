const mongoose = require('mongoose');
const VehicleDossier = require('../models/vehicleDossier.model');
const Session = require('../models/session.model');
const Offer = require('../models/offer.model');

const coverPhotoExpression = {
  $let: {
    vars: {
      cover: {
        $ifNull: [
          { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$photos', []] }, as: 'photo', cond: { $eq: ['$$photo.isCover', true] } } }, 0] },
          { $arrayElemAt: [{ $ifNull: ['$photos', []] }, 0] },
        ],
      },
    },
    in: { $ifNull: ['$$cover.processedUrl', '$$cover.originalUrl'] },
  },
};

const listAdminShowcase = async () => VehicleDossier.aggregate([
  { $match: { status: 'valide' } },
  { $addFields: { imageUrl: coverPhotoExpression } },
  { $match: { imageUrl: { $nin: [null, ''] } } },
  { $sort: { showcaseOrder: 1, updatedAt: -1 } },
  { $project: { brand: 1, model: 1, registrationNumber: 1, imageUrl: 1, showcaseOrder: 1 } },
]);

const updateShowcase = async (vehicleIds) => {
  if (!Array.isArray(vehicleIds) || vehicleIds.some((id) => !mongoose.isValidObjectId(id))) {
    const error = new Error('La sélection de la vitrine est invalide.');
    error.statusCode = 400;
    throw error;
  }
  const uniqueIds = [...new Set(vehicleIds.map(String))];
  const eligibleCount = await VehicleDossier.countDocuments({
    _id: { $in: uniqueIds }, status: 'valide', 'photos.0': { $exists: true },
  });
  if (eligibleCount !== uniqueIds.length) {
    const error = new Error('Un ou plusieurs véhicules ne sont plus disponibles pour la vitrine.');
    error.statusCode = 409;
    throw error;
  }

  await VehicleDossier.updateMany({ showcaseOrder: { $ne: null } }, { $set: { showcaseOrder: null } });
  if (uniqueIds.length) {
    await VehicleDossier.bulkWrite(uniqueIds.map((id, index) => ({
      updateOne: { filter: { _id: id, status: 'valide' }, update: { $set: { showcaseOrder: index } } },
    })));
  }
  return listAdminShowcase();
};

/**
 * Véhicules choisis par l'administrateur pour la vitrine, dans l'ordre voulu, sous la même forme
 * que les cartes de « ventes en cours » (le site et l'application réutilisent la même carte).
 * `imageUrl` est conservé pour les anciennes versions de l'application.
 *
 * Un véhicule de la vitrine n'est pas forcément dans une session : `session` vaut alors null et
 * il ne peut pas recevoir d'offre. `hasActiveOffer` / `offerAmount` ne sont renseignés que pour un
 * utilisateur connecté, et seulement pour une offre de la session en cours du véhicule.
 */
const listPublicShowcase = async (user = null) => {
  const items = await VehicleDossier.aggregate([
    { $match: { status: 'valide', showcaseOrder: { $ne: null } } },
    { $addFields: { imageUrl: coverPhotoExpression } },
    { $match: { imageUrl: { $nin: [null, ''] } } },
    { $sort: { showcaseOrder: 1, _id: 1 } },
    {
      $project: {
        brand: 1, model: 1, year: 1, mileage: 1, fuelType: 1, energyLabel: 1, procedure: 1, gearbox: 1,
        bodyType: 1, registrationCardAvailable: 1, lotNumber: 1, session: 1, imageUrl: 1,
      },
    },
  ]);

  const sessionIds = items.map((item) => item.session).filter(Boolean);
  const sessions = sessionIds.length
    ? await Session.find({ _id: { $in: sessionIds }, status: { $in: ['open', 'active'] } }).select('name startDate endDate status').lean()
    : [];
  const sessionsById = new Map(sessions.map((session) => [String(session._id), session]));

  const offers = user && ['acheteur', 'vendeur'].includes(user.role) && sessions.length
    ? await Offer.find({
        buyer: user._id,
        status: 'active',
        $or: items.filter((item) => sessionsById.has(String(item.session))).map((item) => ({ vehicle: item._id, session: item.session })),
      }).select('vehicle amount').lean()
    : [];
  const offerByVehicle = new Map(offers.map((offer) => [String(offer.vehicle), offer.amount]));

  return items.map((item) => {
    const session = item.session ? sessionsById.get(String(item.session)) : null;
    return {
      id: String(item._id),
      imageUrl: item.imageUrl,
      photoUrl: item.imageUrl,
      hasActiveOffer: offerByVehicle.has(String(item._id)),
      offerAmount: offerByVehicle.get(String(item._id)) ?? null,
      brand: item.brand || '',
      model: item.model || '',
      year: item.year ?? null,
      mileage: item.mileage ?? null,
      fuelType: item.fuelType || '',
      energyLabel: item.energyLabel || '',
      procedure: item.procedure || '',
      gearbox: item.gearbox || '',
      registrationCardAvailable: item.registrationCardAvailable ?? null,
      bodyType: item.bodyType || '',
      lotNumber: session ? (item.lotNumber ?? null) : null,
      session: session
        ? { id: String(session._id), name: session.name, startDate: session.startDate, endDate: session.endDate, status: session.status }
        : null,
    };
  });
};

module.exports = { listAdminShowcase, updateShowcase, listPublicShowcase };
