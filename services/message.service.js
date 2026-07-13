const RefusalReason = require('../models/refusalReason.model');

// Pour le moment seules fr/en sont gérées depuis l'interface admin ; ar/pl restent
// des champs optionnels au niveau du modèle pour une réactivation future.
const REQUIRED_LANGUAGES = ['fr', 'en'];

const validateTranslations = (field, value) => {
  if (!value || REQUIRED_LANGUAGES.some(lang => !value[lang])) {
    const err = new Error(`Le champ "${field}" doit être renseigné en français et en anglais.`);
    err.codeName = 'message.validation_error';
    throw err;
  }
};

/**
 * Récupérer les messages de refus / correction (optionnellement filtrés par type)
 */
const getMessages = async (type) => {
  const query = {};
  if (type) query.type = type;
  return RefusalReason.find(query).sort({ createdAt: -1 });
};

/**
 * Créer un nouveau message (motif + libellé + texte, multilingue)
 */
const createMessage = async ({ key, label, message, type }) => {
  if (!key || !type) {
    const err = new Error('Clé et type requis.');
    err.codeName = 'message.validation_error';
    throw err;
  }
  validateTranslations('label', label);
  validateTranslations('message', message);

  const existing = await RefusalReason.findOne({ key });
  if (existing) {
    const err = new Error('Un message avec cette clé existe déjà.');
    err.codeName = 'message.duplicate_key';
    throw err;
  }

  const reason = new RefusalReason({ key, label, message, type });
  await reason.save();
  return reason;
};

/**
 * Mettre à jour un message existant
 */
const updateMessage = async (key, { label, message, type }) => {
  const reason = await RefusalReason.findOne({ key });
  if (!reason) {
    const err = new Error('Message introuvable.');
    err.codeName = 'message.not_found';
    throw err;
  }

  if (label) {
    validateTranslations('label', label);
    reason.label = label;
  }
  if (message) {
    validateTranslations('message', message);
    reason.message = message;
  }
  if (type) reason.type = type;

  await reason.save();
  return reason;
};

/**
 * Supprimer un message
 */
const deleteMessage = async (key) => {
  const reason = await RefusalReason.findOneAndDelete({ key });
  if (!reason) {
    const err = new Error('Message introuvable.');
    err.codeName = 'message.not_found';
    throw err;
  }
  return { message: 'Message supprimé.' };
};

module.exports = {
  getMessages,
  createMessage,
  updateMessage,
  deleteMessage
};
