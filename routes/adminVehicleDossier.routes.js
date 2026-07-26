const express = require('express');
const router = express.Router();
const adminVehicleDossierController = require('../controllers/adminVehicleDossier.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

router.use(protect, adminOnly);

router.get('/', adminVehicleDossierController.listDossiers);
router.get('/available', adminVehicleDossierController.getAvailableDossiers);
router.get('/:id', adminVehicleDossierController.getDossierById);
router.put('/:id/media', adminVehicleDossierController.updateDossierMedia);
router.post('/:id/validate', adminVehicleDossierController.approveDossier);
router.post('/:id/reject', adminVehicleDossierController.rejectDossier);
router.post('/:id/request-correction', adminVehicleDossierController.requestCorrection);

module.exports = router;
