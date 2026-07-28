const Notification = require('../models/notification.model');

const getAdminNotifications = async () => {
  const notifications = await Notification.find({ recipientRole: 'admin' })
    .populate('createdByUser', 'email firstName lastName companyName role status')
    .sort({ createdAt: -1 })
    .limit(50);

  const unreadCount = await Notification.countDocuments({
    recipientRole: 'admin',
    readAt: null
  });

  return { notifications, unreadCount };
};

const createAdminRegistrationNotification = async (user) => {
  const roleLabel = user.role === 'vendeur' ? 'vendeur' : 'acheteur';

  return Notification.create({
    recipientRole: 'admin',
    type: 'registration_submitted',
    title: `Nouvelle inscription ${roleLabel}`,
    message: `${user.companyName} a soumis un dossier ${roleLabel} à valider.`,
    createdByUser: user._id,
    metadata: {
      userId: user._id.toString(),
      role: user.role,
      status: user.status,
      companyName: user.companyName
    }
  });
};

const createAdminVehicleDossierNotification = async (dossier, seller) => {
  const vehicleLabel = [dossier.brand, dossier.model].filter(Boolean).join(' ') || 'Véhicule';

  return Notification.create({
    recipientRole: 'admin',
    type: 'vehicle_dossier_submitted',
    title: 'Nouveau dossier véhicule soumis',
    message: `${seller.companyName} a soumis un dossier véhicule (${vehicleLabel}) à valider.`,
    createdByUser: seller._id,
    metadata: {
      dossierId: dossier._id.toString(),
      sellerId: seller._id.toString(),
      companyName: seller.companyName,
      vehicleLabel
    }
  });
};

const createAdminTicketNotification = async (ticket, user) => {
  return Notification.create({
    recipientRole: 'admin',
    type: 'ticket_created',
    title: 'Nouvelle demande de support',
    message: `${user.companyName} a ouvert une demande de support : "${ticket.title}".`,
    createdByUser: user._id,
    metadata: {
      ticketId: ticket._id.toString(),
      userId: user._id.toString(),
      companyName: user.companyName,
      category: ticket.category,
      title: ticket.title
    }
  });
};

const markNotificationAsRead = async (notificationId) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, recipientRole: 'admin' },
    { $set: { readAt: new Date() } },
    { new: true }
  ).populate('createdByUser', 'email firstName lastName companyName role status');

  if (!notification) {
    const err = new Error('Notification introuvable.');
    err.codeName = 'notification.not_found';
    throw err;
  }

  return notification;
};

const markAllAdminNotificationsAsRead = async () => {
  await Notification.updateMany(
    { recipientRole: 'admin', readAt: null },
    { $set: { readAt: new Date() } }
  );

  return { message: 'Notifications marquées comme lues.' };
};

module.exports = {
  getAdminNotifications,
  createAdminRegistrationNotification,
  createAdminVehicleDossierNotification,
  createAdminTicketNotification,
  markNotificationAsRead,
  markAllAdminNotificationsAsRead
};
