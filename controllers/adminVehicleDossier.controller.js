const vehicleDossierService = require('../services/vehicleDossier.service');

const listDossiers = async (req, res, next) => {
  try {
    const { status, columnFilters, page, limit } = req.query;
    const result = await vehicleDossierService.adminListDossiers({ status, columnFilters, page, limit });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const getDossierById = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.adminGetDossierById(req.params.id);
    res.status(200).json({ success: true, dossier });
  } catch (error) {
    next(error);
  }
};

const updateDossier = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.adminUpdateDossier(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Dossier véhicule mis à jour.', dossier });
  } catch (error) {
    next(error);
  }
};

const updateDossierMedia = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.adminUpdateDossierMedia(req.params.id, req.body);
    res.status(200).json({ success: true, dossier });
  } catch (error) {
    next(error);
  }
};

const approveDossier = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.approveDossier(req.params.id);
    res.status(200).json({ success: true, message: 'Dossier véhicule validé.', dossier });
  } catch (error) {
    next(error);
  }
};

const rejectDossier = async (req, res, next) => {
  try {
    const { motifs, comment } = req.body;
    const dossier = await vehicleDossierService.rejectDossier(req.params.id, { motifs, comment });
    res.status(200).json({ success: true, message: 'Dossier véhicule refusé.', dossier });
  } catch (error) {
    next(error);
  }
};

const requestCorrection = async (req, res, next) => {
  try {
    const { motifs, comment } = req.body;
    const dossier = await vehicleDossierService.requestDossierCorrection(req.params.id, { motifs, comment });
    res.status(200).json({ success: true, message: 'Correction demandée.', dossier });
  } catch (error) {
    next(error);
  }
};

const getAvailableDossiers = async (req, res, next) => {
  try {
    const dossiers = await vehicleDossierService.adminGetAvailableDossiers();
    res.status(200).json({ success: true, dossiers });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listDossiers,
  getDossierById,
  updateDossier,
  updateDossierMedia,
  approveDossier,
  rejectDossier,
  requestCorrection,
  getAvailableDossiers
};
