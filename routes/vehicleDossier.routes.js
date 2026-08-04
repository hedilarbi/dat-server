const express = require('express');
const router = express.Router();
const vehicleDossierController = require('../controllers/vehicleDossier.controller');
const { protect } = require('../middlewares/auth.middleware');
const { vendeurOnly, vendeurOrAdmin, vendeurValideOnly, vendeurValideOrAdmin } = require('../middlewares/role.middleware');

router.use(protect);

// Route stateless et sans notion de propriétaire : accessible au vendeur (édition de son dossier)
// ET à l'admin (retouche des zones de flou avant validation, cahier des charges §10.5). Déclarée
// avant le router.use(vendeurOnly) ci-dessous pour ne pas hériter de cette restriction, et avant
// '/:id' pour ne pas être capturée par ce pattern.
router.post('/media/blur', vendeurOrAdmin, vendeurValideOrAdmin, vehicleDossierController.blurMedia);
router.post('/media/pdf-pages', vendeurOrAdmin, vendeurValideOrAdmin, vehicleDossierController.getPdfPages);
router.post('/media/pdf-blur', vendeurOrAdmin, vendeurValideOrAdmin, vehicleDossierController.blurPdf);

// Le reste de l'espace "dossier véhicule" (CRUD) est réservé aux vendeurs connectés — la
// supervision admin passe par des routes dédiées (server/routes/adminVehicleDossier.routes.js).
router.use(vendeurOnly);
router.use(vendeurValideOnly);

router.post('/registration-lookup', vehicleDossierController.lookupRegistration);
router.post('/', vehicleDossierController.createDossier);
router.get('/', vehicleDossierController.listDossiers);
router.get('/:id', vehicleDossierController.getDossierById);
router.put('/:id', vehicleDossierController.updateDossier);
router.delete('/:id', vehicleDossierController.deleteDossier);

module.exports = router;
