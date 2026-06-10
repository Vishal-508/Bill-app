import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Filter, Download, Plus, CreditCard, AlertCircle, ListIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  usePaymentsList, useCancelPayment,
} from '../../hooks/queries/usePayments.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { DataTable } from '../../components/shared/DataTable.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { exportToCsv } from '../../utils/csvExport.js';
import { paymentApi, paiseToRupees } from '../../api/payment.api.js';
import PaymentFilters from './PaymentFilters.jsx';
import { paymentColumns, paymentRowActions } from './_paymentColumns.jsx';
import AddPaymentModal from './AddPaymentModal.jsx';
import RazorpayLinkModal from './RazorpayLinkModal.jsx';
import OutstandingDuesView from './OutstandingDuesView.jsx';
import { cn } from '../../utils/cn.js';

// URL params → backend list query. Audited contract (Section F pre-flight):
//   UI dateFrom → backend fromDate (maps to payment.createdAt)
//   UI dateTo   → backend toDate
//   UI minTotal → backend minAmount (converted to paise server-side)
//   UI maxTotal → backend maxAmount
//   sort        → -createdAt default (mongoose-style)
// Backend's `search` matches paymentReference regex only.
function urlToBackendParams(sp, debouncedSearch) {
  const params = {
    page:  parseInt(sp.get('page'),  10) || 1,
    limit: parseInt(sp.get('limit'), 10) || 20,
  };
  if (debouncedSearch) params.search = debouncedSearch;

  if (sp.get('status'))   params.status = sp.get('status');
  if (sp.get('method'))   params.method = sp.get('method');
  if (sp.get('gateway'))  params.gateway = sp.get('gateway');
  if (sp.get('customer')) params.customer = sp.get('customer');
  if (sp.get('dateFrom')) params.fromDate = sp.get('dateFrom');
  if (sp.get('dateTo'))   params.toDate = sp.get('dateTo');
  if (sp.get('minTotal')) params.minAmount = sp.get('minTotal');
  if (sp.get('maxTotal')) params.maxAmount = sp.get('maxTotal');

  const sortBy = sp.get('sortBy');
  const sortOrder = sp.get('sortOrder') || 'desc';
  params.sort = sortBy
    ? `${sortOrder === 'desc' ? '-' : ''}${sortBy}`
    : '-createdAt';
  return params;
}

export default function PaymentsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView]               = useState('payments');  // 'payments' | 'outstanding'
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [selectedRows, setSelectedRows] = useState([]);

  const [addOpen, setAddOpen]               = useState(false);
  const [addContext, setAddContext]         = useState({});  // { order, bill, defaultAmount }
  const [razorpayOpen, setRazorpayOpen]     = useState(false);

  const debouncedSearch = useDebounce(searchInput, 300);
  const backendParams = useMemo(
    () => urlToBackendParams(searchParams, debouncedSearch),
    [searchParams, debouncedSearch]
  );

  const { data, isLoading } = usePaymentsList(backendParams);
  const cancelMutation = useCancelPayment();

  const payments = data?.data || [];
  const totalCount = data?.pagination?.totalRecords || 0;

  const initialFilters = {
    status:   searchParams.get('status') ?? '',
    method:   searchParams.get('method') ?? '',
    gateway:  searchParams.get('gateway') ?? '',
    customer: searchParams.get('customer') ?? '',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo:   searchParams.get('dateTo') ?? '',
    minTotal: searchParams.get('minTotal') ?? '',
    maxTotal: searchParams.get('maxTotal') ?? '',
  };

  const updateParams = useCallback((mutator) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      mutator(next);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handlePaginationChange = (next) => updateParams((p) => {
    p.set('page', String(next.page));
    p.set('limit', String(next.limit));
  });

  const handleSortingChange = (next) => updateParams((p) => {
    if (next.length) {
      p.set('sortBy', next[0].id);
      p.set('sortOrder', next[0].desc ? 'desc' : 'asc');
    } else {
      p.delete('sortBy'); p.delete('sortOrder');
    }
  });

  const handleSearchChange = (value) => {
    setSearchInput(value);
    updateParams((p) => {
      if (value) p.set('search', value); else p.delete('search');
      p.set('page', '1');
    });
  };

  const handleFiltersApply = (filters) => {
    updateParams((p) => {
      for (const [key, value] of Object.entries(filters)) {
        if (value == null || value === '') p.delete(key);
        else p.set(key, value);
      }
      p.set('page', '1');
    });
  };

  const handleFiltersReset = () => updateParams((p) => {
    ['status', 'method', 'gateway', 'customer',
     'dateFrom', 'dateTo', 'minTotal', 'maxTotal'].forEach((k) => p.delete(k));
    p.set('page', '1');
  });

  // ─── Row actions ───
  const handleView = (p) => navigate(`/payments/${p._id}`);

  const handleDownloadReceipt = async (p) => {
    try {
      const filename = await paymentApi.downloadReceipt(p._id);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      const status = err?.response?.status;
      toast.error(
        status === 404 ? 'Receipt not available' :
        status === 401 ? 'Session expired — please log in again' :
        'Receipt download failed'
      );
    }
  };

  const handleCancel = async (p) => {
    const reason = window.prompt(
      `Cancel ${p.paymentReference}? Enter a reason (3+ chars):`
    );
    if (!reason || reason.trim().length < 3) return;
    try { await cancelMutation.mutateAsync({ id: p._id, reason: reason.trim() }); }
    catch { /* toast surfaced */ }
  };

  const handleExportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : payments;
    if (rows.length === 0) { toast.error('Nothing to export'); return; }
    // Convert paise → rupees so the CSV column is human-readable
    const flat = rows.map(p => ({
      ...p,
      amountRupees: paiseToRupees(p.amount),
      amountRefundedRupees: paiseToRupees(p.amountRefunded ?? 0),
      customerName: p.customer?.customerName || '',
      billNumber:   p.bill?.billNumber || '',
      orderNumber:  p.order?.orderNumber || '',
    }));
    exportToCsv(flat, 'payments', [
      'paymentReference', 'createdAt', 'status', 'gateway', 'method',
      'customerName', 'billNumber', 'orderNumber',
      'amountRupees', 'amountRefundedRupees', 'currency',
    ]);
    toast.success(`Exported ${flat.length} payment${flat.length === 1 ? '' : 's'}`);
  };

  const columns = useMemo(() => paymentColumns(), []);
  const rowActions = useMemo(() => paymentRowActions({
    onView: handleView,
    onDownloadReceipt: handleDownloadReceipt,
    onCancel: handleCancel,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // AddPaymentModal handoff to Razorpay modal
  const handleRazorpaySelected = (ctx) => {
    setAddContext(ctx);
    setRazorpayOpen(true);
  };

  // Hooks called from OutstandingDuesView (per-bill Add Payment)
  const handleAddPaymentForBill = (bill) => {
    setAddContext({ bill, defaultAmount: bill.amountDue });
    setAddOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        subtitle={view === 'payments'
          ? `${totalCount} total payment${totalCount === 1 ? '' : 's'}`
          : 'Outstanding dues by customer'}
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-md border border-secondary-300 bg-white p-0.5"
                 role="tablist" aria-label="View">
              <button
                role="tab"
                type="button"
                aria-selected={view === 'payments'}
                onClick={() => setView('payments')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded',
                  view === 'payments'
                    ? 'bg-primary-600 text-white'
                    : 'text-secondary-700 hover:bg-secondary-100',
                )}
              >
                <ListIcon size={12} /> Payments
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={view === 'outstanding'}
                onClick={() => setView('outstanding')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded',
                  view === 'outstanding'
                    ? 'bg-primary-600 text-white'
                    : 'text-secondary-700 hover:bg-secondary-100',
                )}
              >
                <AlertCircle size={12} /> Outstanding
              </button>
            </div>

            {view === 'payments' && (
              <>
                <Button
                  variant="outline" size="sm"
                  leftIcon={<Filter size={14} />}
                  onClick={() => setFiltersOpen(o => !o)}
                >
                  Filters
                </Button>
                <Button
                  variant="outline" size="sm"
                  leftIcon={<Download size={14} />}
                  onClick={handleExportCsv}
                  disabled={payments.length === 0}
                >
                  Export CSV
                </Button>
              </>
            )}
            <Button
              variant="primary" size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => { setAddContext({}); setAddOpen(true); }}
            >
              Add Payment
            </Button>
          </div>
        }
      />

      {view === 'payments' ? (
        <>
          {filtersOpen && (
            <PaymentFilters
              values={initialFilters}
              onApply={handleFiltersApply}
              onReset={handleFiltersReset}
            />
          )}

          <DataTable
            columns={columns}
            data={payments}
            totalCount={totalCount}
            pagination={{ page: backendParams.page, limit: backendParams.limit }}
            onPaginationChange={handlePaginationChange}
            sorting={searchParams.get('sortBy')
              ? [{ id: searchParams.get('sortBy'), desc: (searchParams.get('sortOrder') || 'desc') === 'desc' }]
              : []
            }
            onSortingChange={handleSortingChange}
            loading={isLoading}
            selectable
            onSelectionChange={setSelectedRows}
            onRowClick={handleView}
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            searchPlaceholder="Search by payment reference (e.g. PAY-2026-…)…"
            rowActions={rowActions}
            emptyState={{
              icon: <CreditCard size={24} />,
              title: 'No payments found',
              description: backendParams.search
                ? 'Try a different search or clear filters.'
                : 'Record a manual payment via "+ Add Payment" or generate a Razorpay link.',
              action: { label: '+ Add Payment', onClick: () => { setAddContext({}); setAddOpen(true); } },
            }}
          />
        </>
      ) : (
        <OutstandingDuesView onAddPaymentForBill={handleAddPaymentForBill} />
      )}

      {addOpen && (
        <AddPaymentModal
          open
          order={addContext.order}
          bill={addContext.bill}
          defaultAmount={addContext.defaultAmount}
          onClose={() => setAddOpen(false)}
          onRazorpaySelected={handleRazorpaySelected}
        />
      )}
      {razorpayOpen && (
        <RazorpayLinkModal
          open
          order={addContext.order}
          bill={addContext.bill}
          defaultAmount={addContext.defaultAmount}
          onClose={() => setRazorpayOpen(false)}
        />
      )}
    </div>
  );
}
