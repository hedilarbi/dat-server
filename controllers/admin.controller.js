const adminService = require('../services/admin.service');
const notificationService = require('../services/notification.service');
const saleService = require('../services/sale.service');

const getUsers = async (req, res, next) => {
  try {
    const { role, status, search, city, dateFrom, dateTo, page, limit, columnFilters } = req.query;
    const result = await adminService.getUsers({ role, status, search, city, dateFrom, dateTo, page, limit, columnFilters });
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

const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

const getSale = async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Vente introuvable.' });
    }
    const Sale = require('../models/sale.model');
    // Le dossier véhicule est renvoyé en entier : la fiche s'ouvre dans une modale, sans
    // second appel. Les pièces jointes lourdes (photos, documents) en font partie.
    const sale = await Sale.findById(req.params.id)
      .populate('vehicle')
      .populate('winner', 'firstName lastName companyName email phone address siret status role')
      .populate('seller', 'firstName lastName companyName email phone address siret status role bankInfo vhuNumber')
      .populate('session', 'name startDate endDate status')
      .populate('waitingList.buyer', 'firstName lastName companyName email phone')
      .lean();

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Vente introuvable.' });
    }

    res.status(200).json({
      success: true,
      data: {
        ...sale,
        // L'ordre des étapes vient du modèle : l'interface ne doit pas le redéclarer.
        steps: Sale.PURCHASE_STEPS,
        stepCount: Sale.PURCHASE_STEPS.length,
        stepKey: Sale.PURCHASE_STEPS[sale.currentStep - 1] || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

const toggleSaleTimer = async (req, res, next) => {
  try {
    const sale = await saleService.toggleSaleTimer(req.params.id, req.body.pause);
    res.status(200).json({ success: true, sale });
  } catch (error) {
    next(error);
  }
};

const extendSaleDeadline = async (req, res, next) => {
  try {
    const sale = await saleService.extendCurrentStepDeadline(req.params.id, req.body.hours);
    res.status(200).json({ success: true, message: 'Délai prolongé.', sale });
  } catch (error) {
    next(error);
  }
};

const promoteSaleNextBidder = async (req, res, next) => {
  try {
    const sale = await saleService.promoteNextBidder(req.params.id, 'decision_admin');
    res.status(200).json({
      success: true,
      message: sale?.status === 'sans_gagnant'
        ? "Plus aucun candidat en liste d'attente : la vente est close sans gagnant."
        : 'La vente est passée au candidat suivant.',
      sale,
    });
  } catch (error) {
    next(error);
  }
};

const forceEndSale = async (req, res, next) => {
  try {
    const sale = await saleService.forceEndSale(
      req.params.id,
      req.body.suspendBuyer,
      req.body.suspendSeller,
      req.body.promoteNext
    );
    res.status(200).json({ success: true, sale });
  } catch (error) {
    next(error);
  }
};

const getPayments = async (req, res, next) => {
  try {
    const { type, search } = req.query;
    const result = await adminService.listPayments({ type, search });
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
  markAllNotificationsAsRead,
  getDashboardStats,
  getSale,
  toggleSaleTimer,
  forceEndSale,
  extendSaleDeadline,
  promoteSaleNextBidder,
  getPayments,
};
