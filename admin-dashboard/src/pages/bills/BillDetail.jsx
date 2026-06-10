import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, Send, Check, Lock, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useBillDetail, useFinalizeBill, useCancelBill } from '../../hooks/queries/useBills.js';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { billApi } from '../../api/bill.api.js';
import BillHeader from './BillHeader.jsx';
import BillStats from './BillStats.jsx';
import BillTabs from './BillTabs.jsx';
import SendBillModal from './SendBillModal.jsx';
import MarkSentModal from './MarkSentModal.jsx';
import { isDraft, isLocked } from './_billColumns.jsx';

export default function BillDetail() {
  const { billId } = useParams();
  const navigate = useNavigate();

  const billQuery = useBillDetail(billId);
  const finalizeMutation = useFinalizeBill();
  const cancelMutation = useCancelBill();

  const [sendOpen, setSendOpen] = useState(false);
  const [markSentOpen, setMarkSentOpen] = useState(false);

  const bill = billQuery.data?.data;

  if (billQuery.isLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Spinner size="lg" /></div>;
  }

  if (billQuery.isError || !bill) {
    const status = billQuery.error?.response?.status;
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/bills')}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700">
          <ArrowLeft size={14} /> Back to Bills
        </button>
        <Card><Card.Body>
          <Alert variant="error">
            {status === 404
              ? 'Bill not found — it may have been deleted.'
              : `Could not load bill (${billQuery.error?.message || 'unknown error'}).`}
          </Alert>
        </Card.Body></Card>
      </div>
    );
  }

  const handleDownload = async () => {
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

  const handleFinalize = async () => {
    if (!window.confirm(
      `Finalize ${bill.billNumber}? This locks the bill for further edits.`
    )) return;
    try { await finalizeMutation.mutateAsync({ id: bill._id }); }
    catch { /* toast surfaced */ }
  };

  const handleCancel = async () => {
    const reason = window.prompt(
      `Cancel ${bill.billNumber}? Enter a reason (3+ chars):`
    );
    if (!reason || reason.trim().length < 3) return;
    try { await cancelMutation.mutateAsync({ id: bill._id, reason: reason.trim() }); }
    catch { /* toast surfaced */ }
  };

  const canFinalize = isDraft(bill);
  const canCancel = !isLocked(bill) && bill.status !== 'CANCELLED';

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/bills');
          }}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1.5 py-0.5"
        >
          <ArrowLeft size={14} /> Back to Bills
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline" size="sm"
            leftIcon={<Download size={14} />}
            onClick={handleDownload}
          >
            PDF
          </Button>
          <Button
            variant="outline" size="sm"
            leftIcon={<Send size={14} />}
            onClick={() => setSendOpen(true)}
            disabled={bill.status === 'CANCELLED'}
          >
            Send
          </Button>
          <Button
            variant="outline" size="sm"
            leftIcon={<Check size={14} />}
            onClick={() => setMarkSentOpen(true)}
            disabled={bill.status === 'CANCELLED'}
          >
            Mark sent
          </Button>
          {canFinalize && (
            <Button
              variant="primary" size="sm"
              leftIcon={<Lock size={14} />}
              onClick={handleFinalize}
              loading={finalizeMutation.isPending}
            >
              Finalize
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline" size="sm"
              leftIcon={<XCircle size={14} />}
              onClick={handleCancel}
              loading={cancelMutation.isPending}
              className="!text-danger-700 hover:!bg-danger-50"
            >
              Cancel bill
            </Button>
          )}
        </div>
      </div>

      <BillHeader bill={bill} />
      <BillStats bill={bill} />
      <BillTabs bill={bill} />

      {sendOpen && (
        <SendBillModal open bill={bill} onClose={() => setSendOpen(false)} />
      )}
      {markSentOpen && (
        <MarkSentModal open bill={bill} onClose={() => setMarkSentOpen(false)} />
      )}
    </div>
  );
}
