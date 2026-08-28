const generalConfigService = require('../services/generalConfig.service');

const getConfig = async (req, res, next) => {
  try {
    const config = await generalConfigService.getConfig();
    res.status(200).json({ success: true, config });
  } catch (error) {
    next(error);
  }
};

const updateConfig = async (req, res, next) => {
  try {
    const config = await generalConfigService.updateConfig(req.body);
    res.status(200).json({ success: true, message: 'Configuration générale mise à jour.', config });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConfig,
  updateConfig,
};
