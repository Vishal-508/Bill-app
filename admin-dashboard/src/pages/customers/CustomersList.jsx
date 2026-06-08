import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Filter, Download, Users, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useCustomersList,
  useDeleteCustomer,
  useUpdateCustomer,
  useBulkUpdateCustomers,
} from '../../hooks/queries/useCustomers.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { DataTable } from '../../components/shared/DataTable.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { exportToCsv } from '../../utils/csvExport.js';
import { customerColumns, customerRowActions } from './_customerColumns.jsx';
import CustomerFilters from './CustomerFilters.jsx';
import CustomerFormModal from './CustomerFormModal.jsx';

/**
 * Translate the frontend's URL-state shape (page/limit/sortBy/
 * sortOrder/etc.) into the backend's expected query format.
 *
 * - Backend uses Mongo-style `sort=-createdAt`, not split fields
 * - Backend uses `hasGST` (existence on the `gstin` field), not
 *   `billType` or `hasGstin` — Customer has no `billType` field
 * - Booleans must serialize as the strings 'true'/'false'
 */
function urlToBackendParams(sp, debouncedSearch) {
  const page = parseInt(sp.get('page'), 10) || 1;
  const limit = parseInt(sp.get('limit'), 10) || 20;
  const sortBy = sp.get('sortBy') || 'createdAt';
  const sortOrder = sp.get('sortOrder') || 'desc';

  const params = {
    page, limit,
    sort: `${sortOrder === 'desc' ? '-' : ''}${sortBy}`,
  };

  if (debouncedSearch) params.search = debouncedSearch;

  const hasGST = sp.get('hasGST');
  if (hasGST === 'true' || hasGST === 'false') params.hasGST = hasGST;

  // isActive semantics:
  //   URL absent       → default to active-only (most-common case)
  //   URL=true/false   → filter to that value
  //   URL=all          → no isActive filter (show both)
  const isActive = sp.get('isActive');
  if (isActive === 'true' || isActive === 'false') params.isActive = isActive;
  else if (isActive == null) params.isActive = 'true';
  // else 'all' → leave params.isActive unset → backend returns all

  const state = sp.get('state');
  if (state) params.state = state;

  const size = sp.get('size');
  if (size) params.size = size;

  return params;
}

export default function CustomersList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ─── UI state ───
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);

  // Local input state — debounced before it becomes part of the URL
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(searchInput, 300);

  // Build backend params (recompute when URL or debounced search changes)
  const backendParams = useMemo(
    () => urlToBackendParams(searchParams, debouncedSearch),
    [searchParams, debouncedSearch]
  );

  const { data, isLoading } = useCustomersList(backendParams);
  const deleteMutation = useDeleteCustomer();
  const updateMutation = useUpdateCustomer();
  const bulkMutation = useBulkUpdateCustomers();

  const customers = data?.data || [];
  const totalCount = data?.pagination?.totalRecords || 0;

  // Current sort/pagination state for the controlled DataTable
  const currentPage = parseInt(searchParams.get('page'), 10) || 1;
  const currentLimit = parseInt(searchParams.get('limit'), 10) || 20;
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  // ─── Handlers ───

  const updateParams = (mutate) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next);
  };

  const handlePaginationChange = ({ page, limit }) => {
    updateParams((p) => { p.set('page', String(page)); p.set('limit', String(limit)); });
  };

  const handleSortingChange = (newSorting) => {
    updateParams((p) => {
      if (newSorting.length > 0) {
        p.set('sortBy', newSorting[0].id);
        p.set('sortOrder', newSorting[0].desc ? 'desc' : 'asc');
      } else {
        p.delete('sortBy'); p.delete('sortOrder');
      }
      p.set('page', '1');
    });
  };

  const handleSearchChange = (v) => {
    setSearchInput(v);
    updateParams((p) => {
      if (v) p.set('search', v); else p.delete('search');
      p.set('page', '1');
    });
  };

  const handleFiltersApply = (filters) => {
    updateParams((p) => {
      for (const [key, value] of Object.entries(filters)) {
        if (value == null || value === '') {
          p.delete(key);
        } else if (value === 'all') {
          // `isActive=all` is a meaningful sentinel — preserve it so
          // urlToBackendParams knows to skip the default active-only
          // filter. Other 'all' selections (hasGST/size) just clear.
          if (key === 'isActive') p.set(key, 'all');
          else p.delete(key);
        } else {
          p.set(key, value);
        }
      }
      p.set('page', '1');
    });
  };

  const handleFiltersReset = () => setSearchParams({});

  const handleRowClick = (customer) => navigate(`/customers/${customer._id}`);

  const handleDelete = async (customer) => {
    if (!window.confirm(`Deactivate "${customer.customerName}"? This is a soft delete and can be reversed by a super-admin.`)) return;
    try {
      await deleteMutation.mutateAsync({
        id: customer._id,
        body: { reason: 'Deactivated from admin UI' },
      });
    } catch { /* toast handled by mutation hook */ }
  };

  const handleToggleActive = async (customer) => {
    try {
      await updateMutation.mutateAsync({
        id: customer._id,
        payload: { isActive: !customer.isActive },
      });
    } catch { /* toast in hook */ }
  };

  // Bump on every successful bulk op so DataTable clears its internal
  // tanstack rowSelection (the `selectedRows` mirror alone can't reach it).
  const [selectionResetSignal, setSelectionResetSignal] = useState(0);

  // Backend's bulkUpdateSchema expects { customerIds, updates }.
  // Sending { ids, update } returned "Validation failed" — fixed.
  const handleBulkActivate = async () => {
    if (selectedRows.length === 0) return;
    await bulkMutation.mutateAsync({
      customerIds: selectedRows.map(r => r._id),
      updates: { isActive: true },
    });
    setSelectedRows([]);
    setSelectionResetSignal(v => v + 1);
  };

  const handleBulkDeactivate = async () => {
    if (selectedRows.length === 0) return;
    if (!window.confirm(`Deactivate ${selectedRows.length} customer(s)?`)) return;
    await bulkMutation.mutateAsync({
      customerIds: selectedRows.map(r => r._id),
      updates: { isActive: false },
    });
    setSelectedRows([]);
    setSelectionResetSignal(v => v + 1);
  };

  const handleExportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : customers;
    const fields = [
      'customerName', 'companyName', 'phone', 'altPhone', 'email',
      'gstin', 'businessSize', 'acquisitionSource',
      'billingAddress.line1', 'billingAddress.city',
      'billingAddress.state', 'billingAddress.pincode',
      'creditLimit', 'currentDues', 'isActive', 'createdAt',
    ];
    const written = exportToCsv(rows, 'customers', fields);
    if (written) toast.success(`Exported ${written} customer${written === 1 ? '' : 's'}`);
  };

  // ─── Columns (memo to keep DataTable's column identity stable) ───
  const columns = useMemo(() => customerColumns(), []);
  const rowActions = useMemo(() => customerRowActions({
    onView: (c) => navigate(`/customers/${c._id}`),
    onEdit: (c) => setEditing(c),
    onToggleActive: handleToggleActive,
    onDelete: handleDelete,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const initialFilters = {
    hasGST: searchParams.get('hasGST') ?? 'all',
    state: searchParams.get('state') ?? '',
    isActive: searchParams.get('isActive') ?? 'all',
    size: searchParams.get('size') ?? '',
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        subtitle={`${totalCount} total customer${totalCount === 1 ? '' : 's'}`}
        actions={
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
              disabled={customers.length === 0}
            >
              Export CSV
            </Button>
            <Button
              variant="primary" size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              Add Customer
            </Button>
          </>
        }
      />

      {filtersOpen && (
        <CustomerFilters
          values={initialFilters}
          onApply={handleFiltersApply}
          onReset={handleFiltersReset}
        />
      )}

      {/* Hint banner: makes the active-only default visible so a user
          who just deactivated a customer can find them again. Only
          shows when isActive filter is the implicit 'true' default. */}
      {backendParams.isActive === 'true' && (
        <Alert variant="info" className="!py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>Showing active customers only.</span>
            <button
              type="button"
              onClick={() => updateParams((p) => { p.set('isActive', 'all'); p.set('page', '1'); })}
              className="underline text-primary-700 hover:text-primary-900 font-medium"
            >
              Show all (including inactive)
            </button>
          </div>
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={customers}
        totalCount={totalCount}
        pagination={{ page: currentPage, limit: currentLimit }}
        onPaginationChange={handlePaginationChange}
        sorting={[{ id: sortBy, desc: sortOrder === 'desc' }]}
        onSortingChange={handleSortingChange}
        loading={isLoading}
        selectable
        onSelectionChange={setSelectedRows}
        selectionResetSignal={selectionResetSignal}
        onRowClick={handleRowClick}
        rowActions={rowActions}
        searchValue={searchInput}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by name, phone, GSTIN, email…"
        bulkActions={[
          { label: 'Activate', onClick: handleBulkActivate },
          { label: 'Deactivate', onClick: handleBulkDeactivate, variant: 'danger' },
        ]}
        emptyState={{
          icon: <Users size={24} />,
          title: 'No customers found',
          description: debouncedSearch
            ? 'Try a different search term or clear filters.'
            : 'Get started by adding your first customer.',
          action: { label: 'Add Customer', onClick: () => setCreateOpen(true) },
        }}
      />

      {(createOpen || editing) && (
        <CustomerFormModal
          open
          customer={editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
