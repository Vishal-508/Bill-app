import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Filter, Download, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useProductsList, useDeleteProduct, useUpdateProduct,
} from '../../hooks/queries/useProducts.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { DataTable } from '../../components/shared/DataTable.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { productColumns, productRowActions } from './_productColumns.jsx';
import ProductFilters from './ProductFilters.jsx';
import ProductFormModal from './ProductFormModal.jsx';
import { exportToCsv } from '../../utils/csvExport.js';
import { ROUTES } from '../../utils/constants.js';

// Frontend URL params → backend query params. Same translation
// pattern as customers (sort=-field mongoose-style, isActive sentinel
// 'all' to opt out of default active-only).
function urlToBackendParams(sp, debouncedSearch) {
  const params = {
    page:  parseInt(sp.get('page'),  10) || 1,
    limit: parseInt(sp.get('limit'), 10) || 20,
  };
  if (debouncedSearch) params.search = debouncedSearch;
  if (sp.get('thicknessMM')) params.thicknessMM = sp.get('thicknessMM');
  if (sp.get('grade'))       params.grade = sp.get('grade');
  if (sp.get('lowStock'))    params.lowStock = sp.get('lowStock');

  const isActive = sp.get('isActive');
  if (isActive === 'true' || isActive === 'false') params.isActive = isActive;
  else if (isActive == null) params.isActive = 'true';

  const sortBy = sp.get('sortBy');
  const sortOrder = sp.get('sortOrder') || 'desc';
  params.sort = sortBy ? `${sortOrder === 'desc' ? '-' : ''}${sortBy}` : '-createdAt';
  return params;
}

export default function ProductsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [selectedRows, setSelectedRows] = useState([]);

  const debouncedSearch = useDebounce(searchInput, 300);
  const backendParams = useMemo(
    () => urlToBackendParams(searchParams, debouncedSearch),
    [searchParams, debouncedSearch]
  );

  const { data, isLoading } = useProductsList(backendParams);
  const deleteMutation = useDeleteProduct();
  const updateMutation = useUpdateProduct();

  const products = data?.data || [];
  const totalCount = data?.pagination?.totalRecords || 0;

  const initialFilters = {
    thicknessMM: searchParams.get('thicknessMM') ?? '',
    grade: searchParams.get('grade') ?? '',
    isActive: searchParams.get('isActive') ?? 'all',
    lowStock: searchParams.get('lowStock') ?? '',
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
        if (value == null || value === '') {
          p.delete(key);
        } else if (value === 'all') {
          if (key === 'isActive') p.set(key, 'all');
          else p.delete(key);
        } else {
          p.set(key, value);
        }
      }
      p.set('page', '1');
    });
  };

  const handleFiltersReset = () => updateParams((p) => {
    ['thicknessMM', 'grade', 'isActive', 'lowStock'].forEach((k) => p.delete(k));
    p.set('page', '1');
  });

  const handleRowClick = (product) => navigate(`/products/${product._id}`);

  const handleToggleActive = async (product) => {
    try {
      await updateMutation.mutateAsync({
        id: product._id,
        payload: { isActive: !product.isActive },
      });
    } catch { /* toast surfaced by hook */ }
  };

  // ─── Bulk Activate / Deactivate ───
  // Backend has NO product bulk-update endpoint (only customers do).
  // Fan out as N parallel PUTs via Promise.allSettled and aggregate
  // the toast. The customer module hits a single bulk endpoint;
  // products mirror the UX but use a different mechanism.
  const [bulkRunning, setBulkRunning] = useState(false);
  // Bumped after every bulk op so DataTable clears its internal
  // rowSelection (the parent's `selectedRows` state alone can't —
  // tanstack owns checkbox state inside the table).
  const [selectionResetSignal, setSelectionResetSignal] = useState(0);

  const runBulkSetActive = async (nextActive) => {
    if (selectedRows.length === 0 || bulkRunning) return;
    const verb = nextActive ? 'Activate' : 'Deactivate';
    if (!nextActive && !window.confirm(`${verb} ${selectedRows.length} product(s)?`)) return;

    setBulkRunning(true);
    const t = toast.loading(`${verb} ${selectedRows.length} product${selectedRows.length === 1 ? '' : 's'}…`);
    try {
      const results = await Promise.allSettled(
        selectedRows.map((p) =>
          updateMutation.mutateAsync({ id: p._id, payload: { isActive: nextActive } })
        )
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      toast.dismiss(t);
      if (failed === 0) {
        toast.success(`${verb}d ${ok} product${ok === 1 ? '' : 's'}`);
      } else {
        toast.error(`${verb}d ${ok}, ${failed} failed`);
      }
      setSelectedRows([]);
      setSelectionResetSignal(v => v + 1);
    } finally {
      setBulkRunning(false);
    }
  };

  const handleDelete = async (product) => {
    if (!window.confirm(`Soft-delete ${product.name}? This is reversible.`)) return;
    try {
      await deleteMutation.mutateAsync({
        id: product._id,
        body: { reason: 'Soft-deleted via admin UI' },
      });
    } catch { /* toast surfaced */ }
  };

  const handleExportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : products;
    if (rows.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    exportToCsv(rows, 'products', [
      'sku', 'name', 'brand',
      'thicknessMM', 'lengthFT', 'widthFT', 'areaSqFt',
      'basePrice', 'pricingUnit', 'gstRatePct',
      'currentStock', 'minStockAlert', 'reorderQuantity',
      'isActive', 'createdAt',
    ]);
    toast.success(`Exported ${rows.length} product${rows.length === 1 ? '' : 's'}`);
  };

  const columns = useMemo(() => productColumns(), []);
  const rowActions = useMemo(() => productRowActions({
    onView:         (p) => navigate(`/products/${p._id}`),
    onEdit:         (p) => setEditing(p),
    onToggleActive: handleToggleActive,
    onDelete:       handleDelete,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        subtitle={`${totalCount} total product${totalCount === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Filter size={14} />}
              onClick={() => setFiltersOpen(o => !o)}
            >
              Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={14} />}
              onClick={handleExportCsv}
              disabled={products.length === 0}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              Add Product
            </Button>
          </div>
        }
      />

      {filtersOpen && (
        <ProductFilters
          values={initialFilters}
          onApply={handleFiltersApply}
          onReset={handleFiltersReset}
        />
      )}

      {backendParams.isActive === 'true' && (
        <Alert variant="info" className="!py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>Showing active products only.</span>
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
        data={products}
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
        searchPlaceholder="Search by SKU, name, brand…"
        rowActions={rowActions}
        bulkActions={[
          { label: 'Activate',   onClick: () => runBulkSetActive(true),  variant: 'secondary' },
          { label: 'Deactivate', onClick: () => runBulkSetActive(false), variant: 'danger' },
        ]}
        emptyState={{
          icon: <Package size={24} />,
          title: 'No products found',
          description: backendParams.search
            ? 'Try a different search or clear filters.'
            : 'Get started by adding your first product.',
          action: { label: 'Add Product', onClick: () => setCreateOpen(true) },
        }}
      />

      {(createOpen || editing) && (
        <ProductFormModal
          open
          product={editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

// re-export for App import convenience
export { ROUTES };
