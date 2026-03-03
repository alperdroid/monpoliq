import { cn } from '@/lib/utils';
import type { PredictionOutput, CurrencyPrediction } from '@/types/central-bank';
import type { TreasuryPrediction } from '@/lib/api/predictions';
import { ProbabilityBar } from '@/components/analytics/ProbabilityBar';
import { SignalBadge } from '@/components/analytics/SignalBadge';

interface PredictionPanelProps {
  fedPrediction: PredictionOutput;
  ecbPrediction: PredictionOutput;
  currencyPrediction: CurrencyPrediction;
  treasuryPrediction?: TreasuryPrediction;
  fedReasoning?: string;
  ecbReasoning?: string;
  eurusdReasoning?: string;
  us10yReasoning?: string;
  generatedAt?: string;
  dataSummary?: { fed_comms_count: number; ecb_comms_count: number; fed_stats_count: number; ecb_stats_count: number };
  className?: string;
}

export function PredictionPanel({
  fedPrediction, ecbPrediction, currencyPrediction, treasuryPrediction,
  fedReasoning, ecbReasoning, eurusdReasoning, us10yReasoning,
  generatedAt, dataSummary,
  className,
}: PredictionPanelProps) {
  return (
    <div className={cn('rounded-xl border border-prediction/20 bg-card p-4 space-y-5 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-prediction animate-pulse-glow" />
          <h3 className="text-sm font-semibold">AI Monetary Intelligence</h3>
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="text-[9px] text-muted-foreground font-mono">
              Generated: {new Date(generatedAt).toLocaleString()}
            </span>
          )}
          {dataSummary && (
            <span className="text-[9px] text-muted-foreground font-mono">
              ({dataSummary.fed_comms_count + dataSummary.ecb_comms_count} comms, {dataSummary.fed_stats_count + dataSummary.ecb_stats_count} stats analyzed)
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Fed */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Fed Next Decision</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge label={fedPrediction.next_decision.toUpperCase()} variant={fedPrediction.next_decision as any} size="md" />
              <span className="text-[10px] text-muted-foreground font-mono">{(fedPrediction.confidence * 100).toFixed(0)}% conf.</span>
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
          {fedReasoning && (
            <p className="text-sm text-foreground/80 mt-2 leading-relaxed font-medium">{fedReasoning}</p>
          )}
        </div>

        {/* ECB */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">ECB Next Decision</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge label={ecbPrediction.next_decision.toUpperCase()} variant={ecbPrediction.next_decision as any} size="md" />
              <span className="text-[10px] text-muted-foreground font-mono">{(ecbPrediction.confidence * 100).toFixed(0)}% conf.</span>
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
          {ecbReasoning && (
            <p className="text-sm text-foreground/80 mt-2 leading-relaxed font-medium">{ecbReasoning}</p>
          )}
        </div>

        {/* EUR/USD */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{currencyPrediction.pair}</span>
            <div className="flex items-center gap-1.5">
              <SignalBadge label={currencyPrediction.direction.toUpperCase()} variant={currencyPrediction.direction as any} size="md" />
              <span className="text-[10px] text-muted-foreground font-mono">str: {(currencyPrediction.signal_strength * 100).toFixed(0)}%</span>
            </div>
          </div>
          {eurusdReasoning && (
            <p className="text-sm text-foreground/80 mt-2 leading-relaxed font-medium">{eurusdReasoning}</p>
          )}
        </div>

        {/* US 10Y Treasury */}
        {treasuryPrediction && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{treasuryPrediction.instrument}</span>
              <div className="flex items-center gap-1.5">
                <SignalBadge
                  label={treasuryPrediction.yield_bias.toUpperCase()}
                  variant={treasuryPrediction.yield_bias === 'higher' ? 'hawkish' : treasuryPrediction.yield_bias === 'lower' ? 'dovish' : 'neutral'}
                  size="md"
                />
                <span className="text-[10px] text-muted-foreground font-mono">str: {(treasuryPrediction.signal_strength * 100).toFixed(0)}%</span>
              </div>
            </div>
            {us10yReasoning && (
              <p className="text-sm text-foreground/80 mt-2 leading-relaxed font-medium">{us10yReasoning}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
