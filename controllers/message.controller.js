const messageService = require('../services/message.service');

const getMessages = async (req, res, next) => {
  try {
    const { type } = req.query;
    const messages = await messageService.getMessages(type);
    res.status(200).json({ success: true, messages });
  } catch (error) {
    next(error);
  }
};

const createMessage = async (req, res, next) => {
  try {
    const message = await messageService.createMessage(req.body);
    res.status(201).json({ success: true, message: 'Message créé.', data: message });
  } catch (error) {
    next(error);
  }
};

const updateMessage = async (req, res, next) => {
  try {
    const message = await messageService.updateMessage(req.params.key, req.body);
    res.status(200).json({ success: true, message: 'Message mis à jour.', data: message });
  } catch (error) {
    next(error);
  }
};

const deleteMessage = async (req, res, next) => {
  try {
    const result = await messageService.deleteMessage(req.params.key);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMessages,
  createMessage,
  updateMessage,
  deleteMessage
};
