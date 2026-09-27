const notificationService = require('../services/notification.service');

const getNotifications = async (req, res, next) => {
  try {
    res.json(await notificationService.getSellerNotifications(req.user._id));
  } catch (error) { next(error); }
};

const markAsRead = async (req, res, next) => {
  try {
    res.json(await notificationService.markSellerNotificationAsRead(req.params.id, req.user._id));
  } catch (error) { next(error); }
};

const markAllAsRead = async (req, res, next) => {
  try {
    res.json(await notificationService.markAllSellerNotificationsAsRead(req.user._id));
  } catch (error) { next(error); }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };
