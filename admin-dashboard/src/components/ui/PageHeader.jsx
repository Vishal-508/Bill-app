import { cn } from '../../utils/cn.js';

/**
 * Standard page header used at the top of list/detail pages.
 * Title + optional subtitle (count, breadcrumb) + actions slot.
 */
export function PageHeader({ title, subtitle, actions, className }) {
  return (
    <div className={cn(
      'flex flex-col gap-2 pb-4 border-b border-secondary-200',
      'sm:flex-row sm:items-end sm:justify-between',
      className,
    )}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-secondary-900 truncate">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-xs text-secondary-500">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}

export default PageHeader;
