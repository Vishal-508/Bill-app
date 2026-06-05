import { cn } from '../../utils/cn.js';
import { Button } from './Button.jsx';

/**
 * Empty-state placeholder for lists, dropdowns, search-no-results, etc.
 *
 * Convention: pass `icon` as a JSX ELEMENT (e.g. `<Bell size={24} />`),
 * NOT a component reference. This matches the React-children pattern,
 * lets the caller control size/color, and avoids the forwardRef-vs-
 * function-component ambiguity that bit us once (lucide icons are
 * forwardRef objects, not plain functions).
 */
export function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cn('text-center py-12 px-4', className)}>
      {icon && (
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-secondary-100
                        flex items-center justify-center text-secondary-400">
          {icon}
        </div>
      )}
      {title && <h3 className="text-base font-semibold text-secondary-900">{title}</h3>}
      {description && (
        <p className="mt-1 text-sm text-secondary-500 max-w-sm mx-auto">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          <Button onClick={action.onClick} variant="primary">{action.label}</Button>
        </div>
      )}
    </div>
  );
}

export default EmptyState;
