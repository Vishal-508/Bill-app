import { forwardRef } from 'react';
import { cn } from '../../utils/cn.js';
import { getButtonClasses } from './_styles.js';
import { Spinner } from './Spinner.jsx';

export const Button = forwardRef(function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  type = 'button',
  className,
  children,
  ...rest
}, ref) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(getButtonClasses({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading
        ? <Spinner size={size === 'lg' ? 'md' : 'sm'} variant={variant === 'primary' || variant === 'danger' ? 'white' : 'primary'} />
        : leftIcon}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
