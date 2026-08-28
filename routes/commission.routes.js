const express = require('express');
const router = express.Router();
const commissionController = require('../controllers/commission.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// Gestion des tranches de commission plateforme (réservée aux administrateurs)
router.use(protect, adminOnly);

router.get('/', commissionController.getTiers);
router.get('/simulate', commissionController.simulate);
router.post('/', commissionController.createTier);
router.put('/:id', commissionController.updateTier);
router.delete('/:id', commissionController.deleteTier);

module.exports = router;
