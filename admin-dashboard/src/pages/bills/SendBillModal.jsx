import { useMemo, useState } from 'react';
import { MessageSquare, Mail, ExternalLink, Check } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { useMarkBillSent } from '../../hooks/queries/useBills.js';
import { billApi } from '../../api/bill.api.js';
import { formatINR } from '../../utils/format.js';

/**
 * Guided "send to customer" flow.
 *
 * Per backend Section A contract diff #3: the backend has NO endpoint
 * that triggers WhatsApp/Email send. The admin manually delivers via
 * the customer's channel of choice (WhatsApp web/app, email client).
 * This modal:
 *   1. Pre-fills a message body with bill number + amount + PDF link
 *   2. Opens the chosen channel via `whatsapp://send?…` or `mailto:`
 *   3. After delivery, the admin clicks "I sent it — mark as sent"
 *      which records the event via /bills/:id/mark-sent
 *
 * Two channels (WhatsApp, Email) — print/in-person use MarkSentModal
 * directly.
 */
function buildMessage(bill) {
  if (!bill) return '';
  const customerName = (typeof bill.customer === 'object' ? bill.customer?.customerName : '') || 'Customer';
  return `Hello ${customerName},

Your invoice ${bill.billNumber || ''} for ${formatINR(bill.grandTotal ?? 0)} is ready.

You can view + download it here:
${billApi.pdfUrl(bill._id)}

Thank you,
Shree Gopal MDF`;
}

export default function SendBillModal({ open, bill, onClose }) {
  const [channel, setChannel] = useState(null);  // 'whatsapp' | 'email' | null
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState(() => buildMessage(bill));

  const markSent = useMarkBillSent();

  const customer = typeof bill?.customer === 'object' ? bill.customer : null;
  const phone = customer?.phone || '';
  const email = customer?.email || '';

  const channelHref = useMemo(() => {
    if (!channel) return null;
    const text = encodeURIComponent(message);
    if (channel === 'whatsapp') {
      const digits = phone.replace(/\D/g, '');
      // Falls back to wa.me which works without the customer being on WhatsApp Web
      return digits
        ? `https://wa.me/91${digits.slice(-10)}?text=${text}`
        : `https://wa.me/?text=${text}`;
    }
    if (channel === 'email') {
      const subject = encodeURIComponent(`Invoice ${bill?.billNumber || ''}`);
      const target = email || '';
      return `mailto:${target}?subject=${subject}&body=${text}`;
    }
    return null;
  }, [channel, message, phone, email, bill?.billNumber]);

  const handleOpenChannel = () => {
    if (!channelHref) return;
    window.open(channelHref, '_blank', 'noopener,noreferrer');
    setOpened(true);
  };

  const handleMarkSent = async () => {
    try {
      await markSent.mutateAsync({
        id: bill._id,
        channel,
        recipientInfo: channel === 'whatsapp' ? phone : email,
        notes: 'Sent via guided modal',
      });
      onClose?.();
    } catch { /* toast surfaced */ }
  };

  const reset = () => { setChannel(null); setOpened(false); };

  return (
    <Modal
      open={!!open}
      onClose={() => { reset(); onClose?.(); }}
      title={`Send ${bill?.billNumber || 'bill'} to customer`}
      size="lg"
      footer={
        channel ? (
          <>
            <Button variant="ghost" onClick={() => reset()}>Back</Button>
            <Button
              variant="primary"
              leftIcon={<Check size={14} />}
              onClick={handleMarkSent}
              loading={markSent.isPending}
              disabled={!opened || markSent.isPending}
              title={!opened ? 'Open the channel above first' : undefined}
            >
              I sent it — mark as sent
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        )
      }
    >
      {!channel ? (
        <div className="space-y-3">
          <Alert variant="info" className="!py-2 text-xs">
            Pick a channel — we'll prefill the message and open the customer's
            preferred app. Once you've sent it, return here and click
            "Mark as sent" to record the event in the audit log.
          </Alert>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            <Card>
              <button
                type="button"
                onClick={() => setChannel('whatsapp')}
                className="w-full text-left p-3 hover:bg-secondary-50 rounded"
              >
                <div className="flex items-center gap-2 font-medium text-secondary-900">
                  <MessageSquare size={16} className="text-success-600" />
                  WhatsApp
                </div>
                <div className="mt-1 text-xs text-secondary-500">
                  {phone ? `to ${phone}` : 'No phone on file'}
                </div>
              </button>
            </Card>
            <Card>
              <button
                type="button"
                onClick={() => setChannel('email')}
                className="w-full text-left p-3 hover:bg-secondary-50 rounded"
              >
                <div className="flex items-center gap-2 font-medium text-secondary-900">
                  <Mail size={16} className="text-info-600" />
                  Email
                </div>
                <div className="mt-1 text-xs text-secondary-500">
                  {email ? `to ${email}` : 'No email on file'}
                </div>
              </button>
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            label="Message"
            rows={8}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              leftIcon={<ExternalLink size={14} />}
              onClick={handleOpenChannel}
            >
              Open {channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
            </Button>
            {opened && (
              <span className="inline-flex items-center gap-1 text-xs text-success-700">
                <Check size={14} /> Channel opened — complete the send, then click below.
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
