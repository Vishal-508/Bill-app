import { Card } from '../../../components/ui/Card.jsx';
import { formatINR } from '../../../utils/format.js';

export default function BillItemsTab({ bill }) {
  if (!bill) return null;
  const items = Array.isArray(bill.items) ? bill.items : [];

  if (items.length === 0) {
    return (
      <Card><Card.Body className="text-center text-sm text-secondary-500 py-8">
        This bill has no line items.
      </Card.Body></Card>
    );
  }

  const subtotal = items.reduce((s, i) => s + (i.lineSubtotal ?? i.amount ?? 0), 0);
  const totalGst = bill.totalGst ?? 0;
  const grandTotal = bill.grandTotal ?? subtotal + totalGst;

  return (
    <Card>
      <Card.Header title={`Items (${items.length})`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="px-4 py-2 text-left">HSN</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-right">Discount</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const product = typeof it.product === 'object' ? it.product : null;
              const sku = product?.sku || it.sku || '—';
              const desc = product?.name || it.description || it.name || '—';
              const hsn = it.hsnCode || product?.hsnCode || '—';
              const discountDisplay = (it.discountPct || 0) > 0
                ? `${it.discountPct}%`
                : (it.discountAmount || 0) > 0
                  ? formatINR(it.discountAmount)
                  : '—';
              return (
                <tr key={idx} className="border-t border-secondary-200 hover:bg-secondary-50">
                  <td className="px-4 py-2 font-mono text-xs text-primary-700">{sku}</td>
                  <td className="px-4 py-2 text-secondary-900">
                    <div className="font-medium truncate max-w-[280px]">{desc}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-secondary-600">{hsn}</td>
                  <td className="px-4 py-2 text-right">{it.quantity ?? 0}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatINR(it.pricePerUnit ?? it.rate ?? 0)}
                  </td>
                  <td className="px-4 py-2 text-right text-secondary-600">{discountDisplay}</td>
                  <td className="px-4 py-2 text-right font-medium font-mono">
                    {formatINR(it.lineSubtotal ?? it.amount ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-secondary-50 text-sm">
            <tr>
              <td colSpan={6} className="px-4 py-2 text-right text-secondary-600">Subtotal</td>
              <td className="px-4 py-2 text-right font-mono">{formatINR(subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={6} className="px-4 py-2 text-right text-secondary-600">
                {bill.isIntraState ? 'CGST + SGST' : 'IGST'} ({bill.gstRatePct ?? 18}%)
              </td>
              <td className="px-4 py-2 text-right font-mono">{formatINR(totalGst)}</td>
            </tr>
            <tr className="border-t border-secondary-300">
              <td colSpan={6} className="px-4 py-2 text-right font-semibold">Grand Total</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-base text-secondary-900">
                {formatINR(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
