import { useState } from 'react';
import { X, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { getAlertClasses } from './_styles.js';

const DEFAULT_ICONS = {
  info:    Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error:   XCircle,
};

export function Alert({
  variant = 'info',
  title,
  closable = false,
  icon,
  className,
  children,
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const Icon = icon || DEFAULT_ICONS[variant] || Info;
  return (
    <div role="alert" className={cn(getAlertClasses({ variant }), className)}>
      <div className="flex gap-3">
        {Icon && <Icon size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />}
        <div className="flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && 'mt-1')}>{children}</div>}
        </div>
        {closable && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Dismiss"
            className="flex-shrink-0 opacity-70 hover:opacity-100"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default Alert;
