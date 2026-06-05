import clsx from 'clsx';

/**
 * Compose Tailwind class strings with conditional fragments.
 * Thin wrapper over clsx so the API stays familiar across the codebase.
 *
 * cn('foo', condition && 'bar', { 'baz': true }) → 'foo bar baz'
 */
export const cn = (...inputs) => clsx(...inputs);

export default cn;
