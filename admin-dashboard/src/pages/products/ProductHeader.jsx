import { Package, IndianRupee, Layers } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatINR } from '../../utils/format.js';
import { stockBadge } from './_productColumns.jsx';

export default function ProductHeader({ product }) {
  if (!product) return null;
  const grade = typeof product.grade === 'object' ? product.grade : null;
  const stock = stockBadge(product.currentStock, product.minStockAlert);

  return (
    <Card>
      <Card.Body className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-16 w-16 flex-shrink-0 rounded-xl bg-info-50 text-info-700
                        flex items-center justify-center">
          <Package size={28} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-secondary-900 truncate">
              {product.name}
            </h2>
            <Badge variant={product.isActive ? 'success' : 'danger'} size="sm">
              {product.isActive ? 'Active' : 'Inactive'}
            </Badge>
            <Badge variant={stock.variant} size="sm">{stock.label}</Badge>
          </div>

          <div className="mt-0.5 text-xs font-mono text-secondary-500">
            SKU: <span className="text-primary-700">{product.sku}</span>
            {product.brand && <span className="ml-3 text-secondary-500">Brand: <span className="text-secondary-700">{product.brand}</span></span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            <span className="inline-flex items-center gap-1.5 text-secondary-700">
              <Layers size={14} className="text-secondary-400" />
              {product.thicknessMM}mm × {product.lengthFT}×{product.widthFT}ft
              {product.areaSqFt ? ` (${product.areaSqFt} sq.ft)` : ''}
            </span>
            {grade && (
              <span className="text-secondary-700">
                Grade: <span className="font-medium">{grade.label || grade.code}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-secondary-700">
              <IndianRupee size={14} className="text-secondary-400" />
              {formatINR(product.basePrice ?? 0)} / {product.pricingUnit || 'sqft'}
            </span>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
