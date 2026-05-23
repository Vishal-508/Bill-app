const { ProductGrade, Product } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

exports.list = asyncHandler(async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false';
  const filter = activeOnly ? { isActive: true } : {};
  const grades = await ProductGrade.find(filter).sort({ displayOrder: 1, label: 1 }).lean();
  res.json({ status: 'success', count: grades.length, data: grades });
});

exports.getById = asyncHandler(async (req, res) => {
  const grade = await ProductGrade.findById(req.params.id);
  if (!grade) throw ApiError.notFound('Grade not found');
  res.json({ status: 'success', data: grade });
});

exports.create = asyncHandler(async (req, res) => {
  const existing = await ProductGrade.findByCode(req.body.code);
  if (existing) throw ApiError.conflict(`Grade '${req.body.code}' already exists`);

  const grade = await ProductGrade.create({
    ...req.body,
    isSystemDefault: false,
    createdBy: req.user._id,
  });

  logger.info(`Grade created: ${grade.code} by ${req.user.email}`);
  res.status(201).json({ status: 'success', data: grade });
});

exports.update = asyncHandler(async (req, res) => {
  const grade = await ProductGrade.findById(req.params.id);
  if (!grade) throw ApiError.notFound('Grade not found');

  if (req.body.code && req.body.code.toUpperCase() !== grade.code) {
    const conflict = await ProductGrade.findByCode(req.body.code);
    if (conflict) throw ApiError.conflict(`Grade '${req.body.code}' already exists`);
  }

  Object.assign(grade, req.body);
  grade.updatedBy = req.user._id;
  await grade.save();

  res.json({ status: 'success', data: grade });
});

exports.remove = asyncHandler(async (req, res) => {
  const grade = await ProductGrade.findById(req.params.id);
  if (!grade) throw ApiError.notFound('Grade not found');

  if (grade.isSystemDefault) {
    throw ApiError.forbidden('System-default grades cannot be deleted. Set isActive: false instead.');
  }

  const productCount = await Product.countDocuments({ grade: grade._id, isDeleted: false });
  if (productCount > 0) {
    throw ApiError.conflict(`Cannot delete: ${productCount} product(s) use this grade. Reassign first.`);
  }

  await grade.deleteOne();
  logger.info(`Grade deleted: ${grade.code} by ${req.user.email}`);
  res.json({ status: 'success', message: `Grade '${grade.label}' deleted` });
});
