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
  orders: {
    all:         ['orders'],
    lists:       ['orders', 'list'],
    list:        (params) => ['orders', 'list', params || {}],
    details:     ['orders', 'detail'],
    detail:      (id) => ['orders', 'detail', String(id)],
    payments:    (id) => ['orders', 'detail', String(id), 'payments'],
    customerDues:(customerId) => ['orders', 'customer-dues', String(customerId)],
    outstanding: ['orders', 'outstanding-payments'],
  },
  bills: {
    all:        ['bills'],
    lists:      ['bills', 'list'],
    list:       (params) => ['bills', 'list', params || {}],
    details:    ['bills', 'detail'],
    detail:     (id) => ['bills', 'detail', String(id)],
    byOrder:    (orderId) => ['bills', 'by-order', String(orderId)],
    byCustomer: (customerId) => ['bills', 'by-customer', String(customerId)],
  },
  payments: {
    all:        ['payments'],
    lists:      ['payments', 'list'],
    list:       (params) => ['payments', 'list', params || {}],
    details:    ['payments', 'detail'],
    detail:     (id) => ['payments', 'detail', String(id)],
    byOrder:    (orderId) => ['payments', 'by-order', String(orderId)],
    byCustomer: (customerId) => ['payments', 'by-customer', String(customerId)],
    refunds:    ['payments', 'refunds'],
    config:     ['payments', 'config'],
  },
};
