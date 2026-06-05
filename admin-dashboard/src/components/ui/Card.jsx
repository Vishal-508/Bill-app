import { cn } from '../../utils/cn.js';

export function Card({ className, children }) {
  return (
    <div className={cn('bg-white rounded-lg shadow-card border border-secondary-200', className)}>
      {children}
    </div>
  );
}

function CardHeader({ title, actions, className, children }) {
  return (
    <div className={cn('px-5 py-3 border-b border-secondary-200 flex items-center justify-between', className)}>
      <div className="flex-1">
        {title && <h3 className="text-base font-semibold text-secondary-900">{title}</h3>}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function CardBody({ className, children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

function CardFooter({ className, children }) {
  return (
    <div className={cn('px-5 py-3 border-t border-secondary-200 bg-secondary-50', className)}>
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export default Card;
