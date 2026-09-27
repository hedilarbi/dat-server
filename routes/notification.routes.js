const express = require('express');
const controller = require('../controllers/notification.controller');
const { protect } = require('../middlewares/auth.middleware');
const { vendeurOnly } = require('../middlewares/role.middleware');

const router = express.Router();
router.use(protect, vendeurOnly);
router.get('/', controller.getNotifications);
router.put('/read-all', controller.markAllAsRead);
router.put('/:id/read', controller.markAsRead);

module.exports = router;
