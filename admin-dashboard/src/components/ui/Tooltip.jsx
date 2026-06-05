import { cn } from '../../utils/cn.js';

const POSITION_CLASSES = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

/**
 * Pure-CSS tooltip — hover or focus the trigger to reveal. The wrapper
 * uses `group` so the tooltip stays visible while the trigger or the
 * tooltip itself is hovered.
 */
export function Tooltip({ content, position = 'top', className, children }) {
  if (!content) return children;
  return (
    <span className={cn('relative inline-flex group', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'absolute z-50 whitespace-nowrap rounded bg-secondary-900 px-2 py-1 text-xs text-white',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          'pointer-events-none transition-opacity duration-150',
          POSITION_CLASSES[position] || POSITION_CLASSES.top,
        )}
      >
        {content}
      </span>
    </span>
  );
}

export default Tooltip;
