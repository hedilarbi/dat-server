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

const submitSignedCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.submitSignedCertificate({
      saleId: req.params.id,
      buyerId: req.user._id,
      url: req.body.url,
      filename: req.body.filename,
    });
    res.status(200).json({
      success: true,
      message: 'Dossier signé et tamponné déposé. Le vendeur va le vérifier.',
      sale: await saleService.getBuyerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const submitSellerCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.submitSellerCertificate({
      saleId: req.params.id,
      sellerId: req.user._id,
      url: req.body.url,
      filename: req.body.filename,
    });
    res.status(200).json({
      success: true,
      message: 'Dossier signé et tamponné déposé.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
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

const processRegistrationCard = async (req, res, next) => {
  try {
    const sale = await saleService.processRegistrationCard({
      saleId: req.params.id,
      sellerId: req.user._id,
      formulaNumber: req.body.formulaNumber,
      registrationCardMissingMotif: req.body.registrationCardMissingMotif,
    });
    res.status(200).json({
      success: true,
      message: 'Données de la carte grise enregistrées et documents générés.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const validateSignedCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.validateSignedCertificate({
      saleId: req.params.id,
      sellerId: req.user._id,
    });
    res.status(200).json({
      success: true,
      message: 'Documents validés. Le bon d’enlèvement est maintenant disponible.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const rejectSignedCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.rejectSignedCertificate({
      saleId: req.params.id,
      sellerId: req.user._id,
      reason: req.body.reason,
      comment: req.body.comment,
    });
    res.status(200).json({
      success: true,
      message: 'Certificat refusé. L’acheteur a été invité à en redéposer un.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const confirmHandover = async (req, res, next) => {
  try {
    const sale = await saleService.confirmHandover({
      saleId: req.params.id,
      sellerId: req.user._id,
      otp: req.body.otp,
    });
    res.status(200).json({
      success: true,
      message: 'Enlèvement confirmé. La vente est clôturée.',
      sale: await saleService.getSellerSale(sale._id, req.user._id),
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

const validateSellerCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.validateSellerCertificate({
      saleId: req.params.id,
      buyerId: req.user._id,
    });
    res.status(200).json({
      success: true,
      message: 'Certificat vendeur validé.',
      sale: await saleService.getBuyerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

const rejectSellerCertificate = async (req, res, next) => {
  try {
    const sale = await saleService.rejectSellerCertificate({
      saleId: req.params.id,
      buyerId: req.user._id,
      reason: req.body.reason,
      comment: req.body.comment,
    });
    res.status(200).json({
      success: true,
      message: 'Certificat vendeur refusé. Le vendeur a été invité à en redéposer un.',
      sale: await saleService.getBuyerSale(sale._id, req.user._id),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listMySales,
  getMySale,
  getSaleVehicle,
  startCommissionPayment,
  startCommissionPaymentIntent,
  confirmCommissionPayment,
  submitSignedCertificate,
  submitSellerCertificate,
  validateSellerCertificate,
  rejectSellerCertificate,
  listSellerSales,
  getSellerSale,
  confirmTransferReceived,
  processRegistrationCard,
  validateSignedCertificate,
  rejectSignedCertificate,
  confirmHandover,
  cancelSaleByBuyer,
};
