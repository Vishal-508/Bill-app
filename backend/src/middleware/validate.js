const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');

/**
 * Middleware factory: validate(schema, source)
 * Validates request data against a Zod schema.
 *
 * @param {ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Which part of req to validate: 'body' | 'query' | 'params'
 * @returns Express middleware
 *
 * Usage:
 *   router.post('/login', validate(loginSchema, 'body'), authController.login);
 *
 * On validation failure, throws 400 with field-level errors:
 *   {
 *     status: 'error',
 *     message: 'Validation failed',
 *     errors: { email: 'Invalid email', password: 'Required' }
 *   }
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const parsed = schema.parse(data);
      // Replace req[source] with parsed (and possibly transformed) data
      req[source] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Flatten Zod errors into { fieldName: 'message' } format
        const errors = {};
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          if (!errors[path]) {
            errors[path] = err.message;
          }
        });
        return next(ApiError.badRequest('Validation failed', errors));
      }
      next(error);
    }
  };
};

module.exports = validate;
