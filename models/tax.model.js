const mongoose = require('mongoose');

/**
 * Taxe appliquée par la plateforme (ex. TVA sur la commission).
 * `value` est exprimée en pourcentage : 20 signifie 20 %.
 */
const taxSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

const Tax = mongoose.model('Tax', taxSchema);

module.exports = Tax;
