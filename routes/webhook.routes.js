const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Point d'entrée pour OpenAPI
router.post('/esignature', webhookController.handleEsignatureWebhook);

module.exports = router;
