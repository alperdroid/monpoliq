import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { Button } from '@/components/ui/button';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { toast } from 'sonner';

interface PivotData {
  fed: {
    pivot_probability: number;
    direction: string;
    confidence: number;
    top_drivers: string[];
    summary: string;
    features: {
      avg30: number;
      driftSlope: number;
      dispersion: number;
      guidanceSofteningRate: number;
      uncertaintyRate: number;
      commsCount: number;
    };
  };
  ecb: {
    pivot_probability: number;
    direction: string;
    confidence: number;
    top_drivers: string[];
    summary: string;
    features: {
      avg30: number;
      driftSlope: number;
      dispersion: number;
      guidanceSofteningRate: number;
      uncertaintyRate: number;
      commsCount: number;
    };
  };
  generated_at: string;
}

async function fetchPivotProbability(): Promise<PivotData> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/pivot-probability`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Rate limited — try again later');
    throw new Error(`Failed: ${resp.status}`);
  }
  return resp.json();
}

export function PivotProbabilityPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['pivot-probability'],
    queryFn: fetchPivotProbability,
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

  const BankPivot = ({ bank, d }: { bank: string; d: PivotData['fed'] }) => {
    const pct = Math.round(d.pivot_probability * 100);
    const DirectionIcon = d.direction === 'hawkish_shift' ? TrendingUp : d.direction === 'dovish_shift' ? TrendingDown : Minus;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider">{bank}</span>
          <SignalBadge
            label={d.direction.replace('_', ' ')}
            variant={d.direction === 'hawkish_shift' ? 'hawkish' : d.direction === 'dovish_shift' ? 'dovish' : 'neutral'}
            size="md"
          />
        </div>

        {/* Big pivot number */}
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'text-4xl font-mono font-bold',
            pct > 40 ? 'text-destructive' : pct > 20 ? 'text-signal-hawkish' : 'text-data-positive',
          )}>
            {pct}%
          </span>
          <span className="text-xs text-muted-foreground">pivot risk</span>
          <DirectionIcon className={cn(
            'w-4 h-4 ml-auto',
            d.direction === 'hawkish_shift' ? 'text-signal-hawkish' : d.direction === 'dovish_shift' ? 'text-signal-dovish' : 'text-muted-foreground',
          )} />
        </div>

        {/* Confidence bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Confidence</span>
            <span className="font-mono">{Math.round(d.confidence * 100)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${d.confidence * 100}%` }} />
          </div>
        </div>

        {/* Top drivers */}
        <div className="space-y-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Top Drivers</span>
          {d.top_drivers.map((driver, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className="text-primary font-mono">{i + 1}.</span>
              <span className="text-foreground">{driver}</span>
            </div>
          ))}
        </div>

        {/* Feature indicators */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
          <div className="text-center">
            <span className="text-[9px] text-muted-foreground block">Drift</span>
            <span className={cn('text-xs font-mono font-semibold',
              d.features.driftSlope > 0.05 ? 'text-signal-hawkish' : d.features.driftSlope < -0.05 ? 'text-signal-dovish' : 'text-foreground',
            )}>
              {d.features.driftSlope > 0 ? '+' : ''}{d.features.driftSlope.toFixed(3)}
            </span>
          </div>
          <div className="text-center">
            <span className="text-[9px] text-muted-foreground block">Dispersion</span>
            <span className="text-xs font-mono font-semibold">{d.features.dispersion.toFixed(3)}</span>
          </div>
          <div className="text-center">
            <span className="text-[9px] text-muted-foreground block">Uncertainty</span>
            <span className="text-xs font-mono font-semibold">{Math.round(d.features.uncertaintyRate * 100)}%</span>
          </div>
        </div>

        {/* Summary */}
        <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2">{d.summary}</p>
      </div>
    );
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-card p-4 text-center space-y-2">
        <AlertTriangle className="w-5 h-5 text-destructive mx-auto" />
        <p className="text-xs text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Pivot Probability</span>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && (
            <span className="text-[9px] text-muted-foreground font-mono">
              {new Date(data.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { refetch(); toast.info('Recalculating pivot probability…'); }} disabled={isFetching}>
            <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="space-y-3 animate-pulse">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-12 w-24 bg-muted rounded" />
              <div className="h-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 divide-x divide-border">
          <BankPivot bank="FED" d={data.fed} />
          <div className="pl-6">
            <BankPivot bank="ECB" d={data.ecb} />
          </div>
        </div>
      )}
    </div>
  );
}
