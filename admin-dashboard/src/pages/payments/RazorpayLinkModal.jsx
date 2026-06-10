import { useState } from 'react';
import {
  Copy, Zap, MessageSquare, ExternalLink, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { useInitiatePayment } from '../../hooks/queries/usePayments.js';
import { formatINR } from '../../utils/format.js';
import { paiseToRupees } from '../../api/payment.api.js';

/**
 * Razorpay payment-link generator.
 *
 * Backend's POST /payments/initiate creates a Razorpay order and
 * returns the payment-link metadata. We display the link with copy +
 * share-via-WhatsApp affordances. The actual customer payment +
 * /verify call happens out-of-band (webhook OR admin manually verifies).
 *
 * Note: backend's initiate expects amount in RUPEES (per the validator's
 * `z.number().positive()`) — the conversion to paise happens server-side.
 */
export default function RazorpayLinkModal({ open, order, bill, defaultAmount, onClose }) {
  const initiate = useInitiatePayment();

  const [amount, setAmount] = useState(defaultAmount ?? 0);
  const [customerNote, setCustomerNote] = useState('');
  const [generated, setGenerated] = useState(null);

  const orderId = order?._id || bill?.order?._id || (typeof bill?.order === 'string' ? bill.order : null);
  const billId = bill?._id || null;
  const customer = order?.customer || bill?.customer || null;
  const customerName = typeof customer === 'object' ? customer.customerName : '';
  const customerPhone = (typeof customer === 'object' && customer.phone) || '';

  const handleGenerate = async () => {
    if (!orderId) {
      toast.error('No order linked — Razorpay needs an order context.');
      return;
    }
    if (!amount || +amount <= 0) {
      toast.error('Amount must be positive');
      return;
    }
    try {
      const res = await initiate.mutateAsync({
        order: orderId,
        amount: +amount,
        bill: billId || undefined,
        notes: customerNote || undefined,
      });
      // Backend's initiate returns the payment-reference + Razorpay info
      const payload = res?.data || res;
      setGenerated(payload);
    } catch { /* toast surfaced by hook */ }
  };

  // Backend may return either a hosted short-link OR raw Razorpay order
  // info that the frontend turns into a checkout invocation. We surface
  // whatever URL is present.
  const shareUrl =
    generated?.paymentLink
    || generated?.shortUrl
    || generated?.short_url
    || generated?.url
    || '';

  const reference = generated?.paymentReference || generated?.razorpayOrderId || '';

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Copy failed — select + copy manually');
    }
  };

  const handleWhatsApp = () => {
    const message = `Hello ${customerName || 'Customer'},

Please use the link below to pay ${formatINR(+amount || 0)} towards ${
  bill ? `invoice ${bill.billNumber}` : `order ${order?.orderNumber || ''}`
}:

${shareUrl}

Thank you,
Shree Gopal MDF`;
    const digits = customerPhone.replace(/\D/g, '').slice(-10);
    const href = digits
      ? `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title="Razorpay Payment Link"
      size="lg"
      footer={
        generated ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={initiate.isPending}>Cancel</Button>
            <Button
              variant="primary"
              leftIcon={<Zap size={14} />}
              onClick={handleGenerate}
              loading={initiate.isPending}
              disabled={initiate.isPending || !orderId}
            >
              Generate link
            </Button>
          </>
        )
      }
    >
      {!generated ? (
        <div className="space-y-3">
          <Alert variant="info" className="!py-2 text-xs">
            This creates a Razorpay order on the backend and returns a
            shareable payment link. The customer completes payment in
            their Razorpay session; the backend records it via webhook OR
            manual verify.
          </Alert>

          <Card>
            <Card.Body className="text-sm space-y-1">
              {customerName && (
                <div>
                  <span className="text-secondary-500">Customer:</span>{' '}
                  <span className="font-medium">{customerName}</span>
                </div>
              )}
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
            </Card.Body>
          </Card>

          <Input
            label="Amount (₹)" required
            type="number" min={1} step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Textarea
            label="Customer-facing note (optional)"
            rows={2}
            value={customerNote}
            onChange={(e) => setCustomerNote(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <Alert variant="success">
            <div className="text-xs">
              <strong>Link generated.</strong> Share it with the customer; they'll
              complete payment in their Razorpay session.
            </div>
          </Alert>

          <Card>
            <Card.Body className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {reference && (
                  <span className="text-secondary-500">
                    Reference:{' '}
                    <span className="font-mono text-primary-700">{reference}</span>
                  </span>
                )}
                <Badge variant="info" size="sm">
                  {formatINR(generated?.amount ? paiseToRupees(generated.amount) : +amount)}
                </Badge>
              </div>

              {shareUrl ? (
                <>
                  <div className="text-xs text-secondary-500 mt-2">Payment link</div>
                  <div className="font-mono text-xs break-all bg-secondary-50 p-2 rounded
                                  border border-secondary-200">
                    {shareUrl}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline" size="sm"
                      leftIcon={<Copy size={14} />}
                      onClick={handleCopy}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      leftIcon={<MessageSquare size={14} />}
                      onClick={handleWhatsApp}
                    >
                      Send via WhatsApp
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      leftIcon={<ExternalLink size={14} />}
                      onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Open
                    </Button>
                  </div>
                </>
              ) : (
                <Alert variant="warning" className="!py-2 text-xs">
                  Backend didn't return a shareable URL — Razorpay may
                  require this admin's checkout-redirect flow. Reference
                  recorded; share the reference with the customer for
                  reconciliation.
                </Alert>
              )}
            </Card.Body>
          </Card>

          <div className="text-xs text-secondary-500 inline-flex items-center gap-1">
            <Check size={12} /> The payment will show in /payments list once
            the customer completes their session.
          </div>
        </div>
      )}
    </Modal>
  );
}
