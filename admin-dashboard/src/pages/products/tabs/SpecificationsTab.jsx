import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { formatINR, formatDate } from '../../../utils/format.js';

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <div className="w-36 flex-shrink-0 text-xs uppercase tracking-wide text-secondary-500">
        {label}
      </div>
      <div className="flex-1 text-sm text-secondary-900 break-words">
        {children || <span className="text-secondary-400">—</span>}
      </div>
    </div>
  );
}

export default function SpecificationsTab({ product }) {
  if (!product) return null;
  const grade = typeof product.grade === 'object' ? product.grade : null;
  const tiers = product.quantityTiers || [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <Card.Header title="Dimensions" />
        <Card.Body>
          <Row label="Thickness">{product.thicknessMM} mm</Row>
          <Row label="Length">{product.lengthFT} ft</Row>
          <Row label="Width">{product.widthFT} ft</Row>
          <Row label="Area">{product.areaSqFt} sq.ft</Row>
          <Row label="Area (sq.in)">{product.areaSqInch}</Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Material & Grade" />
        <Card.Body>
          <Row label="Grade">{grade?.label || grade?.code}</Row>
          <Row label="Brand">{product.brand}</Row>
          <Row label="Description">{product.description}</Row>
          <Row label="HSN Code">{product.hsnCode}</Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Pricing" />
        <Card.Body>
          <Row label="Base Price">{formatINR(product.basePrice ?? 0)}</Row>
          <Row label="Pricing Unit">{product.pricingUnit || 'sqft'}</Row>
          <Row label="GST Rate">{product.gstRatePct ?? 18}%</Row>
          {tiers.length > 0 && (
            <Row label="Quantity Tiers">
              <div className="space-y-1">
                {tiers.map((t, i) => (
                  <div key={i} className="text-xs">
                    {t.minQty}–{t.maxQty || '∞'}: <span className="font-medium">{t.discountPct}% off</span>
                  </div>
                ))}
              </div>
            </Row>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Stock Settings" />
        <Card.Body>
          <Row label="Current Stock">
            <span className="font-mono">{product.currentStock ?? 0}</span> sheets
          </Row>
          <Row label="Min Stock Alert">{product.minStockAlert} sheets</Row>
          <Row label="Reorder Quantity">{product.reorderQuantity} sheets</Row>
          {Array.isArray(product.tags) && product.tags.length > 0 && (
            <Row label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {product.tags.map((t) => <Badge key={t} variant="neutral" size="sm">{t}</Badge>)}
              </div>
            </Row>
          )}
        </Card.Body>
      </Card>

      <Card className="md:col-span-2">
        <Card.Header title="Record" />
        <Card.Body>
          <Row label="Created">{formatDate(product.createdAt)}</Row>
          <Row label="Updated">{formatDate(product.updatedAt)}</Row>
          {product.notes && <Row label="Notes">{product.notes}</Row>}
        </Card.Body>
      </Card>
    </div>
  );
}
