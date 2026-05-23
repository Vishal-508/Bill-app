const mongoose = require('mongoose');

/**
 * Reusable query builder for Mongoose
 * Centralizes pagination, sorting, field selection, and search logic.
 * Can be used across all list endpoints (customers, products, orders, etc.)
 */
class QueryBuilder {
  constructor(model, queryParams = {}) {
    this.model = model;
    this.queryParams = queryParams;
    this.filter = {};
    this.sortOptions = { createdAt: -1 };
    this.selectFields = null;
    this.populateFields = [];
    this.pageNum = 1;
    this.limitNum = 20;
  }

  // Set base filter (e.g., { isDeleted: false })
  setFilter(filter) {
    this.filter = { ...this.filter, ...filter };
    return this;
  }

  // Add a single filter key-value
  addFilter(key, value) {
    if (value !== undefined && value !== null && value !== '') {
      this.filter[key] = value;
    }
    return this;
  }

  // Range filter (e.g., createdAt between dates, price range)
  addRangeFilter(key, min, max) {
    const range = {};
    if (min !== undefined && min !== null && min !== '') range.$gte = min;
    if (max !== undefined && max !== null && max !== '') range.$lte = max;
    if (Object.keys(range).length > 0) {
      this.filter[key] = range;
    }
    return this;
  }

  // Text search across multiple fields (regex-based for partial matches)
  addTextSearch(searchTerm, fields) {
    if (!searchTerm || !searchTerm.trim()) return this;
    const trimmed = searchTerm.trim();
    // Escape regex special chars
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    this.filter.$or = fields.map((field) => ({ [field]: regex }));
    return this;
  }

  // Multi-value filter (e.g., ?tags=VIP,Trusted → all of these tags)
  addArrayFilter(key, value, mode = 'all') {
    if (!value) return this;
    const values = Array.isArray(value) ? value : value.split(',').map(v => v.trim()).filter(Boolean);
    if (values.length === 0) return this;

    if (mode === 'all') {
      this.filter[key] = { $all: values };
    } else if (mode === 'any') {
      this.filter[key] = { $in: values };
    }
    return this;
  }

  // Boolean filter (handles "true"/"false" strings)
  addBoolFilter(key, value) {
    if (value === 'true' || value === true) {
      this.filter[key] = true;
    } else if (value === 'false' || value === false) {
      this.filter[key] = false;
    }
    return this;
  }

  // Existence filter (e.g., hasGST=true → gstin: { $exists: true, $ne: null })
  addExistenceFilter(key, value, fieldName) {
    if (value === 'true' || value === true) {
      this.filter[fieldName] = { $exists: true, $nin: [null, ''] };
    } else if (value === 'false' || value === false) {
      this.filter[fieldName] = { $in: [null, '', undefined] };
    }
    return this;
  }

  // ObjectId filter (validate before adding)
  addObjectIdFilter(key, value) {
    if (value && mongoose.Types.ObjectId.isValid(value)) {
      this.filter[key] = value;
    }
    return this;
  }

  // Sort: "field1,-field2" → { field1: 1, field2: -1 }
  setSort(sortStr) {
    if (!sortStr) return this;
    const sortObj = {};
    sortStr.split(',').forEach((field) => {
      const trimmed = field.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('-')) {
        sortObj[trimmed.substring(1)] = -1;
      } else {
        sortObj[trimmed] = 1;
      }
    });
    if (Object.keys(sortObj).length > 0) {
      this.sortOptions = sortObj;
    }
    return this;
  }

  // Field selection: "name,phone,email" → "name phone email"
  setFields(fieldsStr) {
    if (!fieldsStr) return this;
    this.selectFields = fieldsStr.split(',').map(f => f.trim()).filter(Boolean).join(' ');
    return this;
  }

  // Add populate
  populate(field, select = '') {
    this.populateFields.push({ path: field, select });
    return this;
  }

  // Set pagination
  setPagination(page, limit) {
    this.pageNum = Math.max(1, parseInt(page) || 1);
    this.limitNum = Math.max(1, Math.min(100, parseInt(limit) || 20));
    return this;
  }

  // Execute the query and return results + pagination metadata
  async execute() {
    const skip = (this.pageNum - 1) * this.limitNum;

    let query = this.model.find(this.filter);

    if (this.selectFields) query = query.select(this.selectFields);

    this.populateFields.forEach(({ path, select }) => {
      query = query.populate(path, select);
    });

    query = query.sort(this.sortOptions).skip(skip).limit(this.limitNum);

    const [data, totalRecords] = await Promise.all([
      query.lean(),
      this.model.countDocuments(this.filter),
    ]);

    const totalPages = Math.ceil(totalRecords / this.limitNum);

    return {
      data,
      pagination: {
        page: this.pageNum,
        limit: this.limitNum,
        totalPages,
        totalRecords,
        hasNext: this.pageNum < totalPages,
        hasPrev: this.pageNum > 1,
      },
    };
  }
}

module.exports = QueryBuilder;
