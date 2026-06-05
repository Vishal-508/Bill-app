import { cn } from '../../utils/cn.js';
import { getBadgeClasses } from './_styles.js';

export function Badge({ variant = 'neutral', size = 'md', dot = false, className, children }) {
  const dotColor = {
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger:  'bg-danger-500',
    info:    'bg-info-500',
    neutral: 'bg-secondary-500',
  }[variant] || 'bg-secondary-500';
  return (
    <span className={cn(getBadgeClasses({ variant, size }), className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColor)} aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Badge;
