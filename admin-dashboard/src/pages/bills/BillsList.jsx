import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Filter, Download, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBillsList } from '../../hooks/queries/useBills.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { DataTable } from '../../components/shared/DataTable.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { exportToCsv } from '../../utils/csvExport.js';
import { billApi } from '../../api/bill.api.js';
import BillFilters from './BillFilters.jsx';
import SendBillModal from './SendBillModal.jsx';
import MarkSentModal from './MarkSentModal.jsx';
import { billColumns, billRowActions } from './_billColumns.jsx';

// URL params → backend list query. Audited contract (Section E pre-flight):
//   UI dateFrom → backend fromDate (maps to bill.issueDate)
//   UI dateTo   → backend toDate
//   UI minTotal → backend minAmount (maps to bill.grandTotal)
//   UI maxTotal → backend maxAmount
//   sort        → -issueDate default (mongoose-style)
function urlToBackendParams(sp, debouncedSearch) {
  const params = {
    page:  parseInt(sp.get('page'),  10) || 1,
    limit: parseInt(sp.get('limit'), 10) || 20,
  };
  // Backend's `search` matches billNumber regex only (not customer).
  if (debouncedSearch) params.search = debouncedSearch;

  if (sp.get('status'))        params.status = sp.get('status');
  if (sp.get('paymentStatus')) params.paymentStatus = sp.get('paymentStatus');
  if (sp.get('hasGst'))        params.hasGst = sp.get('hasGst');
  if (sp.get('customer'))      params.customer = sp.get('customer');
  if (sp.get('dateFrom'))      params.fromDate = sp.get('dateFrom');
  if (sp.get('dateTo'))        params.toDate = sp.get('dateTo');
  if (sp.get('minTotal'))      params.minAmount = sp.get('minTotal');
  if (sp.get('maxTotal'))      params.maxAmount = sp.get('maxTotal');

  const sortBy = sp.get('sortBy');
  const sortOrder = sp.get('sortOrder') || 'desc';
  params.sort = sortBy
    ? `${sortOrder === 'desc' ? '-' : ''}${sortBy}`
    : '-issueDate';
  return params;
}

export default function BillsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [selectedRows, setSelectedRows] = useState([]);
  const [sendingBill, setSendingBill] = useState(null);
  const [markingBill, setMarkingBill] = useState(null);

  const debouncedSearch = useDebounce(searchInput, 300);
  const backendParams = useMemo(
    () => urlToBackendParams(searchParams, debouncedSearch),
    [searchParams, debouncedSearch]
  );

  const { data, isLoading } = useBillsList(backendParams);
  const bills = data?.data || [];
  const totalCount = data?.pagination?.totalRecords || 0;

  const initialFilters = {
    status:        searchParams.get('status') ?? '',
    paymentStatus: searchParams.get('paymentStatus') ?? 'all',
    hasGst:        searchParams.get('hasGst') ?? 'all',
    customer:      searchParams.get('customer') ?? '',
    dateFrom:      searchParams.get('dateFrom') ?? '',
    dateTo:        searchParams.get('dateTo') ?? '',
    minTotal:      searchParams.get('minTotal') ?? '',
    maxTotal:      searchParams.get('maxTotal') ?? '',
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
        if (value == null || value === '' || value === 'all') p.delete(key);
        else p.set(key, value);
      }
      p.set('page', '1');
    });
  };

  const handleFiltersReset = () => updateParams((p) => {
    ['status', 'paymentStatus', 'hasGst', 'customer',
     'dateFrom', 'dateTo', 'minTotal', 'maxTotal'].forEach((k) => p.delete(k));
    p.set('page', '1');
  });

  const handleRowClick = (bill) => navigate(`/bills/${bill._id}`);

  // ─── Row actions ───
  const handleView = (bill) => navigate(`/bills/${bill._id}`);
  // (No edit action — see _billColumns.jsx for rationale)
  const handleDownload = async (bill) => {
    try {
      const filename = await billApi.downloadPdf(bill._id);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      const status = err?.response?.status;
      toast.error(
        status === 404 ? 'Bill not found' :
        status === 401 ? 'Session expired — please log in again' :
        'PDF download failed'
      );
    }
  };
  const handleSend = (bill) => setSendingBill(bill);
  const handleMarkSent = (bill) => setMarkingBill(bill);
  const handleAddPayment = (bill) => {
    toast('Add Payment ships in Section F.', { icon: 'ℹ️' });
  };

  const handleExportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : bills;
    if (rows.length === 0) { toast.error('Nothing to export'); return; }
    const flat = rows.map(b => ({
      ...b,
      customerName: b.customer?.customerName || '',
      customerPhone: b.customer?.phone || '',
      orderNumber: b.order?.orderNumber || '',
    }));
    exportToCsv(flat, 'bills', [
      'billNumber', 'issueDate', 'status', 'paymentStatus',
      'customerName', 'customerPhone', 'orderNumber',
      'subTotal', 'totalGst', 'grandTotal',
      'amountPaid', 'amountDue',
      'createdAt',
    ]);
    toast.success(`Exported ${flat.length} bill${flat.length === 1 ? '' : 's'}`);
  };

  const columns = useMemo(() => billColumns(), []);
  const rowActions = useMemo(() => billRowActions({
    onView: handleView,
    onDownloadPdf: handleDownload,
    onSend: handleSend,
    onMarkSent: handleMarkSent,
    onAddPayment: handleAddPayment,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bills"
        subtitle={`${totalCount} total bill${totalCount === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
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
              disabled={bills.length === 0}
            >
              Export CSV
            </Button>
            {/* No "Create Bill" — bills come from orders. The empty-state
                CTA points the admin back to the order list. */}
          </div>
        }
      />

      {filtersOpen && (
        <BillFilters
          values={initialFilters}
          onApply={handleFiltersApply}
          onReset={handleFiltersReset}
        />
      )}

      <DataTable
        columns={columns}
        data={bills}
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
        onRowClick={handleRowClick}
        searchValue={searchInput}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by invoice # (e.g. INV-2026-0042)…"
        rowActions={rowActions}
        emptyState={{
          icon: <FileText size={24} />,
          title: 'No bills found',
          description: backendParams.search
            ? 'Try a different search or clear filters.'
            : 'Bills are generated from completed orders — head to Orders to create one.',
          action: { label: 'View Orders', onClick: () => navigate('/orders') },
        }}
      />

      {sendingBill && (
        <SendBillModal
          open
          bill={sendingBill}
          onClose={() => setSendingBill(null)}
        />
      )}
      {markingBill && (
        <MarkSentModal
          open
          bill={markingBill}
          onClose={() => setMarkingBill(null)}
        />
      )}
    </div>
  );
}
