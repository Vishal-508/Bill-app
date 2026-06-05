import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';
import { getInputClasses } from './_styles.js';

export const Select = forwardRef(function Select({
  id, label, error, helperText, options = [], placeholder,
  size = 'md', required = false, className, ...rest
}, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(getInputClasses({ error: !!error, size }), className)}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
      {!error && helperText && <p className="mt-1 text-xs text-secondary-500">{helperText}</p>}
    </div>
  );
});

export default Select;
