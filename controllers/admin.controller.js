const adminService = require('../services/admin.service');
const notificationService = require('../services/notification.service');

const getUsers = async (req, res, next) => {
  try {
    const { role, status, search, page, limit } = req.query;
    const result = await adminService.getUsers({ role, status, search, page, limit });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const approveUser = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const user = await adminService.approveUser(userId);
    res.status(200).json({ success: true, message: 'Inscription approuvée.', user });
  } catch (error) {
    next(error);
  }
};

const rejectUser = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { motifs, comment } = req.body;

    const user = await adminService.rejectUser(userId, { motifs, comment });
    res.status(200).json({ success: true, message: 'Inscription rejetée.', user });
  } catch (error) {
    next(error);
  }
};

const requestCorrection = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { motifs, comment } = req.body;

    const user = await adminService.requestCorrection(userId, { motifs, comment });
    res.status(200).json({ success: true, message: 'Correction demandée.', user });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { status } = req.body;

    const user = await adminService.updateUserStatus(userId, status);
    res.status(200).json({ success: true, message: `Statut utilisateur mis à jour : ${status}.`, user });
  } catch (error) {
    next(error);
  }
};

const getNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.getAdminNotifications();
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  try {
    const notification = await notificationService.markNotificationAsRead(req.params.id);
    res.status(200).json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllAdminNotificationsAsRead();
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  approveUser,
  rejectUser,
  requestCorrection,
  updateStatus,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
};
