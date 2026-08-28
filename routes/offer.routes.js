const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offer.controller');
const { protect } = require('../middlewares/auth.middleware');
const { acheteurOnly } = require('../middlewares/role.middleware');

// Dépôt d'offres à pli fermé : réservé aux acheteurs connectés
// (cahier des charges §7 : un utilisateur non connecté ne peut pas déposer d'offre).
router.use(protect, acheteurOnly);

// Récapitulatif des frais supplémentaires avant confirmation (création comme modification)
router.post('/quote', offerController.quoteOffer);
router.post('/', offerController.createOffer);

// Offres de l'acheteur connecté, séparées en « en cours » et « passées »
router.get('/mine', offerController.listMyOffers);

// Modification et annulation, possibles tant que la session accepte les offres
router.put('/:id', offerController.updateOffer);
router.post('/:id/cancel', offerController.cancelOffer);

module.exports = router;
