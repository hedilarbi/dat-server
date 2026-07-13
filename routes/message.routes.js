const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// Gestion des messages de refus / correction (réservée aux administrateurs)
router.use(protect, adminOnly);

router.get('/', messageController.getMessages);
router.post('/', messageController.createMessage);
router.put('/:key', messageController.updateMessage);
router.delete('/:key', messageController.deleteMessage);

module.exports = router;
