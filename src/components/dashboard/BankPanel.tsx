import { cn } from '@/lib/utils';
import type { BankSummary } from '@/types/central-bank';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { TrendChip } from '@/components/analytics/TrendChip';
import { SignalBadge } from '@/components/analytics/SignalBadge';

interface BankPanelProps {
  summary: BankSummary;
  className?: string;
}

const stanceLabelMap: Record<string, { label: string; variant: 'hawkish' | 'dovish' | 'neutral' }> = {
  very_hawkish: { label: 'Very Hawkish', variant: 'hawkish' },
  hawkish: { label: 'Hawkish', variant: 'hawkish' },
  slightly_hawkish: { label: 'Slightly Hawkish', variant: 'hawkish' },
  neutral: { label: 'Neutral', variant: 'neutral' },
  slightly_dovish: { label: 'Slightly Dovish', variant: 'dovish' },
  dovish: { label: 'Dovish', variant: 'dovish' },
  very_dovish: { label: 'Very Dovish', variant: 'dovish' },
};

export function BankPanel({ summary, className }: BankPanelProps) {
  const stanceInfo = stanceLabelMap[summary.stance_label] || stanceLabelMap.neutral;
  const chairLabel = summary.bank === 'FED' ? 'Chair Signal' : 'President Signal';

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-2 h-2 rounded-full',
            summary.bank === 'FED' ? 'bg-primary' : 'bg-prediction',
          )} />
          <h3 className="text-sm font-semibold">{summary.bank}</h3>
          <SignalBadge label={stanceInfo.label} variant={stanceInfo.variant} size="md" />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {new Date(summary.latest_official_date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
        </span>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Latest Official Communication</p>
        <p className="text-sm font-medium truncate">{summary.latest_official_title}</p>
      </div>

      <StanceGauge value={summary.official_stance} label="Official Stance" size="sm" />

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Guidance</p>
          <p className="text-sm font-mono font-semibold mt-0.5">{(summary.guidance_strength * 100).toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Uncertainty</p>
          <p className="text-sm font-mono font-semibold mt-0.5">{(summary.uncertainty * 100).toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{chairLabel}</p>
          <p className={cn(
            'text-sm font-mono font-semibold mt-0.5',
            summary.chair_signal > 0 ? 'text-signal-hawkish' : summary.chair_signal < 0 ? 'text-signal-dovish' : 'text-signal-neutral',
          )}>{summary.chair_signal > 0 ? '+' : ''}{summary.chair_signal.toFixed(2)}</p>
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Member Chatter</p>
        <div className="flex items-center gap-2 flex-wrap">
          <TrendChip label="Events" value={summary.recent_chatter_count} variant="default" />
          <TrendChip
            label="Divergence"
            value={summary.divergence.toFixed(2)}
            direction={summary.divergence > 0.15 ? 'up' : 'flat'}
            variant={summary.divergence > 0.15 ? 'hawkish' : 'neutral'}
          />
          <TrendChip label="7d Pressure" value={(summary.communication_pressure_7d * 100).toFixed(0) + '%'} variant="default" />
        </div>
      </div>
    </div>
  );
}
