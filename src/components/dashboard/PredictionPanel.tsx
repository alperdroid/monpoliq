import { cn } from '@/lib/utils';
import type { PredictionOutput, CurrencyPrediction } from '@/types/central-bank';
import { ProbabilityBar } from '@/components/analytics/ProbabilityBar';
import { SignalBadge } from '@/components/analytics/SignalBadge';

interface PredictionPanelProps {
  fedPrediction: PredictionOutput;
  ecbPrediction: PredictionOutput;
  currencyPrediction: CurrencyPrediction;
  className?: string;
}

export function PredictionPanel({ fedPrediction, ecbPrediction, currencyPrediction, className }: PredictionPanelProps) {
  return (
    <div className={cn('rounded-lg border border-prediction/30 bg-card p-4 space-y-5', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-prediction animate-pulse-glow" />
          <h3 className="text-sm font-semibold">Model View</h3>
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Communication-Implied Outlook</span>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Fed Next Decision</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge
                label={fedPrediction.next_decision.toUpperCase()}
                variant={fedPrediction.next_decision as any}
                size="md"
              />
              <span className="text-[10px] text-muted-foreground font-mono">
                {(fedPrediction.confidence * 100).toFixed(0)}% conf.
              </span>
            </div>
          </div>
          <ProbabilityBar
            label=""
            probabilities={[
              { label: 'Hike', value: fedPrediction.hike_probability, color: 'hawkish' },
              { label: 'Hold', value: fedPrediction.hold_probability, color: 'neutral' },
              { label: 'Cut', value: fedPrediction.cut_probability, color: 'dovish' },
            ]}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">ECB Next Decision</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge
                label={ecbPrediction.next_decision.toUpperCase()}
                variant={ecbPrediction.next_decision as any}
                size="md"
              />
              <span className="text-[10px] text-muted-foreground font-mono">
                {(ecbPrediction.confidence * 100).toFixed(0)}% conf.
              </span>
            </div>
          </div>
          <ProbabilityBar
            label=""
            probabilities={[
              { label: 'Hike', value: ecbPrediction.hike_probability, color: 'hawkish' },
              { label: 'Hold', value: ecbPrediction.hold_probability, color: 'neutral' },
              { label: 'Cut', value: ecbPrediction.cut_probability, color: 'dovish' },
            ]}
          />
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{currencyPrediction.pair}</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge
                label={currencyPrediction.direction.toUpperCase()}
                variant={currencyPrediction.direction as any}
                size="md"
              />
              <span className="text-[10px] text-muted-foreground font-mono">
                str: {(currencyPrediction.signal_strength * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
