const { ProductAttribute } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

exports.list = asyncHandler(async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false';
  const filter = activeOnly ? { isActive: true } : {};
  const attrs = await ProductAttribute.find(filter).sort({ displayOrder: 1, label: 1 }).lean();
  res.json({ status: 'success', count: attrs.length, data: attrs });
});

exports.getById = asyncHandler(async (req, res) => {
  const attr = await ProductAttribute.findById(req.params.id);
  if (!attr) throw ApiError.notFound('Attribute not found');
  res.json({ status: 'success', data: attr });
});

exports.create = asyncHandler(async (req, res) => {
  const existing = await ProductAttribute.findOne({ name: req.body.name.toLowerCase() });
  if (existing) throw ApiError.conflict(`Attribute '${req.body.name}' already exists`);

  const attr = await ProductAttribute.create({
    ...req.body,
    isSystemDefault: false,
    createdBy: req.user._id,
  });

  logger.info(`Attribute created: ${attr.name} by ${req.user.email}`);
  res.status(201).json({ status: 'success', data: attr });
});

exports.update = asyncHandler(async (req, res) => {
  const attr = await ProductAttribute.findById(req.params.id);
  if (!attr) throw ApiError.notFound('Attribute not found');

  if (req.body.type && req.body.type !== attr.type) {
    throw ApiError.badRequest('Cannot change attribute type after creation. Create a new attribute instead.');
  }

  Object.assign(attr, req.body);
  attr.updatedBy = req.user._id;
  await attr.save();

  res.json({ status: 'success', data: attr });
});

exports.remove = asyncHandler(async (req, res) => {
  const attr = await ProductAttribute.findById(req.params.id);
  if (!attr) throw ApiError.notFound('Attribute not found');

  if (attr.isSystemDefault) {
    throw ApiError.forbidden('System-default attributes cannot be deleted. Set isActive: false instead.');
  }

  await attr.deleteOne();
  logger.info(`Attribute deleted: ${attr.name} by ${req.user.email}`);
  res.json({ status: 'success', message: `Attribute '${attr.label}' deleted` });
});
