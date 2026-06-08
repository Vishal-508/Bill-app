import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { formatPhone, formatINR, formatDate } from '../../../utils/format.js';

function Section({ title, children }) {
  return (
    <Card>
      <Card.Header title={title} />
      <Card.Body className="space-y-2 text-sm">{children}</Card.Body>
    </Card>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-28 flex-shrink-0 text-xs uppercase tracking-wide text-secondary-500">
        {label}
      </div>
      <div className="flex-1 text-secondary-900 break-words">{children || <span className="text-secondary-400">—</span>}</div>
    </div>
  );
}

export default function OverviewTab({ customer }) {
  if (!customer) return null;
  const addr = customer.billingAddress || {};

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <Section title="Contact">
          <Row label="Phone">{formatPhone(customer.phone)}</Row>
          <Row label="Alt Phone">{customer.altPhone ? formatPhone(customer.altPhone) : null}</Row>
          <Row label="Email">{customer.email}</Row>
        </Section>

        <Section title="Billing Address">
          <Row label="Line 1">{addr.line1}</Row>
          {addr.line2 && <Row label="Line 2">{addr.line2}</Row>}
          <Row label="City">{addr.city}</Row>
          <Row label="State">{addr.state}{addr.stateCode ? ` (${addr.stateCode})` : ''}</Row>
          <Row label="Pincode">{addr.pincode}</Row>
        </Section>

        <Section title="Tax">
          <Row label="Bill Type">
            <Badge variant={customer.gstin ? 'info' : 'neutral'} size="sm">
              {customer.gstin ? 'GST' : 'NON_GST'}
            </Badge>
          </Row>
          {customer.gstin && (
            <Row label="GSTIN"><span className="font-mono">{customer.gstin}</span></Row>
          )}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Business Terms">
          <Row label="Credit Limit">
            {customer.creditLimit > 0 ? formatINR(customer.creditLimit) : null}
          </Row>
          <Row label="Current Dues">
            {customer.currentDues != null ? formatINR(customer.currentDues) : null}
          </Row>
          <Row label="Discount %">
            {customer.specialDiscountPct ? `${customer.specialDiscountPct}%` : null}
          </Row>
          <Row label="Preferred Unit">{customer.preferredUnit || null}</Row>
        </Section>

        {customer.notes && (
          <Section title="Notes">
            <p className="text-sm text-secondary-700 whitespace-pre-wrap">{customer.notes}</p>
          </Section>
        )}

        {Array.isArray(customer.tags) && customer.tags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {customer.tags.map(t => (
                <Badge key={t} variant="neutral" size="sm">{t}</Badge>
              ))}
            </div>
          </Section>
        )}

        <Section title="Record">
          <Row label="Created">{formatDate(customer.createdAt)}</Row>
          <Row label="Updated">{formatDate(customer.updatedAt)}</Row>
          <Row label="Source">{customer.acquisitionSource}</Row>
        </Section>
      </div>
    </div>
  );
}
