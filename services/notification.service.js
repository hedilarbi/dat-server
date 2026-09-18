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
    category: 'inscription',
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
    category: 'dossier_vehicule',
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

/**
 * Un véhicule vient d'atteindre le nombre de mises en vente autorisé (Configuration >
 * Configuration générale, champ « Tentatives de mise en vente ») sans trouver preneur : il
 * réclame une décision commerciale (baisse du prix de réserve, retrait...).
 */
const createAdminVehicleMaxAttemptsNotification = async (dossier, seller, listingCount) => {
  const vehicleLabel = [dossier.brand, dossier.model].filter(Boolean).join(' ') || 'Véhicule';
  const sellerLabel = seller?.companyName || [seller?.firstName, seller?.lastName].filter(Boolean).join(' ') || 'Un vendeur';

  return Notification.create({
    recipientRole: 'admin',
    type: 'vehicle_max_attempts_reached',
    category: 'dossier_vehicule',
    title: 'Véhicule invendu à plusieurs reprises',
    message: `Le véhicule ${vehicleLabel} de ${sellerLabel} a été mis en vente ${listingCount} fois sans trouver preneur.`,
    createdByUser: seller?._id,
    metadata: {
      dossierId: dossier._id.toString(),
      sellerId: seller?._id ? seller._id.toString() : null,
      companyName: seller?.companyName || null,
      vehicleLabel,
      listingCount
    }
  });
};

const createAdminTicketNotification = async (ticket, user) => {
  return Notification.create({
    recipientRole: 'admin',
    type: 'ticket_created',
    category: 'support',
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

const createAdminLatePaymentNotification = async (sale, vehicle, buyer) => {
  const vehicleLabel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Véhicule';

  return Notification.create({
    recipientRole: 'admin',
    type: 'late_payment_alert',
    category: 'ventes',
    title: `Alerte: Paiement véhicule en retard`,
    message: `L'acheteur ${buyer.firstName} ${buyer.lastName} a atteint 75 % du délai pour payer le véhicule ${vehicleLabel}.`,
    metadata: {
      saleId: sale._id.toString(),
      vehicleId: vehicle._id.toString(),
      buyerId: buyer._id.toString()
    }
  });
};

const createAdminCertificateRejectedNotification = async (sale, vehicle, buyer, seller) => {
  const vehicleLabel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Véhicule';

  return Notification.create({
    recipientRole: 'admin',
    type: 'certificate_rejected',
    category: 'ventes',
    title: `Alerte: Certificat refusé`,
    message: `Le vendeur ${seller.companyName || seller.firstName + ' ' + seller.lastName} a refusé le certificat de cession de ${buyer.companyName || buyer.firstName + ' ' + buyer.lastName} pour le véhicule ${vehicleLabel}.`,
    metadata: {
      saleId: sale._id.toString(),
      vehicleId: vehicle._id.toString(),
      sellerId: seller._id.toString(),
      buyerId: buyer._id.toString()
    }
  });
};

module.exports = {
  getAdminNotifications,
  createAdminRegistrationNotification,
  createAdminVehicleDossierNotification,
  createAdminVehicleMaxAttemptsNotification,
  createAdminTicketNotification,
  createAdminLatePaymentNotification,
  createAdminCertificateRejectedNotification,
  markNotificationAsRead,
  markAllAdminNotificationsAsRead
};
