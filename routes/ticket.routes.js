const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { protect } = require('../middlewares/auth.middleware');
const { adminOnly } = require('../middlewares/role.middleware');

// Toutes les routes de tickets nécessitent d'être connecté
router.use(protect);

router.post('/', ticketController.createTicket);
router.get('/', ticketController.getTickets);
router.get('/:id', ticketController.getTicketById);
router.post('/:id/messages', ticketController.addMessage);
router.put('/:id/status', ticketController.updateStatus);
router.delete('/:id', ticketController.deleteTicket);

// Les notes internes sont réservées aux administrateurs
router.post('/:id/internal-notes', adminOnly, ticketController.addInternalNote);

module.exports = router;
