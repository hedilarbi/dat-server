const express = require('express');

const Session = require('../models/session.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const sessionService = require('../services/session.service');

const router = express.Router();

// Données publiques strictement nécessaires aux pages Accueil / Vente en cours.
router.get('/current-sales', async (_req, res) => {
  try {
    await sessionService.syncSessionStatuses();

    const sessions = await Session.find({ status: { $in: ['open', 'active'] } })
      .select('name startDate endDate status')
      .sort({ endDate: 1 })
      .lean();

    const sessionIds = sessions.map((session) => session._id);
    const dossiers = sessionIds.length
      ? await VehicleDossier.find({ status: 'valide', session: { $in: sessionIds } })
          .select('brand model year mileage fuelType energyLabel procedure gearbox bodyType registrationCardAvailable photos session')
          .sort({ updatedAt: -1 })
          .lean()
      : [];

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

    res.json({ sessions, vehicles });
  } catch (error) {
    console.error('Erreur GET /public/current-sales:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des ventes en cours.' });
  }
});

module.exports = router;
