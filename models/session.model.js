const mongoose = require('mongoose');
const commissionTierFields = require('./commissionTierFields');

// Tranches de commission propres à une session (utilisées uniquement si useDefault = false)
const sessionCommissionTierSchema = new mongoose.Schema(commissionTierFields);

const sessionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  durationHours: { type: Number, default: 48 },
  isManual: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['upcoming', 'open', 'closed', 'annulee', 'programmee', 'active', 'cloturee'],
    default: 'upcoming',
  },
  // Configuration de commission de la session. Par défaut, la session suit la
  // configuration globale (Configuration > Commissions) ; dès qu'elle est personnalisée,
  // useDefault passe à false et `tiers` fait foi pour cette session uniquement.
  commission: {
    useDefault: { type: Boolean, default: true },
    tiers: { type: [sessionCommissionTierSchema], default: [] },
  },
  // Date à laquelle les gagnants ont été désignés pour les véhicules de cette session.
  // Sert de garde-fou d'idempotence : une session déjà traitée ne l'est plus jamais.
  attributionsProcessedAt: { type: Date, default: null },
  // Retro-compatibilité avec date simple
  date: { type: Date },
}, {
  timestamps: true,
});

// Middleware pre-save pour synchroniser date et status
sessionSchema.pre('save', function () {
  if (this.startDate && !this.date) {
    this.date = this.startDate;
  }
});

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
