const saleService = require('../services/sale.service');

const listMySales = async (req, res, next) => {
  try {
    const sales = await saleService.listBuyerSales(req.user._id);
    res.status(200).json({ success: true, ...sales });
  } catch (error) {
    next(error);
  }
};

const getMySale = async (req, res, next) => {
  try {
    const sale = await saleService.getBuyerSale(req.params.id, req.user._id);
    res.status(200).json({ success: true, sale });
  } catch (error) {
    next(error);
  }
};

const syncSignature = async (req, res, next) => {
  try {
    const { side } = await saleService.syncSignatureForUser(req.params.id, req.user._id);
    res.status(200).json({ success: true, side });
  } catch (error) {
    next(error);
  }
};

const getSaleVehicle = async (req, res, next) => {
  try {
    const vehicle = await saleService.getSaleVehicle(req.params.id, req.user._id);
    res.status(200).json({ success: true, vehicle });
  } catch (error) {
    next(error);
  }
};

const startCommissionPayment = async (req, res, next) => {
  try {
    const { clientSecret, amount } = await saleService.startCommissionPayment({
      saleId: req.params.id,
      buyerId: req.user._id,
      documentsDelivery: req.body.documentsDelivery,
      language: req.user.language,
    });
    res.status(200).json({ success: true, clientSecret, amount });
  } catch (error) {
    next(error);
  }
};

const startCommissionPaymentIntent = async (req, res, next) => {
  try {
    const { clientSecret, amount } = await saleService.startCommissionPaymentIntent({
      saleId: req.params.id,
      buyerId: req.user._id,
      documentsDelivery: req.body.documentsDelivery,
    });
    res.status(200).json({ success: true, clientSecret, amount });
  } catch (error) {
    next(error);
  }
};

const confirmCommissionPayment = async (req, res, next) => {
  try {
    const sale = await saleService.confirmCommissionPayment({
      saleId: req.params.id,
      buyerId: req.user._id,
      checkoutSessionId: req.body.checkoutSessionId,
    });
    res.status(200).json({
      success: true,
      message: 'Commission réglée. Vous pouvez passer au virement au vendeur.',
      sale: await saleService.getBuyerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const listSellerSales = async (req, res, next) => {
  try {
    // Deux vues du même périmètre : les groupes historiques, dont dépend le tableau de
    // bord, et la liste par véhicule avec son état, utilisée par la page « Mes ventes ».
    const [sales, vehicleView] = await Promise.all([
      saleService.listSellerSales(req.user._id),
      saleService.listSellerVehicles(req.user._id),
    ]);
    res.status(200).json({ success: true, ...sales, vehicleStates: vehicleView });
  } catch (error) {
    next(error);
  }
};

const getSellerSale = async (req, res, next) => {
  try {
    const sale = await saleService.getSellerSale(req.params.id, req.user._id);
    res.status(200).json({ success: true, sale });
  } catch (error) {
    next(error);
  }
};

const acceptSellerOffer = async (req, res, next) => {
  try {
    const sale = await saleService.acceptSellerOffer({
      vehicleId: req.params.vehicleId,
      offerId: req.params.offerId,
      sellerId: req.user._id,
    });
    res.status(200).json({
      success: true,
      message: "Offre acceptée. La procédure d'achat a commencé.",
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const relistSuspendedVehicle = async (req, res, next) => {
  try {
    const sale = await saleService.relistSuspendedVehicle({ saleId: req.params.id, sellerId: req.user._id });
    res.status(200).json({ success: true, message: 'Le véhicule est de nouveau disponible pour une session.', sale });
  } catch (error) {
    next(error);
  }
};

const confirmTransferReceived = async (req, res, next) => {
  try {
    const sale = await saleService.confirmTransferReceived({
      saleId: req.params.id,
      sellerId: req.user._id,
    });
    res.status(200).json({
      success: true,
      message: 'Réception du virement confirmée.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const submitRegistrationCard = async (req, res, next) => {
  try {
    const sale = await saleService.submitRegistrationCard({
      saleId: req.params.id,
      sellerId: req.user._id,
      formulaNumber: req.body.formulaNumber,
      registrationCardMissingMotif: req.body.registrationCardMissingMotif,
    });
    res.status(200).json({
      success: true,
      message: 'Données de la carte grise enregistrées.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

// Étape 3.2 : chaque partie reçoit la vente telle qu'elle la voit depuis son propre espace.
const saleForSide = (side, saleId, userId) => (side === 'seller'
  ? saleService.getSellerSale(saleId, userId)
  : saleService.getBuyerSale(saleId, userId));

const reviewDocuments = async (req, res, next) => {
  try {
    const { side } = await saleService.reviewDocuments({
      saleId: req.params.id,
      userId: req.user._id,
      decision: req.body.decision,
      reason: req.body.reason,
      comment: req.body.comment,
    });
    res.status(200).json({
      success: true,
      message: req.body.decision === 'valide' ? 'Documents validés.' : 'Erreur signalée. Vous pouvez déposer des documents corrigés.',
      sale: await saleForSide(side, req.params.id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const uploadReviewDocument = async (req, res, next) => {
  try {
    const { side } = await saleService.uploadReviewDocument({
      saleId: req.params.id,
      userId: req.user._id,
      document: req.body.document,
      url: req.body.url,
      filename: req.body.filename,
    });
    res.status(200).json({
      success: true,
      message: 'Document déposé. Les deux parties doivent de nouveau vérifier les documents.',
      sale: await saleForSide(side, req.params.id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const cancelSaleByBuyer = async (req, res, next) => {
  try {
    const sale = await saleService.cancelSaleByBuyer({
      saleId: req.params.id,
      buyerId: req.user._id,
    });
    res.status(200).json({
      success: true,
      message: 'Vente annulée et compte suspendu.',
      sale,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listMySales,
  getMySale,
  syncSignature,
  getSaleVehicle,
  startCommissionPayment,
  startCommissionPaymentIntent,
  confirmCommissionPayment,
  listSellerSales,
  getSellerSale,
  acceptSellerOffer,
  relistSuspendedVehicle,
  confirmTransferReceived,
  submitRegistrationCard,
  reviewDocuments,
  uploadReviewDocument,
  cancelSaleByBuyer,
};
