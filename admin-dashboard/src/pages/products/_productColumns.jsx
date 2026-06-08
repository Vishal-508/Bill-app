import { Pencil, Power, PowerOff, Trash2, Eye } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatINR } from '../../utils/format.js';

/**
 * Stock-level → Badge variant mapper. Pure function, exported for
 * tests. Rules:
 *   currentStock === 0                     → 'danger' "Out of stock"
 *   currentStock <= minStockAlert          → 'danger' "Low: N"
 *   currentStock <= minStockAlert * 2      → 'warning' "N"
 *   otherwise                              → 'success' "N"
 */
export function stockBadge(currentStock, minStockAlert) {
  const stock = Number(currentStock) || 0;
  const min = Number(minStockAlert) || 0;
  if (stock === 0) return { variant: 'danger', label: 'Out of stock' };
  if (stock <= min) return { variant: 'danger', label: `Low: ${stock}` };
  if (stock <= min * 2) return { variant: 'warning', label: String(stock) };
  return { variant: 'success', label: String(stock) };
}

export function productColumns() {
  return [
    {
      accessorKey: 'sku',
      header: 'SKU',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary-700">{row.original.sku}</span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      enableSorting: true,
      cell: ({ row }) => (
        <div className="font-medium text-secondary-900 truncate max-w-[260px]">
          {row.original.name}
        </div>
      ),
    },
    {
      id: 'spec',
      header: 'Spec',
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className="text-xs text-secondary-700">
            {p.thicknessMM}mm × {p.lengthFT}×{p.widthFT}ft
          </span>
        );
      },
    },
    {
      id: 'grade',
      header: 'Grade',
      enableSorting: false,
      cell: ({ row }) => {
        // Grade may be populated to an object OR a bare ObjectId string
        const g = row.original.grade;
        if (!g) return <span className="text-secondary-400">—</span>;
        const label = typeof g === 'object' ? (g.label || g.code) : '—';
        return <Badge variant="info" size="sm">{label}</Badge>;
      },
    },
    {
      accessorKey: 'currentStock',
      header: 'Stock',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => {
        const b = stockBadge(row.original.currentStock, row.original.minStockAlert);
        return <Badge variant={b.variant} size="sm">{b.label}</Badge>;
      },
    },
    {
      accessorKey: 'basePrice',
      header: 'Price',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">
          {formatINR(row.original.basePrice ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'danger'} size="sm">
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];
}

export function productRowActions({ onView, onEdit, onToggleActive, onDelete }) {
  return [
    { label: 'View', icon: Eye, onClick: onView },
    { label: 'Edit', icon: Pencil, onClick: onEdit },
    {
      label: 'Activate',
      icon: Power,
      variant: 'success',
      onClick: onToggleActive,
      condition: (row) => !row.isActive,
    },
    {
      label: 'Deactivate',
      icon: PowerOff,
      variant: 'danger',
      onClick: onToggleActive,
      condition: (row) => row.isActive,
    },
    {
      label: 'Soft delete',
      icon: Trash2,
      variant: 'danger',
      onClick: onDelete,
      condition: (row) => row.isActive,
    },
  ];
}
