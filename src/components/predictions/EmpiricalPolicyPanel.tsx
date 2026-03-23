import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { fetchPolicyReaction, type PolicyReactionResult } from '@/lib/api/policy-reaction';
import { FlaskConical, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Shield } from 'lucide-react';
import { TooltipInfo } from '@/components/ui/tooltip-info';

function GapIndicator({ gap, label }: { gap: number; label: string }) {
  const isPositive = gap > 0.1;
  const isNegative = gap < -0.1;
  const color = isPositive ? 'text-signal-hawkish' : isNegative ? 'text-signal-dovish' : 'text-signal-neutral';
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const meaning = isPositive ? 'Rate Too Low' : isNegative ? 'Rate Too High' : 'Near Fair Value';

  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn('w-3.5 h-3.5', color)} />
      <span className={cn('text-xs font-mono font-semibold', color)}>
        {gap > 0 ? '+' : ''}{gap.toFixed(3)}
      </span>
      <span className="text-[9px] text-muted-foreground">({meaning})</span>
    </div>
  );
}

function RegimeBadge({ regime }: { regime: string }) {
  const colorMap: Record<string, string> = {
    Benign: 'bg-data-positive/15 text-data-positive border-data-positive/30',
    Neutral: 'bg-signal-neutral/15 text-signal-neutral border-signal-neutral/30',
    Stress: 'bg-destructive/15 text-destructive border-destructive/30',
  };
  const IconMap: Record<string, typeof CheckCircle> = {
    Benign: CheckCircle,
    Neutral: Shield,
    Stress: AlertTriangle,
  };
  const Icon = IconMap[regime] || Shield;

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', colorMap[regime] || colorMap.Neutral)}>
      <Icon className="w-3 h-3" />
      {regime}
    </span>
  );
}

function BankReactionCard({ data }: { data: PolicyReactionResult }) {
  const bankColor = data.bank === 'FED' ? 'text-primary' : 'text-prediction';
  const bankBorder = data.bank === 'FED' ? 'border-primary/20' : 'border-prediction/20';

  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-4 shadow-sm', bankBorder)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', data.bank === 'FED' ? 'bg-primary' : 'bg-prediction')} />
          <span className={cn('text-sm font-bold', bankColor)}>
            {data.bank === 'FED' ? 'Federal Reserve' : 'European Central Bank'}
          </span>
        </div>
        <RegimeBadge regime={data.regime} />
      </div>

      {/* Key Rates */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Actual Rate"
          value={`${data.actual_rate.toFixed(2)}%`}
          sublabel={data.latest_month}
        />
        <MetricCard
          label="Implied (Macro)"
          value={`${data.implied_rate_macro.toFixed(3)}%`}
          sublabel={`R² = ${data.r2_macro.toFixed(4)}`}
          variant="primary"
        />
        <MetricCard
          label="Implied (Combined)"
          value={`${data.implied_rate_combined.toFixed(3)}%`}
          sublabel={`R² = ${data.r2_combined.toFixed(4)}`}
          variant="prediction"
        />
      </div>

      {/* Gap Analysis */}
      <div className="rounded-lg bg-muted/30 p-3 space-y-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Policy Gap (Implied − Actual)</span>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[9px] text-muted-foreground mb-0.5">Macro Model</p>
            <GapIndicator gap={data.gap_macro} label="Macro" />
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground mb-0.5">Combined Model</p>
            <GapIndicator gap={data.gap_combined} label="Combined" />
          </div>
        </div>
      </div>

      {/* Current Variables */}
      <div className="space-y-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Current Macro & Financial Inputs</span>
        <div className="grid grid-cols-4 gap-2">
          <VarCell label="Inflation Gap" value={data.variables.inflation_gap} suffix="pp" />
          <VarCell label="Unemp. Gap" value={data.variables.unemployment_gap} suffix="pp" />
          <VarCell label="2Y Yield" value={data.variables.y2y} suffix="%" />
          <VarCell label="Yield Slope" value={data.variables.slope} suffix="pp" />
          <VarCell label="Oil Δ" value={data.variables.oil_log_change} />
          <VarCell label="Credit Spread" value={data.variables.credit_spread} suffix="pp" />
          <VarCell label="VIX" value={data.variables.vix} />
          <VarCell label="FCI" value={data.variables.fci} />
        </div>
      </div>

      {/* Model Info */}
      <div className="flex items-center justify-between text-[9px] text-muted-foreground">
        <span>Sample: {data.sample_start} → {data.sample_end} ({data.sample_size} obs.)</span>
        <span>Stress: {data.stress_score.toFixed(3)}</span>
      </div>
    </div>
  );
}

function VarCell({ label, value, suffix = '' }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded bg-muted/20 px-2 py-1.5">
      <p className="text-[8px] text-muted-foreground truncate">{label}</p>
      <p className="text-xs font-mono font-semibold">
        {value != null ? `${value > 0 ? '+' : ''}${value}${suffix}` : '—'}
      </p>
    </div>
  );
}

export function EmpiricalPolicyPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['policy-reaction'],
    queryFn: fetchPolicyReaction,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-widest">Empirical Policy Corner</h2>
        <TooltipInfo content="Econometric policy reaction models estimate the implied policy rate using the two-step residual Taylor Rule. Positive gap = rate below model-implied level (hawkish pressure). Based on real FRED macro + financial data." />
      </div>
      <p className="text-[10px] text-muted-foreground -mt-2">
        Two-Step Residual Taylor Rule — Macro fundamentals + orthogonalized financial signals (OLS estimation, monthly data since 2000)
      </p>

      {isLoading && (
        <div className="grid lg:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
              <Skeleton className="h-5 w-1/3" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
              <Skeleton className="h-20" />
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-destructive/20 bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Empirical policy data unavailable — refresh to retry</p>
        </div>
      )}

      {data && (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <BankReactionCard data={data.fed} />
            <BankReactionCard data={data.ecb} />
          </div>
          <p className="text-[9px] text-muted-foreground text-right">
            Generated: {new Date(data.generated_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
