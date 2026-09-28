const mongoose = require('mongoose');
const VehicleDossier = require('../models/vehicleDossier.model');

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

const listPublicShowcase = async () => VehicleDossier.aggregate([
  { $match: { status: 'valide', showcaseOrder: { $ne: null } } },
  { $addFields: { imageUrl: coverPhotoExpression } },
  { $match: { imageUrl: { $nin: [null, ''] } } },
  { $sort: { showcaseOrder: 1, _id: 1 } },
  { $project: { _id: 0, id: { $toString: '$_id' }, imageUrl: 1 } },
]);

module.exports = { listAdminShowcase, updateShowcase, listPublicShowcase };
