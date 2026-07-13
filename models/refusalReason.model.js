const mongoose = require('mongoose');

const refusalReasonSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  label: {
    fr: { type: String, required: true },
    ar: { type: String },
    en: { type: String, required: true },
    pl: { type: String }
  },
  message: {
    fr: { type: String, required: true },
    ar: { type: String },
    en: { type: String, required: true },
    pl: { type: String }
  },
  type: {
    type: String,
    enum: ['inscription', 'document', 'vehicule'],
    required: true
  }
}, {
  timestamps: true
});

const RefusalReason = mongoose.model('RefusalReason', refusalReasonSchema);

module.exports = RefusalReason;
