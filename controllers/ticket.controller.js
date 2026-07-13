const ticketService = require('../services/ticket.service');

/**
 * Ouvrir un nouveau ticket
 */
const createTicket = async (req, res, next) => {
  try {
    const { title, category, priority, messageContent, attachments } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!title || !messageContent) {
      return res.status(400).json({
        error: 'ticket.validation_error',
        message: 'Le titre et le message initial sont requis.'
      });
    }

    const ticket = await ticketService.createTicket(userId, userRole, {
      title,
      category,
      priority,
      messageContent,
      attachments
    });

    res.status(201).json({
      success: true,
      message: 'Ticket de support créé avec succès.',
      ticket
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Récupérer la liste des tickets (pour l'utilisateur connecté ou tous si admin)
 */
const getTickets = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { userId: filterUserId, status, category, priority } = req.query;

    const tickets = await ticketService.getTickets(userId, userRole, {
      userId: filterUserId,
      status,
      category,
      priority
    });

    res.status(200).json({
      success: true,
      tickets
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Récupérer un ticket par son ID
 */
const getTicketById = async (req, res, next) => {
  try {
    const ticketId = req.params.id;
    const userId = req.user._id;
    const userRole = req.user.role;

    const ticket = await ticketService.getTicketById(ticketId, userId, userRole);

    res.status(200).json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Répondre à un ticket existant
 */
const addMessage = async (req, res, next) => {
  try {
    const ticketId = req.params.id;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { content, attachments } = req.body;

    if (!content) {
      return res.status(400).json({
        error: 'ticket.validation_error',
        message: 'Le contenu du message est requis.'
      });
    }

    const ticket = await ticketService.addMessageToTicket(ticketId, userId, userRole, {
      content,
      attachments
    });

    res.status(200).json({
      success: true,
      message: 'Message ajouté au ticket.',
      ticket
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clôturer ou changer le statut d'un ticket
 */
const updateStatus = async (req, res, next) => {
  try {
    const ticketId = req.params.id;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        error: 'ticket.validation_error',
        message: 'Le nouveau statut est requis.'
      });
    }

    const ticket = await ticketService.updateTicketStatus(ticketId, userId, userRole, status);

    res.status(200).json({
      success: true,
      message: `Statut du ticket mis à jour vers : ${status}.`,
      ticket
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ajouter une note interne d'administration (Admin uniquement)
 */
const addInternalNote = async (req, res, next) => {
  try {
    const ticketId = req.params.id;
    const adminId = req.user._id;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        error: 'ticket.validation_error',
        message: 'Le contenu de la note interne est requis.'
      });
    }

    const ticket = await ticketService.addInternalNote(ticketId, adminId, content);

    res.status(200).json({
      success: true,
      message: 'Note interne ajoutée.',
      ticket
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTicket,
  getTickets,
  getTicketById,
  addMessage,
  updateStatus,
  addInternalNote
};
