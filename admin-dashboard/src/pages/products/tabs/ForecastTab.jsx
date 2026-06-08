import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Alert } from '../../../components/ui/Alert.jsx';
import { TrendingUp, RefreshCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { queryKeys } from '../../../utils/queryKeys.js';
import { formatDate } from '../../../utils/format.js';

/**
 * MAPE = Mean Absolute Percentage Error. Lower is better.
 *   < 10%   → excellent (green)
 *   10–25%  → ok (amber)
 *   > 25%   → poor (red)
 */
function mapeBadge(mape) {
  if (mape == null || Number.isNaN(mape)) return { variant: 'neutral', label: 'N/A' };
  const pct = Number(mape);
  if (pct < 10)  return { variant: 'success', label: `MAPE ${pct.toFixed(1)}%` };
  if (pct < 25)  return { variant: 'warning', label: `MAPE ${pct.toFixed(1)}%` };
  return { variant: 'danger', label: `MAPE ${pct.toFixed(1)}%` };
}

const METHOD_VARIANT = {
  HOLT_WINTERS:    'success',
  MOVING_AVERAGE:  'info',
  NAIVE:           'warning',
  FALLBACK:        'neutral',
};

function StatCell({ label, value, accent = 'primary' }) {
  const tone = {
    primary: 'text-primary-700 bg-primary-50',
    success: 'text-success-700 bg-success-50',
    warning: 'text-warning-700 bg-warning-50',
  }[accent] || 'text-primary-700 bg-primary-50';
  return (
    <div className={`p-3 rounded-md ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value ?? '—'}</div>
    </div>
  );
}

export default function ForecastTab({ product }) {
  const qc = useQueryClient();
  const f = product?.forecastData || {};

  const recompute = useMutation({
    mutationFn: () => api.post(`/forecast/run/${product._id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(product._id) });
      toast.success('Forecast recomputed');
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || err?.message || 'Recompute failed';
      toast.error(msg);
    },
  });

  if (!f.lastComputedAt && !f.method) {
    return (
      <Card>
        <Card.Body className="text-center py-8 space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-secondary-100 flex items-center justify-center text-secondary-400">
            <TrendingUp size={24} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-secondary-900">No forecast yet</h3>
            <p className="mt-1 text-sm text-secondary-500 max-w-md mx-auto">
              Run a forecast to predict demand for the next 30/90/180 days.
              The nightly cron also computes these automatically.
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<RefreshCcw size={14} />}
            loading={recompute.isPending}
            onClick={() => recompute.mutate()}
          >
            Compute Forecast
          </Button>
        </Card.Body>
      </Card>
    );
  }

  const mape = mapeBadge(f.mape);
  const methodVariant = METHOD_VARIANT[f.method] || 'neutral';

  return (
    <div className="space-y-4">
      {/* Method + accuracy */}
      <Card>
        <Card.Body className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={methodVariant} size="md">
              {f.method || 'UNKNOWN'}
            </Badge>
            <Badge variant={mape.variant} size="md">{mape.label}</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-secondary-500">
            {f.lastComputedAt && (
              <span>Computed {formatDate(f.lastComputedAt)}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCcw size={14} />}
              loading={recompute.isPending}
              onClick={() => recompute.mutate()}
            >
              Recompute
            </Button>
          </div>
        </Card.Body>
      </Card>

      {/* Historical */}
      <Card>
        <Card.Header title="Historical Consumption" />
        <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <StatCell label="Last 30 days"  value={f.last30Days  ?? f.consumption30  ?? '—'} accent="primary" />
          <StatCell label="Last 90 days"  value={f.last90Days  ?? f.consumption90  ?? '—'} accent="primary" />
          <StatCell label="Last 365 days" value={f.last365Days ?? f.consumption365 ?? '—'} accent="primary" />
        </Card.Body>
      </Card>

      {/* Forecast */}
      <Card>
        <Card.Header title="Forecast" />
        <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <StatCell label="Next 30 days"  value={f.forecast30  ?? f.next30  ?? '—'} accent="success" />
          <StatCell label="Next 90 days"  value={f.forecast90  ?? f.next90  ?? '—'} accent="success" />
          <StatCell label="Next 180 days" value={f.forecast180 ?? f.next180 ?? '—'} accent="success" />
        </Card.Body>
      </Card>

      {f.method === 'FALLBACK' && (
        <Alert variant="warning">
          Insufficient sales history to run Holt-Winters. The fallback uses a flat
          moving-average estimate. Accuracy will improve as more orders are recorded.
        </Alert>
      )}
    </div>
  );
}

// Exposed for tests
export const _internals = { mapeBadge };
