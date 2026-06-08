import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/axios.js';

/**
 * Lightweight fetch of all ProductGrade docs for dropdowns.
 * Grades are a small, slow-changing set; cache aggressively.
 */
export function useProductGrades() {
  return useQuery({
    queryKey: ['product-grades', 'list'],
    queryFn: () => api.get('/product-grades').then(r => r.data),
    staleTime: 5 * 60_000,   // 5 minutes
  });
}
