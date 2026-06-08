import { Phone, Mail, MapPin, Building2 } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatPhone } from '../../utils/format.js';
import { getInitials } from '../../utils/initials.js';

export default function CustomerHeader({ customer }) {
  if (!customer) return null;

  const initials = getInitials(customer.customerName);
  const addr = customer.billingAddress || {};
  const location = [addr.city, addr.state].filter(Boolean).join(', ');

  return (
    <Card>
      <Card.Body className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Avatar (initials) */}
        <div className="h-16 w-16 flex-shrink-0 rounded-xl bg-primary-600 text-white
                        flex items-center justify-center text-xl font-semibold">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-secondary-900 truncate">
              {customer.customerName}
            </h2>
            <Badge variant={customer.isActive ? 'success' : 'danger'} size="sm">
              {customer.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {customer.gstin && (
              <Badge variant="info" size="sm">GST</Badge>
            )}
          </div>

          {customer.companyName && (
            <div className="flex items-center gap-1.5 mt-0.5 text-sm text-secondary-600">
              <Building2 size={14} aria-hidden="true" />
              <span className="truncate">{customer.companyName}</span>
            </div>
          )}

          {customer.gstin && (
            <div className="mt-1 text-xs text-secondary-500">
              GSTIN: <span className="font-mono text-secondary-700">{customer.gstin}</span>
            </div>
          )}

          {/* Quick contact strip */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            <span className="inline-flex items-center gap-1.5 text-secondary-700">
              <Phone size={14} className="text-secondary-400" />
              <a href={`tel:${customer.phone}`} className="hover:text-primary-700">
                {formatPhone(customer.phone)}
              </a>
            </span>
            {customer.email && (
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <Mail size={14} className="text-secondary-400" />
                <a href={`mailto:${customer.email}`} className="hover:text-primary-700 break-all">
                  {customer.email}
                </a>
              </span>
            )}
            {location && (
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <MapPin size={14} className="text-secondary-400" />
                {location}
              </span>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
