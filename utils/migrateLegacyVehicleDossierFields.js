const VehicleDossier = require('../models/vehicleDossier.model');

const migrateLegacyVehicleDossierFields = async () => {
  const result = await VehicleDossier.updateMany(
    { $or: [{ dossierType: { $exists: true } }, { vehicleCondition: { $exists: true } }] },
    { $unset: { dossierType: '', vehicleCondition: '' } }
  );

  if (result.modifiedCount > 0) {
    console.log(`${result.modifiedCount} dossier(s) véhicule migré(s) : anciens champs dossierType/vehicleCondition supprimés.`);
  }
};

module.exports = migrateLegacyVehicleDossierFields;
