import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, XCircle, RefreshCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  usePaymentDetail, useCancelPayment,
} from '../../hooks/queries/usePayments.js';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { paymentApi, paiseToRupees } from '../../api/payment.api.js';
import { formatINR, formatDateTime } from '../../utils/format.js';
import PaymentHeader from './PaymentHeader.jsx';

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <div className="w-36 flex-shrink-0 text-xs uppercase tracking-wide text-secondary-500">
        {label}
      </div>
      <div className="flex-1 text-sm text-secondary-900 break-words">
        {children || <span className="text-secondary-400">—</span>}
      </div>
    </div>
  );
}

export default function PaymentDetail() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const paymentQuery = usePaymentDetail(paymentId);
  const cancelMutation = useCancelPayment();

  const payment = paymentQuery.data?.data;

  if (paymentQuery.isLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Spinner size="lg" /></div>;
  }

  if (paymentQuery.isError || !payment) {
    const status = paymentQuery.error?.response?.status;
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/payments')}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700">
          <ArrowLeft size={14} /> Back to Payments
        </button>
        <Card><Card.Body>
          <Alert variant="error">
            {status === 404
              ? 'Payment not found — it may have been deleted.'
              : `Could not load payment (${paymentQuery.error?.message || 'unknown error'}).`}
          </Alert>
        </Card.Body></Card>
      </div>
    );
  }

  const handleDownloadReceipt = async () => {
    try {
      const filename = await paymentApi.downloadReceipt(payment._id);
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

  const handleCancel = async () => {
    const reason = window.prompt(
      `Cancel payment ${payment.paymentReference}? Enter a reason (3+ chars):`
    );
    if (!reason || reason.trim().length < 3) return;
    try { await cancelMutation.mutateAsync({ id: payment._id, reason: reason.trim() }); }
    catch { /* toast surfaced */ }
  };

  const canCancel = ['CREATED', 'ATTEMPTED'].includes(payment.status);
  const isCaptured = payment.status === 'CAPTURED';
  const refundedRupees = paiseToRupees(payment.amountRefunded ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/payments');
          }}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1.5 py-0.5"
        >
          <ArrowLeft size={14} /> Back to Payments
        </button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            leftIcon={<Download size={14} />}
            onClick={handleDownloadReceipt}
          >
            Receipt
          </Button>
          {canCancel && (
            <Button
              variant="outline" size="sm"
              leftIcon={<XCircle size={14} />}
              onClick={handleCancel}
              loading={cancelMutation.isPending}
              className="!text-danger-700 hover:!bg-danger-50"
            >
              Cancel payment
            </Button>
          )}
        </div>
      </div>

      <PaymentHeader payment={payment} />

      {/* Gateway-specific details */}
      <Card>
        <Card.Header title="Gateway details" />
        <Card.Body>
          <Row label="Reference">{payment.paymentReference}</Row>
          {payment.gateway === 'razorpay' && (
            <>
              <Row label="Razorpay Order">{payment.razorpayOrderId}</Row>
              <Row label="Razorpay Payment">{payment.razorpayPaymentId}</Row>
              <Row label="Source">{payment.source}</Row>
            </>
          )}
          <Row label="Method">{payment.method || '—'}</Row>
          <Row label="Status">{payment.status}</Row>
          {payment.failureReason && (
            <Row label="Failure reason">
              <span className="text-danger-700">{payment.failureReason}</span>
            </Row>
          )}
        </Card.Body>
      </Card>

      {/* Amount breakdown */}
      <Card>
        <Card.Header title="Amount" />
        <Card.Body>
          <Row label="Amount received">{formatINR(paiseToRupees(payment.amount))}</Row>
          {refundedRupees > 0 && (
            <>
              <Row label="Amount refunded">
                <span className="text-warning-700">{formatINR(refundedRupees)}</span>
              </Row>
              <Row label="Net retained">
                {formatINR(paiseToRupees(payment.amount) - refundedRupees)}
              </Row>
            </>
          )}
          {payment.fees > 0 && (
            <Row label="Gateway fees">{formatINR(paiseToRupees(payment.fees))}</Row>
          )}
        </Card.Body>
      </Card>

      {/* Events / audit trail */}
      {Array.isArray(payment.events) && payment.events.length > 0 && (
        <Card>
          <Card.Header title={`Events (${payment.events.length})`} />
          <Card.Body>
            <ol className="relative border-l-2 border-secondary-200 pl-5 space-y-3">
              {[...payment.events].reverse().map((e, idx) => (
                <li key={idx} className="relative">
                  <span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full
                                   ring-4 ring-white bg-secondary-300" />
                  <div className="text-sm">
                    <span className="font-medium text-secondary-900">
                      {e.event || e.type || e.action}
                    </span>
                    <span className="text-xs text-secondary-500 ml-2">
                      {formatDateTime(e.timestamp || e.createdAt)}
                    </span>
                  </div>
                  {e.notes && (
                    <div className="text-xs text-secondary-600 italic">"{e.notes}"</div>
                  )}
                </li>
              ))}
            </ol>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
