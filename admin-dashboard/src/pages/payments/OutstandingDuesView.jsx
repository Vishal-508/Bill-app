import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown, ChevronUp, Phone, Plus, ArrowUpDown, AlertCircle,
} from 'lucide-react';
import { api } from '../../api/axios.js';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { formatINR, formatDate, formatPhone } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

/**
 * Aggregated outstanding dues by customer.
 *
 * Backend's `GET /orders/outstanding-payments` returns rows of customer
 * + bill metadata; we group locally so the UI can show one card per
 * customer with an expandable breakdown. Defensive on response shape —
 * accepts either an array of rows OR a pre-grouped { byCustomer: [] }
 * envelope.
 */
function daysSince(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function groupByCustomer(rows) {
  const map = new Map();
  for (const r of rows) {
    const c = r.customer;
    const id = typeof c === 'object' ? c?._id : c;
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, {
        customer: typeof c === 'object' ? c : { _id: id },
        totalDue: 0,
        bills: [],
      });
    }
    const entry = map.get(id);
    const due = r.amountDue
      ?? Math.max(0, (r.grandTotal ?? 0) - (r.amountPaid ?? 0));
    entry.totalDue += due;
    entry.bills.push({
      _id: r.billId || r._id,
      billNumber: r.billNumber || r.invoiceNo,
      issueDate: r.issueDate || r.createdAt,
      dueDate: r.dueDate,
      grandTotal: r.grandTotal,
      amountPaid: r.amountPaid ?? 0,
      amountDue: due,
      order: r.order,
      paymentStatus: r.paymentStatus,
    });
  }
  return Array.from(map.values());
}

export default function OutstandingDuesView({ onAddPaymentForBill }) {
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'outstanding-payments', 'list'],
    queryFn: () => api.get('/orders/outstanding-payments', { params: { limit: 200 } })
      .then(r => r.data),
    staleTime: 60_000,
  });

  const [sort, setSort] = useState('amount');  // 'amount' | 'overdue'
  const [expanded, setExpanded] = useState(new Set());

  const groups = useMemo(() => {
    if (!data) return [];
    // Accept either flat rows OR a pre-grouped envelope
    const rows = Array.isArray(data?.data?.byCustomer)
      ? data.data.byCustomer
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
    const grouped = rows[0]?.bills ? rows : groupByCustomer(rows);

    const sorted = [...grouped];
    if (sort === 'amount') {
      sorted.sort((a, b) => (b.totalDue || 0) - (a.totalDue || 0));
    } else {
      // overdue — oldest issueDate first within each customer group
      sorted.sort((a, b) => {
        const ad = Math.max(...a.bills.map(b => daysSince(b.issueDate) || 0));
        const bd = Math.max(...b.bills.map(b => daysSince(b.issueDate) || 0));
        return bd - ad;
      });
    }
    return sorted;
  }, [data, sort]);

  if (isLoading) {
    return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;
  }

  if (groups.length === 0) {
    return (
      <Card><Card.Body>
        <EmptyState
          icon={<AlertCircle size={24} />}
          title="No outstanding dues"
          description="All bills are fully paid. Nice work."
        />
      </Card.Body></Card>
    );
  }

  const grandTotal = groups.reduce((s, g) => s + g.totalDue, 0);
  const totalBills = groups.reduce((s, g) => s + g.bills.length, 0);

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Aggregate summary + sort */}
      <Card>
        <Card.Body className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-secondary-500">Total outstanding:</span>{' '}
            <span className="text-lg font-semibold text-danger-700 font-mono">
              {formatINR(grandTotal)}
            </span>
            <span className="text-secondary-500 ml-3">
              across <span className="font-medium text-secondary-900">{groups.length}</span> customer{groups.length === 1 ? '' : 's'}
              {' · '}
              <span className="font-medium text-secondary-900">{totalBills}</span> bill{totalBills === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown size={14} className="text-secondary-400" />
            <Select
              size="sm"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              options={[
                { value: 'amount',  label: 'Sort: highest dues' },
                { value: 'overdue', label: 'Sort: most overdue' },
              ]}
            />
          </div>
        </Card.Body>
      </Card>

      {/* Customer cards */}
      {groups.map((g) => {
        const cid = g.customer._id;
        const isOpen = expanded.has(cid);
        return (
          <Card key={cid}>
            <button
              type="button"
              onClick={() => toggleExpand(cid)}
              className="w-full text-left p-4 hover:bg-secondary-50 rounded-t-lg
                         flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/customers/${cid}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-secondary-900 hover:text-primary-700 truncate"
                  >
                    {g.customer.customerName || '(customer)'}
                  </Link>
                  <Badge variant="danger" size="sm">{g.bills.length} bill{g.bills.length === 1 ? '' : 's'}</Badge>
                </div>
                {g.customer.phone && (
                  <div className="mt-0.5 text-xs text-secondary-500 inline-flex items-center gap-1">
                    <Phone size={12} /> {formatPhone(g.customer.phone)}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-bold text-danger-700 font-mono">
                  {formatINR(g.totalDue)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-secondary-500 inline-flex items-center gap-1">
                  Outstanding {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-secondary-200">
                <table className="w-full text-sm">
                  <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Invoice #</th>
                      <th className="px-4 py-2 text-left">Issue date</th>
                      <th className="px-4 py-2 text-left">Days old</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Paid</th>
                      <th className="px-4 py-2 text-right">Due</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.bills.map((b) => {
                      const age = daysSince(b.issueDate);
                      return (
                        <tr key={b._id} className="border-t border-secondary-100 hover:bg-secondary-50">
                          <td className="px-4 py-2">
                            <Link to={`/bills/${b._id}`}
                                  className="font-mono text-xs text-primary-700 hover:underline">
                              {b.billNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-xs text-secondary-700">
                            {formatDate(b.issueDate)}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {age != null
                              ? <span className={cn(
                                  age > 60 ? 'text-danger-700 font-medium' :
                                  age > 30 ? 'text-warning-700' :
                                  'text-secondary-600'
                                )}>{age} days</span>
                              : <span className="text-secondary-400">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-secondary-700">
                            {formatINR(b.grandTotal)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-success-700">
                            {formatINR(b.amountPaid)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-danger-700">
                            {formatINR(b.amountDue)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="outline" size="sm"
                              leftIcon={<Plus size={12} />}
                              onClick={() => onAddPaymentForBill?.(b)}
                            >
                              Add payment
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
