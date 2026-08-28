const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

// Routes non sécurisées (publiques)
router.post('/register-step1', authController.registerStep1);
router.post('/resend-otp', authController.resendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/logout', authController.logout);

// Routes sécurisées par JWT
router.post('/register-step2', protect, authController.registerStep2);
router.get('/me', protect, authController.getMe);
router.put('/me/language', protect, authController.updateLanguage);
router.put('/me/stamp', protect, authController.updateStamp);
router.put('/me/push-token', protect, authController.updatePushToken);

router.post('/me/pending-commission/checkout', protect, authController.startPendingCommissionPayment);
router.post('/me/pending-commission/payment-intent', protect, authController.startPendingCommissionIntent);
router.post('/me/pending-commission/confirm', protect, authController.confirmPendingCommissionPayment);

module.exports = router;
