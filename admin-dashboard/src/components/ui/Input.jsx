import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';
import { getInputClasses } from './_styles.js';

export const Input = forwardRef(function Input({
  id, label, error, helperText, prefix, suffix,
  size = 'md', required = false, className, ...rest
}, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  const describedById = error
    ? `${inputId}-error`
    : helperText ? `${inputId}-helper` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-secondary-400">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedById}
          className={cn(
            getInputClasses({ error: !!error, size }),
            prefix && 'pl-9',
            suffix && 'pr-9',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-secondary-400">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-danger-600">{error}</p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="mt-1 text-xs text-secondary-500">{helperText}</p>
      )}
    </div>
  );
});

export default Input;
