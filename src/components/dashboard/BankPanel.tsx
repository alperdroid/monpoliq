import { cn } from '@/lib/utils';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { TrendChip } from '@/components/analytics/TrendChip';
import { SignalBadge } from '@/components/analytics/SignalBadge';

interface BankPanelProps {
  bank: string;
  score30d: number;
  commCount30d: number;
  statCount30d: number;
  totalItems: number;
  latestTitle: string;
  latestDate: string;
  commCount7d: number;
  className?: string;
}

export function BankPanel({
  bank, score30d, commCount30d, statCount30d, totalItems,
  latestTitle, latestDate, commCount7d, className,
}: BankPanelProps) {
  const stanceLabel = score30d > 0.3 ? 'Hawkish' : score30d > 0.1 ? 'Sl. Hawkish' : score30d < -0.3 ? 'Dovish' : score30d < -0.1 ? 'Sl. Dovish' : 'Neutral';
  const stanceVariant = score30d > 0.1 ? 'hawkish' : score30d < -0.1 ? 'dovish' : 'neutral';

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', bank === 'FED' ? 'bg-primary' : 'bg-prediction')} />
          <h3 className="text-sm font-semibold">{bank}</h3>
          <SignalBadge label={stanceLabel} variant={stanceVariant as any} size="md" />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {latestDate ? new Date(latestDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '—'}
        </span>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Latest Communication</p>
        <p className="text-sm font-medium truncate">{latestTitle || 'No data'}</p>
      </div>

      <StanceGauge value={score30d} label="Aggregate Score" size="sm" />

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Comms (30d)</p>
          <p className="text-sm font-mono font-semibold mt-0.5">{commCount30d}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stats (30d)</p>
          <p className="text-sm font-mono font-semibold mt-0.5">{statCount30d}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Items</p>
          <p className="text-sm font-mono font-semibold mt-0.5">{totalItems}</p>
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Activity</p>
        <div className="flex items-center gap-2 flex-wrap">
          <TrendChip label="7d Events" value={commCount7d} variant="default" />
          <TrendChip label="30d Events" value={commCount30d + statCount30d} variant="default" />
        </div>
      </div>
    </div>
  );
}
