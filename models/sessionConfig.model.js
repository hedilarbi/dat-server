const mongoose = require('mongoose');

const sessionConfigSchema = new mongoose.Schema({
  // 1 = Lundi, 2 = Mardi, 3 = Mercredi, 4 = Jeudi, 5 = Vendredi, 6 = Samedi, 0 = Dimanche
  daysOfWeek: {
    type: [Number],
    default: [1, 3, 5], // Lundi, Mercredi, Vendredi
  },
  startTime: {
    type: String,
    default: '10:00',
  },
  durationHours: {
    type: Number,
    default: 48, // 48 heures par défaut
  },
  autoGenerateWeeks: {
    type: Number,
    default: 4, // Générer 4 semaines à l'avance
  },
  autoAssignVehicles: {
    type: Boolean,
    default: true, // Affecter automatiquement les véhicules validés
  },
}, {
  timestamps: true,
});

const SessionConfig = mongoose.model('SessionConfig', sessionConfigSchema);

module.exports = SessionConfig;
