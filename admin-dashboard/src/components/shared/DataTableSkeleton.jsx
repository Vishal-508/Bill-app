import { cn } from '../../utils/cn.js';
import { getCellPadding } from './_dataTableStyles.js';

/**
 * Loading skeleton that matches the column + row count so the layout
 * doesn't shift when real data arrives.
 */
export function DataTableSkeleton({ columnCount = 5, rowCount = 10, density = 'normal' }) {
  const padCls = getCellPadding(density);
  return (
    <tbody>
      {Array.from({ length: rowCount }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-t border-secondary-200">
          {Array.from({ length: columnCount }).map((__, colIdx) => (
            <td key={colIdx} className={cn(padCls)}>
              <div className="h-3 bg-secondary-200 rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export default DataTableSkeleton;
