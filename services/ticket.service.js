const Ticket = require('../models/ticket.model');

/**
 * Créer un ticket de support avec son message initial
 */
const createTicket = async (userId, userRole, ticketData) => {
  const { title, category, priority, messageContent, attachments } = ticketData;

  if (!title || !messageContent) {
    const err = new Error('Le titre et le contenu du message initial sont obligatoires.');
    err.codeName = 'ticket.validation_error';
    throw err;
  }

  const ticket = new Ticket({
    user: userId,
    category: category || 'general',
    title,
    priority: priority || 'normale',
    status: 'en_attente_admin',
    messages: [{
      sender: userId,
      senderRole: userRole,
      content: messageContent,
      attachments: attachments || []
    }]
  });

  await ticket.save();
  return ticket;
};

/**
 * Obtenir la liste des tickets (pour l'utilisateur connecté ou tous si admin)
 */
const getTickets = async (userId, userRole, queryFilters = {}) => {
  const filter = {};

  // Si l'utilisateur n'est pas admin, il ne voit que ses propres tickets
  if (userRole !== 'admin') {
    filter.user = userId;
  } else {
    // Si admin, on peut filtrer par utilisateur spécifique
    if (queryFilters.userId) {
      filter.user = queryFilters.userId;
    }
  }

  // Filtres optionnels
  if (queryFilters.status) {
    filter.status = queryFilters.status;
  }
  if (queryFilters.category) {
    filter.category = queryFilters.category;
  }
  if (queryFilters.priority) {
    filter.priority = queryFilters.priority;
  }

  const tickets = await Ticket.find(filter)
    .populate('user', 'firstName lastName companyName email role')
    .sort({ updatedAt: -1 });

  return tickets;
};

/**
 * Obtenir le détail d'un ticket par son ID
 */
const getTicketById = async (ticketId, userId, userRole) => {
  const ticket = await Ticket.findById(ticketId)
    .populate('user', 'firstName lastName companyName email role')
    .populate('messages.sender', 'firstName lastName companyName role')
    .populate('internalNotes.admin', 'firstName lastName role');

  if (!ticket) {
    const err = new Error('Ticket introuvable.');
    err.codeName = 'ticket.not_found';
    throw err;
  }

  // Vérifier les droits d'accès
  if (userRole !== 'admin' && ticket.user._id.toString() !== userId.toString()) {
    const err = new Error('Accès refusé. Vous n\'êtes pas l\'auteur de ce ticket.');
    err.codeName = 'ticket.access_forbidden';
    throw err;
  }

  return ticket;
};

/**
 * Ajouter un message à un ticket existant
 */
const addMessageToTicket = async (ticketId, userId, userRole, messageData) => {
  const { content, attachments } = messageData;

  if (!content) {
    const err = new Error('Le contenu du message est obligatoire.');
    err.codeName = 'ticket.validation_error';
    throw err;
  }

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    const err = new Error('Ticket introuvable.');
    err.codeName = 'ticket.not_found';
    throw err;
  }

  // Vérifier les droits d'accès
  if (userRole !== 'admin' && ticket.user.toString() !== userId.toString()) {
    const err = new Error('Accès refusé. Vous n\'êtes pas l\'auteur de ce ticket.');
    err.codeName = 'ticket.access_forbidden';
    throw err;
  }

  // Définir le nouveau statut selon l'expéditeur
  let newStatus = ticket.status;
  if (userRole === 'admin') {
    newStatus = 'en_attente_utilisateur';
  } else {
    // Si le ticket était clôturé, il est rouvert automatiquement
    newStatus = (ticket.status === 'cloturee') ? 'reouverte' : 'en_attente_admin';
  }

  // Ajouter le message au fil
  ticket.messages.push({
    sender: userId,
    senderRole: userRole,
    content,
    attachments: attachments || []
  });

  ticket.status = newStatus;
  await ticket.save();

  // Recharger le ticket avec les populations
  return getTicketById(ticketId, userId, userRole);
};

/**
 * Mettre à jour le statut d'un ticket (Clôturer, En cours, etc.)
 */
const updateTicketStatus = async (ticketId, userId, userRole, newStatus) => {
  const allowedStatuses = ['ouverte', 'en_attente_admin', 'en_attente_utilisateur', 'en_cours', 'cloturee', 'reouverte'];
  
  if (!allowedStatuses.includes(newStatus)) {
    const err = new Error('Statut invalide.');
    err.codeName = 'ticket.invalid_status';
    throw err;
  }

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    const err = new Error('Ticket introuvable.');
    err.codeName = 'ticket.not_found';
    throw err;
  }

  // Si ce n'est pas un admin, il ne peut que fermer son propre ticket
  if (userRole !== 'admin') {
    if (ticket.user.toString() !== userId.toString()) {
      const err = new Error('Accès refusé.');
      err.codeName = 'ticket.access_forbidden';
      throw err;
    }
    if (newStatus !== 'cloturee') {
      const err = new Error('Action non autorisée. Seul un administrateur peut modifier le statut d\'un ticket vers un autre état que clôturé.');
      err.codeName = 'ticket.action_not_allowed';
      throw err;
    }
  }

  ticket.status = newStatus;

  if (newStatus === 'cloturee') {
    ticket.closedAt = new Date();
    ticket.closedBy = userId;
  } else {
    ticket.closedAt = undefined;
    ticket.closedBy = undefined;
  }

  await ticket.save();
  return getTicketById(ticketId, userId, userRole);
};

/**
 * Ajouter une note interne d'administration (Admin uniquement)
 */
const addInternalNote = async (ticketId, adminId, noteContent) => {
  if (!noteContent) {
    const err = new Error('Le contenu de la note est obligatoire.');
    err.codeName = 'ticket.validation_error';
    throw err;
  }

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    const err = new Error('Ticket introuvable.');
    err.codeName = 'ticket.not_found';
    throw err;
  }

  // Un ticket ne conserve qu'une seule note interne : on la remplace si elle existe déjà.
  if (ticket.internalNotes.length > 0) {
    ticket.internalNotes[0].admin = adminId;
    ticket.internalNotes[0].content = noteContent;
    ticket.internalNotes[0].createdAt = new Date();
  } else {
    ticket.internalNotes.push({
      admin: adminId,
      content: noteContent
    });
  }

  await ticket.save();
  return getTicketById(ticketId, adminId, 'admin');
};

module.exports = {
  createTicket,
  getTickets,
  getTicketById,
  addMessageToTicket,
  updateTicketStatus,
  addInternalNote
};
