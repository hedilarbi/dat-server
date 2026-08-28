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
    const { status, brand, model, reservePrice, page, limit } = req.query;
    const result = await vehicleDossierService.listDossiers(req.user._id, {
      status, brand, model, reservePrice, page, limit,
    });
    res.status(200).json({ success: true, ...result });
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

const lookupRegistration = async (req, res, next) => {
  try {
    const immatriculation = String(req.body.immatriculation || '').trim().toUpperCase();
    if (!immatriculation) {
      const error = new Error("Le numéro d'immatriculation est requis.");
      error.statusCode = 400;
      throw error;
    }
    const token = process.env.API_MATRICULE_TOKEN;
    if (!token) {
      const error = new Error("Le service de recherche d'immatriculation n'est pas configuré.");
      error.statusCode = 503;
      throw error;
    }
    const url = new URL('https://api.apiplaqueimmatriculation.com/plaque');
    url.searchParams.set('immatriculation', immatriculation);
    url.searchParams.set('token', token);
    url.searchParams.set('pays', 'FR');
    const response = await fetch(url, { method: 'POST' });
    const payload = await response.json();

    if (!response.ok || payload?.data?.erreur) {
      const error = new Error(payload?.data?.erreur || 'Immatriculation introuvable.');
      error.statusCode = response.ok ? 404 : response.status;
      throw error;
    }
    res.status(200).json({ success: true, data: payload.data });
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
  lookupRegistration,
  blurMedia,
  getPdfPages,
  blurPdf
};
