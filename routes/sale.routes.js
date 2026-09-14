const express = require('express');
const router = express.Router();
const saleController = require('../controllers/sale.controller');
const { protect } = require('../middlewares/auth.middleware');
const { acheteurOnly, vendeurOnly } = require('../middlewares/role.middleware');

router.use(protect);

// Ventes remportées par l'acheteur connecté
router.get('/mine', acheteurOnly, saleController.listMySales);

// Suivi commercial des véhicules du vendeur connecté
router.get('/seller', vendeurOnly, saleController.listSellerSales);
router.get('/seller/:id', vendeurOnly, saleController.getSellerSale);

// Étape 2 : le vendeur atteste avoir reçu le virement de l'acheteur
router.post('/:id/transfer-received', vendeurOnly, saleController.confirmTransferReceived);

// Étape 2,5 : collecte des données carte grise, puis génération des documents
router.post('/:id/registration-card', vendeurOnly, saleController.processRegistrationCard);

// Étape 4 : le vendeur dépose le dossier signé et tamponné s'il n'a pas de tampon auto
router.post('/:id/certificate/seller', vendeurOnly, saleController.submitSellerCertificate);

// Étape 5 : l'acheteur valide le dossier tamponné par le vendeur
router.post('/:id/seller-certificate/validate', acheteurOnly, saleController.validateSellerCertificate);
router.post('/:id/seller-certificate/reject', acheteurOnly, saleController.rejectSellerCertificate);

// Étape 6 : l'acheteur dépose le dossier signé et tamponné s'il n'a pas de tampon auto
router.post('/:id/certificate', acheteurOnly, saleController.submitSignedCertificate);

// Étape 7 : le vendeur effectue la validation finale des documents
router.post('/:id/certificate/validate', vendeurOnly, saleController.validateSignedCertificate);
router.post('/:id/certificate/reject', vendeurOnly, saleController.rejectSignedCertificate);

// Étape 8 : le vendeur atteste la remise du véhicule et clôture la vente
router.post('/:id/handover', vendeurOnly, saleController.confirmHandover);

// Détail d'une vente remportée, avec l'avancement de la procédure d'achat.
// Déclarée après /seller pour que ce segment fixe ne soit pas capté comme un identifiant.
router.get('/:id', acheteurOnly, saleController.getMySale);

// Détail complet du véhicule remporté
router.get('/:id/vehicle', acheteurOnly, saleController.getSaleVehicle);

// Étape 1 : ouverture du paiement Stripe de la commission, puis confirmation au retour
router.post('/:id/commission/checkout', acheteurOnly, saleController.startCommissionPayment);
router.post('/:id/commission/payment-intent', acheteurOnly, saleController.startCommissionPaymentIntent);
router.post('/:id/commission/confirm', acheteurOnly, saleController.confirmCommissionPayment);

// Annulation par l'acheteur à l'étape 1
router.put('/:id/cancel-buyer', acheteurOnly, saleController.cancelSaleByBuyer);

module.exports = router;
