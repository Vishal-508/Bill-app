import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, PowerOff, Power, AlertCircle } from 'lucide-react';
import {
  useCustomerDetail, useCustomerInsights, useUpdateCustomer,
} from '../../hooks/queries/useCustomers.js';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import CustomerHeader from './CustomerHeader.jsx';
import CustomerStats from './CustomerStats.jsx';
import CustomerTabs from './CustomerTabs.jsx';
import CustomerFormModal from './CustomerFormModal.jsx';
import { ROUTES } from '../../utils/constants.js';

export default function CustomerDetail() {
  const { customerId } = useParams();
  const navigate = useNavigate();

  const customerQuery = useCustomerDetail(customerId);
  const insightsQuery = useCustomerInsights(customerId);
  const updateMutation = useUpdateCustomer();

  const [editOpen, setEditOpen] = useState(false);

  const customer = customerQuery.data?.data;
  const insights = insightsQuery.data?.data?.insights;
  const financial = insightsQuery.data?.data?.financial;

  // ─── Loading / Error states ───
  if (customerQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (customerQuery.isError || !customer) {
    const status = customerQuery.error?.response?.status;
    return (
      <div className="space-y-4">
        <Link to={ROUTES.CUSTOMERS}
              className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700">
          <ArrowLeft size={14} /> Back to Customers
        </Link>
        <Card>
          <Card.Body>
            <Alert variant="error">
              {status === 404
                ? 'Customer not found — they may have been deleted.'
                : `Could not load customer (${customerQuery.error?.message || 'unknown error'}).`}
            </Alert>
          </Card.Body>
        </Card>
      </div>
    );
  }

  const handleToggleActive = async () => {
    const next = !customer.isActive;
    const verb = next ? 'reactivate' : 'deactivate';
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${customer.customerName}?`)) return;
    try {
      await updateMutation.mutateAsync({
        id: customer._id,
        payload: { isActive: next },
      });
    } catch {
      // toast already surfaced by the mutation hook
    }
  };

  return (
    <div className="space-y-4">
      {/* Top toolbar — back + actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          // navigate(-1) preserves the list's URL state (filters,
          // page, sort) for users who arrived via row-click. Falls
          // back to /customers for direct-URL visitors with no
          // history entry.
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate(ROUTES.CUSTOMERS);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1.5 py-0.5"
        >
          <ArrowLeft size={14} /> Back to Customers
        </button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Pencil size={14} />}
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          {customer.isActive ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<PowerOff size={14} />}
              onClick={handleToggleActive}
              loading={updateMutation.isPending}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Power size={14} />}
              onClick={handleToggleActive}
              loading={updateMutation.isPending}
            >
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {/* Status banner for inactive customers */}
      {!customer.isActive && (
        <Alert variant="warning" className="!py-2">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle size={14} />
            <span>This customer is currently inactive. Reactivate to allow new orders/bills.</span>
          </div>
        </Alert>
      )}

      {/* Header card */}
      <CustomerHeader customer={customer} />

      {/* Stats row */}
      <CustomerStats
        insights={insights}
        financial={financial}
        loading={insightsQuery.isLoading}
      />

      {/* Tabs */}
      <CustomerTabs customer={customer} insights={insights} />

      {/* Edit modal */}
      {editOpen && (
        <CustomerFormModal
          open
          customer={customer}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
