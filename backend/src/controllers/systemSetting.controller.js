const { SystemSetting } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

/**
 * GET /api/system-settings
 */
exports.list = asyncHandler(async (req, res) => {
  const { category } = req.query;

  const filter = { isActive: true };
  if (category) filter.category = category.toUpperCase();

  const settings = await SystemSetting.find(filter).sort({ category: 1, displayOrder: 1 });

  const grouped = settings.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {});

  res.json({ status: 'success', count: settings.length, data: { grouped, flat: settings } });
});

/**
 * GET /api/system-settings/:key
 */
exports.getByKey = asyncHandler(async (req, res) => {
  const setting = await SystemSetting.findOne({ key: req.params.key.toUpperCase() });
  if (!setting) throw ApiError.notFound(`Setting '${req.params.key}' not found`);

  res.json({ status: 'success', data: setting });
});

/**
 * PUT /api/system-settings/:key
 */
exports.update = asyncHandler(async (req, res) => {
  const setting = await SystemSetting.findOne({ key: req.params.key.toUpperCase() });
  if (!setting) throw ApiError.notFound(`Setting '${req.params.key}' not found`);

  if (!setting.isUserConfigurable) {
    throw ApiError.forbidden(`Setting '${setting.key}' is not user-configurable`);
  }

  const { value } = req.body;

  if (setting.valueType === 'number' && typeof value !== 'number') {
    throw ApiError.badRequest(`Value must be a number for '${setting.key}'`);
  }
  if (setting.valueType === 'boolean' && typeof value !== 'boolean') {
    throw ApiError.badRequest(`Value must be a boolean for '${setting.key}'`);
  }
  if (setting.valueType === 'enum' && !setting.options.includes(value)) {
    throw ApiError.badRequest(
      `Invalid value for '${setting.key}'. Allowed: ${setting.options.join(', ')}`
    );
  }

  const oldValue = setting.value;
  setting.value = value;
  setting.updatedBy = req.user._id;

  await setting.save();

  logger.info(`Setting updated: ${setting.key} = ${JSON.stringify(oldValue)} → ${JSON.stringify(value)} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Setting updated',
    data: { key: setting.key, oldValue, newValue: value },
  });
});

/**
 * POST /api/system-settings/:key/reset
 */
exports.reset = asyncHandler(async (req, res) => {
  const setting = await SystemSetting.findOne({ key: req.params.key.toUpperCase() });
  if (!setting) throw ApiError.notFound('Setting not found');

  if (setting.defaultValue === undefined) {
    throw ApiError.badRequest('No default value defined for this setting');
  }

  const oldValue = setting.value;
  setting.value = setting.defaultValue;
  setting.updatedBy = req.user._id;

  await setting.save();

  logger.info(`Setting reset: ${setting.key} = ${JSON.stringify(oldValue)} → ${JSON.stringify(setting.defaultValue)} by ${req.user.email}`);

  res.json({ status: 'success', message: 'Setting reset to default', data: setting });
});
