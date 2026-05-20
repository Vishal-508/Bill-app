/**
 * Shared package for Shree Gopal MDF App.
 * Will export Zod schemas, constants, and validators used across:
 * - backend (Express controllers, validators)
 * - admin-dashboard (form validation)
 * - customer-client (form validation)
 */

const HELLO = 'shared package loaded';

module.exports = { HELLO };
