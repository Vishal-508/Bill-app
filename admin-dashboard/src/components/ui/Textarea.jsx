import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';

export const Textarea = forwardRef(function Textarea({
  id, label, error, helperText, rows = 4,
  required = false, className, ...rest
}, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  const stateCls = error
    ? 'border-danger-400 focus:border-danger-500 focus:ring-danger-400'
    : 'border-secondary-300 focus:border-primary-500 focus:ring-primary-400';
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'block w-full rounded-md border bg-white px-3 py-2 text-sm',
          'placeholder:text-secondary-400 focus:outline-none focus:ring-2',
          'disabled:bg-secondary-50 disabled:cursor-not-allowed',
          stateCls, className,
        )}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
      {!error && helperText && <p className="mt-1 text-xs text-secondary-500">{helperText}</p>}
    </div>
  );
});

export default Textarea;
