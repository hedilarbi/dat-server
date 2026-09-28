const Notification = require('../models/notification.model');
const VehicleDossier = require('../models/vehicleDossier.model');
const Sale = require('../models/sale.model');

const vehicleDetailsOf = (vehicle) => vehicle ? {
  registrationNumber: vehicle.registrationNumber || null,
  brand: vehicle.brand || null,
  model: vehicle.model || null,
} : null;

const vehicleDetailsText = (details) => details
  ? `Immatriculation : ${details.registrationNumber || '—'} · Marque : ${details.brand || '—'} · Modèle : ${details.model || '—'}`
  : null;

const withVehicleDetails = (message, details) => {
  const text = vehicleDetailsText(details);
  if (!text || message.includes('Immatriculation :')) return message;
  return `${message} — Véhicule : ${text}.`;
};

const findNotificationVehicle = async (metadata = {}) => {
  const directId = metadata.vehicleId || metadata.dossierId;
  if (directId) {
    return VehicleDossier.findById(directId).select('registrationNumber brand model').lean();
  }
  if (!metadata.saleId) return null;
  const sale = await Sale.findById(metadata.saleId).select('vehicle').lean();
  return sale?.vehicle
    ? VehicleDossier.findById(sale.vehicle).select('registrationNumber brand model').lean()
    : null;
};

const enrichSellerNotifications = async (notifications) => {
  const saleIds = notifications
    .filter((notification) => !notification.metadata?.vehicleId && !notification.metadata?.dossierId && notification.metadata?.saleId)
    .map((notification) => notification.metadata.saleId);
  const sales = saleIds.length
    ? await Sale.find({ _id: { $in: saleIds } }).select('vehicle').lean()
    : [];
  const vehicleBySale = new Map(sales.map((sale) => [String(sale._id), String(sale.vehicle)]));
  const vehicleIds = notifications.map((notification) => (
    notification.metadata?.vehicleId
    || notification.metadata?.dossierId
    || vehicleBySale.get(String(notification.metadata?.saleId || ''))
  )).filter(Boolean);
  const vehicles = vehicleIds.length
    ? await VehicleDossier.find({ _id: { $in: vehicleIds } }).select('registrationNumber brand model').lean()
    : [];
  const detailsByVehicle = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicleDetailsOf(vehicle)]));

  return notifications.map((notification) => {
    const vehicleId = notification.metadata?.vehicleId
      || notification.metadata?.dossierId
      || vehicleBySale.get(String(notification.metadata?.saleId || ''));
    const details = notification.metadata?.vehicleDetails || detailsByVehicle.get(String(vehicleId || ''));
    return details ? { ...notification, message: withVehicleDetails(notification.message, details) } : notification;
  });
};

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

const getSellerNotifications = async (sellerId) => {
  const scope = { recipientRole: 'vendeur', recipientUser: sellerId };
  const [notifications, unreadCount] = await Promise.all([
    Notification.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ ...scope, readAt: null })
  ]);
  return { notifications: await enrichSellerNotifications(notifications), unreadCount };
};

const createSellerNotification = async ({ sellerId, type, category = 'autre', title, message, metadata = {} }) => {
  const vehicle = await findNotificationVehicle(metadata);
  const vehicleDetails = vehicleDetailsOf(vehicle);
  const enrichedMetadata = vehicleDetails ? { ...metadata, vehicleDetails } : metadata;
  return Notification.create({
    recipientRole: 'vendeur',
    recipientUser: sellerId,
    type,
    category,
    title,
    message: withVehicleDetails(message, vehicleDetails),
    metadata: enrichedMetadata
  });
};

const markSellerNotificationAsRead = async (notificationId, sellerId) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, recipientRole: 'vendeur', recipientUser: sellerId },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) {
    const err = new Error('Notification introuvable.');
    err.codeName = 'notification.not_found';
    throw err;
  }
  return notification;
};

const markAllSellerNotificationsAsRead = async (sellerId) => {
  await Notification.updateMany(
    { recipientRole: 'vendeur', recipientUser: sellerId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { message: 'Notifications marquées comme lues.' };
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

const createAdminVehicleDossierChangedNotification = async (dossier, seller, action) => {
  const vehicleLabel = [dossier.brand, dossier.model].filter(Boolean).join(' ') || 'Véhicule';
  const sellerLabel = seller?.companyName || [seller?.firstName, seller?.lastName].filter(Boolean).join(' ') || 'Un vendeur';
  const deleted = action === 'deleted';

  return Notification.create({
    recipientRole: 'admin',
    type: deleted ? 'vehicle_dossier_deleted_by_seller' : 'vehicle_dossier_updated_by_seller',
    category: 'dossier_vehicule',
    title: deleted ? 'Dossier véhicule supprimé par le vendeur' : 'Dossier véhicule modifié par le vendeur',
    message: deleted
      ? `${sellerLabel} a supprimé le dossier véhicule ${vehicleLabel}.`
      : `${sellerLabel} a modifié le dossier véhicule ${vehicleLabel}. Il est de nouveau en attente de validation.`,
    createdByUser: seller?._id,
    metadata: {
      dossierId: deleted ? null : dossier._id.toString(),
      deletedDossierId: deleted ? dossier._id.toString() : null,
      sellerId: seller?._id ? seller._id.toString() : String(dossier.seller),
      companyName: seller?.companyName || null,
      vehicleLabel,
      action
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

/**
 * Un vendeur a choisi une offre avant la clôture de la session : le véhicule est retiré de la
 * session en cours et la procédure de vente démarre aussitôt, sans attendre la clôture.
 */
const createAdminSellerEarlyAcceptanceNotification = async (sale, vehicle, seller, session, amount) => {
  const vehicleLabel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Véhicule';
  const sellerLabel = seller?.companyName || [seller?.firstName, seller?.lastName].filter(Boolean).join(' ') || 'Un vendeur';

  return Notification.create({
    recipientRole: 'admin',
    type: 'seller_offer_accepted_early',
    category: 'ventes',
    title: 'Offre retenue avant la clôture de la session',
    message: `${sellerLabel} a retenu une offre de ${amount} € sur ${vehicleLabel} avant la clôture de ${session?.name || 'la session'}. Le véhicule est retiré de la session et la procédure de vente est lancée.`,
    createdByUser: seller?._id,
    metadata: {
      saleId: sale._id.toString(),
      vehicleId: vehicle._id.toString(),
      sellerId: seller?._id ? seller._id.toString() : null,
      sessionId: session?._id ? session._id.toString() : null,
      vehicleLabel,
      amount
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
  getSellerNotifications,
  createSellerNotification,
  markSellerNotificationAsRead,
  markAllSellerNotificationsAsRead,
  createAdminRegistrationNotification,
  createAdminVehicleDossierNotification,
  createAdminVehicleDossierChangedNotification,
  createAdminVehicleMaxAttemptsNotification,
  createAdminTicketNotification,
  createAdminLatePaymentNotification,
  createAdminSellerEarlyAcceptanceNotification,
  createAdminCertificateRejectedNotification,
  markNotificationAsRead,
  markAllAdminNotificationsAsRead
};
