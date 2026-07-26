const mongoose = require('mongoose');

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
  // Retro-compatibilité avec date simple
  date: { type: Date },
}, {
  timestamps: true,
});

// Middleware pre-save pour synchroniser date et status
sessionSchema.pre('save', function (next) {
  if (this.startDate && !this.date) {
    this.date = this.startDate;
  }
  next();
});

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
