const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderRole: {
    type: String,
    enum: ['admin', 'vendeur', 'acheteur'],
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  attachments: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

const ticketSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['inscription', 'document', 'vehicule', 'offre', 'commission', 'paiement', 'enlèvement', 'litige', 'technique', 'general', 'autre'],
    default: 'general'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  priority: {
    type: String,
    enum: ['basse', 'normale', 'haute'],
    default: 'normale'
  },
  status: {
    type: String,
    enum: ['ouverte', 'en_attente_admin', 'en_attente_utilisateur', 'en_cours', 'cloturee', 'reouverte'],
    default: 'ouverte'
  },
  messages: [messageSchema],
  // Notes internes réservées à l'administrateur
  internalNotes: [{
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  closedAt: {
    type: Date
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = Ticket;
