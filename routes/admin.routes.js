const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// Toutes les routes admin nécessitent d'être connecté ET d'avoir le rôle d'administrateur
router.use(protect, adminOnly);

router.get('/users', adminController.getUsers);
router.post('/users/:id/validate', adminController.approveUser);
router.post('/users/:id/reject', adminController.rejectUser);
router.post('/users/:id/request-correction', adminController.requestCorrection);
router.put('/users/:id/status', adminController.updateStatus);

router.get('/dashboard-stats', adminController.getDashboardStats);
router.get('/payments', adminController.getPayments);

// Notifications admin
router.get('/notifications', adminController.getNotifications);
router.put('/notifications/read-all', adminController.markAllNotificationsAsRead);
router.put('/notifications/:id/read', adminController.markNotificationAsRead);

// Gestion des ventes par l'admin
router.get('/sales/:id', adminController.getSale);
router.put('/sales/:id/timer', adminController.toggleSaleTimer);
router.put('/sales/:id/force-end', adminController.forceEndSale);
router.put('/sales/:id/extend-deadline', adminController.extendSaleDeadline);
router.post('/sales/:id/promote-next', adminController.promoteSaleNextBidder);

module.exports = router;
