import { useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { useMarkBillSent } from '../../hooks/queries/useBills.js';

const CHANNELS = [
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'email',     label: 'Email' },
  { value: 'print',     label: 'Print' },
  { value: 'in-person', label: 'In-person' },
];

/**
 * Stand-alone "record the send" modal. Use when the admin already
 * delivered the bill via some channel (phone call, hand-delivery,
 * printed copy) outside the app and just needs to log the event.
 *
 * For the guided WhatsApp/Email send-and-then-mark flow, see SendBillModal.
 */
export default function MarkSentModal({ open, bill, onClose }) {
  const [channel, setChannel] = useState('whatsapp');
  const [recipientInfo, setRecipientInfo] = useState('');
  const [notes, setNotes] = useState('');

  const markSent = useMarkBillSent();

  const handleSubmit = async () => {
    try {
      await markSent.mutateAsync({
        id: bill._id,
        channel,
        notes: notes || undefined,
        recipientInfo: recipientInfo || undefined,
      });
      onClose?.();
    } catch { /* toast surfaced by hook */ }
  };

  return (
    <Modal
      open={!!open} onClose={onClose}
      title={`Mark ${bill?.billNumber || 'bill'} as sent`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={markSent.isPending}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={markSent.isPending}
            disabled={markSent.isPending}
          >
            Record send event
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert variant="info" className="!py-2 text-xs">
          This records that you delivered the bill — it doesn't trigger
          the send. For guided WhatsApp / Email delivery, use "Send to
          customer".
        </Alert>
        <Select
          label="Channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          options={CHANNELS}
        />
        <Input
          label="Recipient (optional)"
          placeholder="Phone, email, or person who received"
          value={recipientInfo}
          onChange={(e) => setRecipientInfo(e.target.value)}
        />
        <Textarea
          label="Notes (optional)"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}
