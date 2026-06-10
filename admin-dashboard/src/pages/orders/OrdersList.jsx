import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Filter, Download, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useOrdersList, useChangeOrderStatus, useCancelOrder, useDeleteOrder,
} from '../../hooks/queries/useOrders.js';
import { useCreateBillFromOrder } from '../../hooks/queries/useBills.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { DataTable } from '../../components/shared/DataTable.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { exportToCsv } from '../../utils/csvExport.js';
import OrderFilters from './OrderFilters.jsx';
import OrderFormModal from './OrderFormModal.jsx';
import {
  orderColumns, orderRowActions,
  STATUS_FLOW, getValidNextStatuses, canTransitionTo, isTerminal,
} from './_orderColumns.jsx';

// URL params → backend query. The URL keeps user-friendly names
// (dateFrom/dateTo, minTotal/maxTotal) but the backend's order list
// controller expects DIFFERENT param names — this is the translation
// layer. Discovered in browser verification:
//   UI dateFrom → backend fromDate
//   UI dateTo   → backend toDate
//   UI minTotal → backend minAmount
//   UI maxTotal → backend maxAmount
// (See `backend/src/controllers/order.controller.js` list handler.)
// Sort uses mongoose-style `?sort=-field`. Default backend sort is
// `-orderDate`; we default to that too to match.
function urlToBackendParams(sp, debouncedSearch) {
  const params = {
    page:  parseInt(sp.get('page'),  10) || 1,
    limit: parseInt(sp.get('limit'), 10) || 20,
  };
  // Backend's `search` param performs `orderNumber: {$regex, i}` —
  // it does NOT match customer name. The placeholder + this comment
  // make that explicit.
  if (debouncedSearch) params.search = debouncedSearch;

  if (sp.get('status'))        params.status = sp.get('status');
  if (sp.get('paymentStatus')) params.paymentStatus = sp.get('paymentStatus');
  if (sp.get('customer'))      params.customer = sp.get('customer');
  if (sp.get('dateFrom'))      params.fromDate = sp.get('dateFrom');
  if (sp.get('dateTo'))        params.toDate = sp.get('dateTo');
  if (sp.get('minTotal'))      params.minAmount = sp.get('minTotal');
  if (sp.get('maxTotal'))      params.maxAmount = sp.get('maxTotal');

  const sortBy = sp.get('sortBy');
  const sortOrder = sp.get('sortOrder') || 'desc';
  params.sort = sortBy
    ? `${sortOrder === 'desc' ? '-' : ''}${sortBy}`
    : '-orderDate';
  return params;
}

export default function OrdersList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectionResetSignal, setSelectionResetSignal] = useState(0);
  const [bulkRunning, setBulkRunning] = useState(false);

  const debouncedSearch = useDebounce(searchInput, 300);
  const backendParams = useMemo(
    () => urlToBackendParams(searchParams, debouncedSearch),
    [searchParams, debouncedSearch]
  );

  const { data, isLoading } = useOrdersList(backendParams);
  const changeStatus = useChangeOrderStatus();
  const cancelOrder = useCancelOrder();
  const deleteOrder = useDeleteOrder();
  const createBillFromOrder = useCreateBillFromOrder();

  const orders = data?.data || [];
  const totalCount = data?.pagination?.totalRecords || 0;

  const initialFilters = {
    status:         searchParams.get('status') ?? '',
    paymentStatus:  searchParams.get('paymentStatus') ?? 'all',
    customer:       searchParams.get('customer') ?? '',
    dateFrom:       searchParams.get('dateFrom') ?? '',
    dateTo:         searchParams.get('dateTo') ?? '',
    minTotal:       searchParams.get('minTotal') ?? '',
    maxTotal:       searchParams.get('maxTotal') ?? '',
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
    ['status', 'paymentStatus', 'customer', 'dateFrom', 'dateTo',
     'minTotal', 'maxTotal'].forEach((k) => p.delete(k));
    p.set('page', '1');
  });

  const handleRowClick = (order) => navigate(`/orders/${order._id}`);

  // ─── Row action handlers ───

  const handleView = (order) => navigate(`/orders/${order._id}`);

  const handleEdit = (order) => setEditing(order);

  /**
   * Change Status — uses a native prompt to select the next status.
   * For MVP this is pragmatic and accessible; a custom dropdown
   * sub-menu is a future-polish item.
   */
  const handleChangeStatus = async (order) => {
    const valid = getValidNextStatuses(order.status);
    if (valid.length === 0) {
      toast.error('No valid transitions from this status');
      return;
    }
    const choice = window.prompt(
      `Move "${order.orderNumber}" to which status?\n\nValid: ${valid.join(', ')}`,
      valid[0]
    );
    if (!choice) return;
    const next = choice.toUpperCase().trim();
    if (!canTransitionTo(order.status, next)) {
      toast.error(`${order.status} → ${next} is not a valid transition`);
      return;
    }
    try {
      await changeStatus.mutateAsync({ id: order._id, status: next });
    } catch { /* toast surfaced by hook */ }
  };

  const handleGenerateBill = async (order) => {
    if (!window.confirm(`Generate bill for ${order.orderNumber}?`)) return;
    try {
      const res = await createBillFromOrder.mutateAsync({ orderId: order._id });
      const billId = res?.data?._id;
      if (billId) navigate(`/bills/${billId}`);
    } catch { /* toast surfaced */ }
  };

  const handleCancel = async (order) => {
    const reason = window.prompt(
      `Cancel ${order.orderNumber}? Enter a reason (3+ chars):`
    );
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) toast.error('Reason must be at least 3 characters');
      return;
    }
    try {
      await cancelOrder.mutateAsync({ id: order._id, reason: reason.trim() });
    } catch { /* toast */ }
  };

  const handleSoftDelete = async (order) => {
    if (!window.confirm(`Soft-delete ${order.orderNumber}? (only cancelled orders)`)) return;
    try {
      await deleteOrder.mutateAsync({
        id: order._id,
        body: { reason: 'Soft-delete via admin UI' },
      });
    } catch { /* toast */ }
  };

  // ─── Bulk status helpers ───
  // Backend has NO bulk-status endpoint for orders → fan out via
  // Promise.allSettled (same pattern as product bulk in Prompt 11 E).
  // Each button transitions ONLY rows where the current status can
  // legally move to the target; others are skipped with a warning toast.

  const runBulkTransition = async (targetStatus, label) => {
    if (selectedRows.length === 0 || bulkRunning) return;
    const eligible = selectedRows.filter(r => canTransitionTo(r.status, targetStatus));
    const skipped = selectedRows.length - eligible.length;
    if (eligible.length === 0) {
      toast.error(`None of the selected orders can transition to ${targetStatus}`);
      return;
    }
    if (!window.confirm(
      `${label} ${eligible.length} order(s)?${skipped > 0 ? ` (${skipped} skipped — not eligible)` : ''}`
    )) return;

    setBulkRunning(true);
    const t = toast.loading(`${label} ${eligible.length}…`);
    try {
      const results = await Promise.allSettled(
        eligible.map(r => changeStatus.mutateAsync({ id: r._id, status: targetStatus }))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      toast.dismiss(t);
      if (failed === 0) {
        toast.success(`${label}: ${ok} order${ok === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`);
      } else {
        toast.error(`${ok} succeeded, ${failed} failed`);
      }
      setSelectedRows([]);
      setSelectionResetSignal(v => v + 1);
    } finally {
      setBulkRunning(false);
    }
  };

  const runBulkCancel = async () => {
    if (selectedRows.length === 0 || bulkRunning) return;
    const eligible = selectedRows.filter(r => !isTerminal(r.status));
    if (eligible.length === 0) {
      toast.error('All selected orders are already terminal');
      return;
    }
    const reason = window.prompt(`Cancel ${eligible.length} order(s)? Reason (3+ chars):`);
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) toast.error('Reason must be at least 3 characters');
      return;
    }

    setBulkRunning(true);
    const t = toast.loading(`Cancelling ${eligible.length}…`);
    try {
      const results = await Promise.allSettled(
        eligible.map(r => cancelOrder.mutateAsync({ id: r._id, reason: reason.trim() }))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      toast.dismiss(t);
      if (failed === 0) toast.success(`Cancelled ${ok} order${ok === 1 ? '' : 's'}`);
      else toast.error(`${ok} cancelled, ${failed} failed`);
      setSelectedRows([]);
      setSelectionResetSignal(v => v + 1);
    } finally {
      setBulkRunning(false);
    }
  };

  const handleExportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : orders;
    if (rows.length === 0) { toast.error('Nothing to export'); return; }
    // Flatten populated customer for CSV readability
    const flat = rows.map(r => ({
      ...r,
      customerName: r.customer?.customerName || r.customer?.name || '',
      customerPhone: r.customer?.phone || '',
    }));
    exportToCsv(flat, 'orders', [
      'orderNumber', 'orderDate', 'status', 'paymentStatus',
      'customerName', 'customerPhone',
      'subtotal', 'totalGst', 'totalAmount',
      'paymentMode', 'amountPaid',
      'createdAt',
    ]);
    toast.success(`Exported ${flat.length} order${flat.length === 1 ? '' : 's'}`);
  };

  // ─── Columns + actions (memoized to keep tanstack table identity stable) ───
  const columns = useMemo(() => orderColumns(), []);
  const rowActions = useMemo(() => orderRowActions({
    onView:         handleView,
    onEdit:         handleEdit,
    onChangeStatus: handleChangeStatus,
    onGenerateBill: handleGenerateBill,
    onCancel:       handleCancel,
    onDelete:       handleSoftDelete,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        subtitle={`${totalCount} total order${totalCount === 1 ? '' : 's'}`}
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
              disabled={orders.length === 0}
            >
              Export CSV
            </Button>
            <Button
              variant="primary" size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              New Order
            </Button>
          </div>
        }
      />

      {filtersOpen && (
        <OrderFilters
          values={initialFilters}
          onApply={handleFiltersApply}
          onReset={handleFiltersReset}
        />
      )}

      <DataTable
        columns={columns}
        data={orders}
        totalCount={totalCount}
        pagination={{
          page: backendParams.page,
          limit: backendParams.limit,
        }}
        onPaginationChange={handlePaginationChange}
        sorting={searchParams.get('sortBy')
          ? [{ id: searchParams.get('sortBy'), desc: (searchParams.get('sortOrder') || 'desc') === 'desc' }]
          : []
        }
        onSortingChange={handleSortingChange}
        loading={isLoading}
        selectable
        onSelectionChange={setSelectedRows}
        selectionResetSignal={selectionResetSignal}
        onRowClick={handleRowClick}
        searchValue={searchInput}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by order # (e.g. ORD-2026-0042)…"
        rowActions={rowActions}
        bulkActions={[
          { label: 'Mark In-Progress', onClick: () => runBulkTransition('IN_PROGRESS', 'In-progress') },
          { label: 'Mark Ready',       onClick: () => runBulkTransition('READY', 'Ready') },
          { label: 'Mark Delivered',   onClick: () => runBulkTransition('DELIVERED', 'Delivered') },
          { label: 'Cancel',           onClick: runBulkCancel, variant: 'danger' },
        ]}
        emptyState={{
          icon: <ShoppingCart size={24} />,
          title: 'No orders found',
          description: backendParams.search
            ? 'Try a different search or clear filters.'
            : 'Create your first order to get started.',
          action: { label: 'New Order', onClick: () => setCreateOpen(true) },
        }}
      />

      {(createOpen || editing) && (
        <OrderFormModal
          open
          order={editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

// Re-export status flow constants for tests
export { STATUS_FLOW };
