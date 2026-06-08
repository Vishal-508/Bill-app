/**
 * React Query key factory. Every queryKey in the app comes from here
 * so that:
 *   - We never typo a key in two places (cache miss + stale data)
 *   - Invalidations can target either a whole module (`customers.all`)
 *     or a specific entity (`customers.detail(id)`)
 *   - Adding a new entity = one place to edit
 *
 * Convention: keys are arrays. The first element is the entity. The
 * second element scopes the query (list/detail/insights/etc). Trailing
 * elements are params. Tanstack treats array prefixes structurally —
 * `invalidateQueries({ queryKey: ['customers'] })` matches every
 * customer-related key.
 */
export const queryKeys = {
  customers: {
    all:      ['customers'],
    lists:    ['customers', 'list'],
    list:     (params) => ['customers', 'list', params || {}],
    details:  ['customers', 'detail'],
    detail:   (id) => ['customers', 'detail', String(id)],
    insights: (id) => ['customers', 'insights', String(id)],
  },
  products: {
    all:      ['products'],
    lists:    ['products', 'list'],
    list:     (params) => ['products', 'list', params || {}],
    details:  ['products', 'detail'],
    detail:   (id) => ['products', 'detail', String(id)],
    lowStock: ['products', 'low-stock'],
  },
};
