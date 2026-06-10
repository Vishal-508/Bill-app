import { useState, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Radio } from '../../components/ui/Radio.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { useAddOrderPayment } from '../../hooks/queries/useOrders.js';
import { formatINR } from '../../utils/format.js';
import { Coins, Smartphone, Landmark, ScrollText, Zap } from 'lucide-react';

/**
 * Add Payment — operational entry point for manual receipts AND the
 * Razorpay link kick-off.
 *
 * TWO BACKEND PATHS (per Section A audit + Section F audit):
 *  - **Manual** (CASH/UPI/CARD/BANK_TRANSFER/CHEQUE/CREDIT) →
 *    `POST /orders/:id/payments` (rupees, embedded in order doc).
 *    This is what `useAddOrderPayment` calls.
 *  - **Razorpay link** → opens RazorpayLinkModal (sibling), which uses
 *    `POST /payments/initiate` (the 2-leg flow, paise, separate
 *    collection).
 *
 * Caller must provide `order` (full order doc) OR `bill` (so we can
 * derive order). This modal does NOT support free-form order picking —
 * payments must be linked. Most callers come from OrderDetail's
 * PaymentsTab or BillDetail's Add Payment button.
 */
const MODES = [
  { value: 'CASH',          label: 'Cash',           icon: Coins,     hint: 'Amount only' },
  { value: 'UPI',           label: 'UPI',            icon: Smartphone, hint: '+ UPI reference' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer',  icon: Landmark,  hint: '+ transaction ID + bank' },
  { value: 'CHEQUE',        label: 'Cheque',         icon: ScrollText, hint: '+ cheque # + bank + date' },
  { value: 'RAZORPAY_LINK', label: 'Razorpay link',  icon: Zap,       hint: 'Generate online payment link' },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function AddPaymentModal({
  open, order, bill, defaultAmount, onClose, onRazorpaySelected,
}) {
  // Caller passes EITHER order or bill. We always submit to the order's
  // /payments endpoint (manual modes). Razorpay flow hands off to
  // RazorpayLinkModal via the onRazorpaySelected callback.
  const orderId = order?._id || bill?.order?._id || (typeof bill?.order === 'string' ? bill.order : null);

  const initialAmount = useMemo(() => {
    if (defaultAmount != null) return defaultAmount;
    if (bill?.amountDue != null) return bill.amountDue;
    if (order?.amountDue != null) return order.amountDue;
    if (bill?.grandTotal) {
      const paid = bill.amountPaid ?? 0;
      return Math.max(0, bill.grandTotal - paid);
    }
    if (order?.totalAmount) {
      const paid = order.amountPaid ?? 0;
      return Math.max(0, order.totalAmount - paid);
    }
    return 0;
  }, [defaultAmount, bill, order]);

  const [mode, setMode]               = useState('CASH');
  const [amount, setAmount]           = useState(initialAmount);
  const [paidAt, setPaidAt]           = useState(todayIso());
  const [notes, setNotes]             = useState('');
  // Mode-specific fields
  const [upiRef, setUpiRef]           = useState('');
  const [payerName, setPayerName]     = useState('');
  const [txnId, setTxnId]             = useState('');
  const [bankName, setBankName]       = useState('');
  const [chequeNo, setChequeNo]       = useState('');
  const [chequeDate, setChequeDate]   = useState(todayIso());
  const [serverError, setServerError] = useState(null);

  const addPayment = useAddOrderPayment();

  const handleSubmit = async () => {
    setServerError(null);

    if (mode === 'RAZORPAY_LINK') {
      onRazorpaySelected?.({ order, bill, defaultAmount: amount });
      onClose?.();
      return;
    }

    if (!orderId) {
      setServerError('No order linked — manual payments must attach to an order.');
      return;
    }
    if (!amount || +amount <= 0) {
      setServerError('Amount must be positive');
      return;
    }

    // Compose the mode-specific reference string the backend stores
    const reference = mode === 'UPI'
      ? [upiRef, payerName].filter(Boolean).join(' / ')
      : mode === 'BANK_TRANSFER'
        ? [txnId, bankName].filter(Boolean).join(' / ')
        : mode === 'CHEQUE'
          ? [`Cheque ${chequeNo}`, bankName, `dated ${chequeDate}`].filter(Boolean).join(' / ')
          : '';

    try {
      await addPayment.mutateAsync({
        orderId,
        amount: +amount,
        mode,
        reference: reference || undefined,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        notes: notes || undefined,
      });
      onClose?.();
    } catch (err) {
      const msg = err?.response?.data?.message
        || err?.message
        || 'Failed to record payment';
      setServerError(msg);
    }
  };

  const showUpiFields    = mode === 'UPI';
  const showBankFields   = mode === 'BANK_TRANSFER';
  const showChequeFields = mode === 'CHEQUE';
  const showCashFields   = mode === 'CASH';
  const isRazorpay       = mode === 'RAZORPAY_LINK';

  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title={
        bill ? `Add payment for ${bill.billNumber}` :
        order ? `Add payment for ${order.orderNumber}` :
        'Add payment'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={addPayment.isPending}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={addPayment.isPending}
            disabled={addPayment.isPending}
          >
            {isRazorpay ? 'Continue to Razorpay' : 'Record payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {serverError && <Alert variant="error">{serverError}</Alert>}

        {/* Context card */}
        {(bill || order) && (
          <Card>
            <Card.Body className="text-sm space-y-0.5">
              {bill && (
                <div>
                  <span className="text-secondary-500">Bill:</span>{' '}
                  <span className="font-mono text-primary-700">{bill.billNumber}</span>
                </div>
              )}
              {order && (
                <div>
                  <span className="text-secondary-500">Order:</span>{' '}
                  <span className="font-mono text-primary-700">{order.orderNumber}</span>
                </div>
              )}
              {initialAmount > 0 && (
                <div>
                  <span className="text-secondary-500">Outstanding:</span>{' '}
                  <span className="font-medium text-danger-700">{formatINR(initialAmount)}</span>
                </div>
              )}
            </Card.Body>
          </Card>
        )}

        {/* Mode selector */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-2">Mode</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {MODES.map(m => {
              const Icon = m.icon;
              const isSel = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`text-left p-2.5 rounded-md border transition-colors ${
                    isSel
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-secondary-200 hover:bg-secondary-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} className={isSel ? 'text-primary-700' : 'text-secondary-500'} />
                    <span className={isSel ? 'font-semibold text-primary-900' : 'font-medium text-secondary-900'}>
                      {m.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-secondary-500">{m.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Common amount + date */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Input
            label="Amount (₹)" required
            type="number" min={0} step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText={initialAmount > 0 ? `Outstanding: ${formatINR(initialAmount)}` : undefined}
          />
          <Input
            label="Received on" type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            disabled={isRazorpay}
          />
        </div>

        {/* Mode-specific fields */}
        {showCashFields && (
          <Alert variant="info" className="!py-2 text-xs">
            Cash payment — no additional reference required.
          </Alert>
        )}

        {showUpiFields && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input
              label="UPI reference (UTR)" placeholder="e.g. 326812345678"
              value={upiRef} onChange={(e) => setUpiRef(e.target.value)}
            />
            <Input
              label="Payer name (optional)"
              value={payerName} onChange={(e) => setPayerName(e.target.value)}
            />
          </div>
        )}

        {showBankFields && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input
              label="Transaction ID" required
              value={txnId} onChange={(e) => setTxnId(e.target.value)}
            />
            <Input
              label="Bank name"
              value={bankName} onChange={(e) => setBankName(e.target.value)}
            />
          </div>
        )}

        {showChequeFields && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Input
              label="Cheque #" required
              value={chequeNo} onChange={(e) => setChequeNo(e.target.value)}
            />
            <Input
              label="Bank"
              value={bankName} onChange={(e) => setBankName(e.target.value)}
            />
            <Input
              label="Cheque date" type="date"
              value={chequeDate} onChange={(e) => setChequeDate(e.target.value)}
            />
          </div>
        )}

        {isRazorpay && (
          <Alert variant="info" className="!py-2 text-xs">
            Razorpay link uses a separate online flow — clicking
            "Continue" will open the link generator where you set the
            amount, expiry, and share with the customer via WhatsApp.
          </Alert>
        )}

        <Textarea
          label="Notes (optional)"
          rows={2}
          value={notes} onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}
