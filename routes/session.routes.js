const express = require('express');
const router = express.Router();
const Session = require('../models/session.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const sessionService = require('../services/session.service');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// GET /api/sessions/config - Récupérer la configuration récurrente
router.get('/config', protect, adminOnly, async (req, res) => {
  try {
    const config = await sessionService.getConfig();
    res.json(config);
  } catch (error) {
    console.error('Erreur GET /sessions/config:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la configuration.' });
  }
});

// PUT /api/sessions/config - Mettre à jour la configuration récurrente
router.put('/config', protect, adminOnly, async (req, res) => {
  try {
    const config = await sessionService.updateConfig(req.body);
    res.json({ message: 'Configuration mise à jour et calendrier régénéré.', config });
  } catch (error) {
    console.error('Erreur PUT /sessions/config:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la configuration.' });
  }
});

// GET /api/sessions - Liste des sessions (pour le calendrier admin)
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    // Synchroniser et auto-générer les sessions avant le rendu
    await sessionService.autoGenerateAndSyncSessions();

    const sessions = await Session.find().sort({ startDate: 1 }).lean();

    // Pour chaque session, compter le nombre de véhicules associés
    const sessionsWithCount = await Promise.all(
      sessions.map(async (session) => {
        const count = await VehicleDossier.countDocuments({
          $or: [{ session: session._id.toString() }, { session: session._id }],
        });
        return {
          ...session,
          vehicleCount: count,
          date: session.startDate || session.date,
        };
      })
    );

    res.json(sessionsWithCount);
  } catch (error) {
    console.error('Erreur GET /sessions:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des sessions.' });
  }
});

// POST /api/sessions - Créer une session manuellement
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { name, date, startDate, durationHours } = req.body;
    const start = startDate || date;

    if (!start) {
      return res.status(400).json({ message: 'La date de début est requise.' });
    }

    const newSession = await sessionService.createManualSession({
      name,
      startDate: start,
      durationHours: durationHours || 48,
    });

    res.status(201).json(newSession);
  } catch (error) {
    console.error('Erreur POST /sessions:', error);
    res.status(500).json({ message: 'Erreur lors de la création de la session.' });
  }
});

// GET /api/sessions/:id - Détails d'une session avec ses véhicules
router.get('/:id', protect, adminOnly, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).lean();
    if (!session) {
      return res.status(404).json({ message: 'Session introuvable.' });
    }

    const vehicles = await VehicleDossier.find({
      $or: [{ session: session._id.toString() }, { session: session._id }],
    }).lean();

    session.vehicles = vehicles;
    session.vehicleCount = vehicles.length;
    res.json(session);
  } catch (error) {
    console.error('Erreur GET /sessions/:id:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la session.' });
  }
});

// POST /api/sessions/:id/add-vehicle - Ajouter un véhicule à une session
router.post('/:id/add-vehicle', protect, adminOnly, async (req, res) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({ message: 'L\'ID du véhicule est requis.' });
    }

    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session introuvable.' });
    }

    const vehicle = await VehicleDossier.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ message: 'Véhicule introuvable.' });
    }

    vehicle.session = session._id.toString();
    await vehicle.save();

    res.json({ message: 'Véhicule ajouté à la session avec succès.', vehicle });
  } catch (error) {
    console.error('Erreur POST /sessions/:id/add-vehicle:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du véhicule à la session.' });
  }
});

// POST /api/sessions/:id/remove-vehicle - Retirer un véhicule d'une session
router.post('/:id/remove-vehicle', protect, adminOnly, async (req, res) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({ message: 'L\'ID du véhicule est requis.' });
    }

    const vehicle = await VehicleDossier.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ message: 'Véhicule introuvable.' });
    }

    vehicle.session = null;
    await vehicle.save();

    res.json({ message: 'Véhicule retiré de la session avec succès.' });
  } catch (error) {
    console.error('Erreur POST /sessions/:id/remove-vehicle:', error);
    res.status(500).json({ message: 'Erreur lors du retrait du véhicule de la session.' });
  }
});

// DELETE /api/sessions/:id - Supprimer une session
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session introuvable.' });
    }

    // Libérer les véhicules associés
    await VehicleDossier.updateMany({ session: session._id.toString() }, { $set: { session: null } });
    await session.deleteOne();

    res.json({ message: 'Session supprimée et véhicules libérés.' });
  } catch (error) {
    console.error('Erreur DELETE /sessions/:id:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression de la session.' });
  }
});

module.exports = router;
