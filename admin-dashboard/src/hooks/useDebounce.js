import { useState, useEffect } from 'react';

/**
 * Returns a value that lags `value` by `delay` ms. Typical use:
 *   const debouncedSearch = useDebounce(searchInput, 300);
 *   useEffect(() => { fetchResults(debouncedSearch); }, [debouncedSearch]);
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
