/**
 * Wraps an async route handler to automatically catch errors
 * and pass them to Express's error middleware.
 * Eliminates the need for try/catch in every controller.
 *
 * Usage:
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await User.find();
 *     res.json(users);
 *   }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
