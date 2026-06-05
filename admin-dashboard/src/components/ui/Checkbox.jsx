import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';

export const Checkbox = forwardRef(function Checkbox({
  id, label, description, disabled, className, ...rest
}, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex items-start gap-2.5 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        className="h-4 w-4 mt-0.5 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
        {...rest}
      />
      <div className="flex-1">
        {label && <div className="text-sm text-secondary-900">{label}</div>}
        {description && <div className="text-xs text-secondary-500">{description}</div>}
      </div>
    </label>
  );
});

export default Checkbox;
