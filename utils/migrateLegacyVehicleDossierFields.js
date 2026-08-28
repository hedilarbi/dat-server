const VehicleDossier = require('../models/vehicleDossier.model');

const migrateLegacyVehicleDossierFields = async () => {
  const result = await VehicleDossier.updateMany(
    { $or: [{ dossierType: { $exists: true } }, { vehicleCondition: { $exists: true } }] },
    { $unset: { dossierType: '', vehicleCondition: '' } }
  );

  if (result.modifiedCount > 0) {
    console.log(`${result.modifiedCount} dossier(s) véhicule migré(s) : anciens champs dossierType/vehicleCondition supprimés.`);
  }

  // Le compteur de mises en vente est désormais incrémenté à l'affectation en session.
  // Les véhicules déjà publiés avant cette règle n'ont jamais été comptés : on rattrape
  // leur mise en vente courante pour que le compteur reparte d'une base juste.
  const backfilled = await VehicleDossier.updateMany(
    { session: { $ne: null }, lastListedSession: null },
    [{ $set: { lastListedSession: '$session', listingCount: { $max: [{ $ifNull: ['$listingCount', 0] }, 1] } } }]
  );

  if (backfilled.modifiedCount > 0) {
    console.log(`${backfilled.modifiedCount} dossier(s) véhicule : compteur de mises en vente initialisé.`);
  }
};

module.exports = migrateLegacyVehicleDossierFields;
