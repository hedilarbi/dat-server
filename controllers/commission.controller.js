const commissionService = require('../services/commission.service');

const getTiers = async (req, res, next) => {
  try {
    const tiers = await commissionService.getTiers();
    res.status(200).json({ success: true, tiers });
  } catch (error) {
    next(error);
  }
};

const createTier = async (req, res, next) => {
  try {
    const tier = await commissionService.createTier(req.body);
    res.status(201).json({ success: true, message: 'Tranche de commission créée.', data: tier });
  } catch (error) {
    next(error);
  }
};

const updateTier = async (req, res, next) => {
  try {
    const tier = await commissionService.updateTier(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Tranche de commission mise à jour.', data: tier });
  } catch (error) {
    next(error);
  }
};

const deleteTier = async (req, res, next) => {
  try {
    const result = await commissionService.deleteTier(req.params.id);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const simulate = async (req, res, next) => {
  try {
    const result = await commissionService.calculateCommission(req.query.amount);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  simulate
};
