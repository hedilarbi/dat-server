const offerService = require('../services/offer.service');

const quoteOffer = async (req, res, next) => {
  try {
    const quote = await offerService.quoteOffer({
      vehicleId: req.body.vehicleId,
      amount: req.body.amount,
    });
    res.status(200).json({ success: true, quote });
  } catch (error) {
    next(error);
  }
};

const createOffer = async (req, res, next) => {
  try {
    const { offer, quote } = await offerService.createOffer({
      vehicleId: req.body.vehicleId,
      amount: req.body.amount,
      buyer: req.user,
    });
    res.status(201).json({ success: true, message: 'Votre offre a bien été enregistrée.', offer, quote });
  } catch (error) {
    next(error);
  }
};

const listMyOffers = async (req, res, next) => {
  try {
    const offers = await offerService.listBuyerOffers(req.user._id);
    res.status(200).json({ success: true, ...offers });
  } catch (error) {
    next(error);
  }
};

const updateOffer = async (req, res, next) => {
  try {
    const { offer, quote } = await offerService.updateOffer({
      offerId: req.params.id,
      buyerId: req.user._id,
      amount: req.body.amount,
    });
    res.status(200).json({ success: true, message: 'Votre offre a bien été modifiée.', offer, quote });
  } catch (error) {
    next(error);
  }
};

const cancelOffer = async (req, res, next) => {
  try {
    const offer = await offerService.cancelOffer({
      offerId: req.params.id,
      buyerId: req.user._id,
    });
    res.status(200).json({ success: true, message: 'Votre offre a bien été annulée.', offer });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  quoteOffer,
  createOffer,
  listMyOffers,
  updateOffer,
  cancelOffer,
};
