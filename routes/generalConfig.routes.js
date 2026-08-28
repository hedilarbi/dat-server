const express = require('express');
const router = express.Router();
const generalConfigController = require('../controllers/generalConfig.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// Configuration générale de la plateforme (réservée aux administrateurs)
router.use(protect, adminOnly);

router.get('/', generalConfigController.getConfig);
router.put('/', generalConfigController.updateConfig);

module.exports = router;
