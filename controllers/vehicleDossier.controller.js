const vehicleDossierService = require('../services/vehicleDossier.service');
const vehicleDossierMediaService = require('../services/vehicleDossierMedia.service');
const vehicleDossierPdfService = require('../services/vehicleDossierPdf.service');

const createDossier = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.createDossier(req.user._id, req.body);
    res.status(201).json({ success: true, dossier });
  } catch (error) {
    next(error);
  }
};

const updateDossier = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.updateDossier(req.params.id, req.user._id, req.body);
    res.status(200).json({ success: true, dossier });
  } catch (error) {
    next(error);
  }
};

const listDossiers = async (req, res, next) => {
  try {
    const dossiers = await vehicleDossierService.listDossiers(req.user._id, { status: req.query.status });
    res.status(200).json({ success: true, dossiers });
  } catch (error) {
    next(error);
  }
};

const getDossierById = async (req, res, next) => {
  try {
    const dossier = await vehicleDossierService.getDossierById(req.params.id, req.user._id);
    res.status(200).json({ success: true, dossier });
  } catch (error) {
    next(error);
  }
};

const deleteDossier = async (req, res, next) => {
  try {
    await vehicleDossierService.deleteDossier(req.params.id, req.user._id);
    res.status(200).json({ success: true, message: 'Brouillon supprimé.' });
  } catch (error) {
    next(error);
  }
};

const blurMedia = async (req, res, next) => {
  try {
    const { imageUrl, zones } = req.body;
    const result = await vehicleDossierMediaService.applyBlur(imageUrl, zones, req);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const getPdfPages = async (req, res, next) => {
  try {
    const { pdfUrl } = req.body;
    const result = await vehicleDossierPdfService.getPdfPages(pdfUrl, req);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const blurPdf = async (req, res, next) => {
  try {
    const { pdfUrl, pagesZones } = req.body;
    const result = await vehicleDossierPdfService.applyPdfBlur(pdfUrl, pagesZones, req);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDossier,
  updateDossier,
  listDossiers,
  getDossierById,
  deleteDossier,
  blurMedia,
  getPdfPages,
  blurPdf
};
