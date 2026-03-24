import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { fetchPolicyReaction, type PolicyReactionResult, type RegimeProbs } from '@/lib/api/policy-reaction';
import {
  FlaskConical, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle, Shield, Activity, BarChart3, Brain, ChevronDown, ChevronUp, BookOpen,
} from 'lucide-react';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { useState } from 'react';

function GapIndicator({ gap }: { gap: number }) {
  const isPos = gap > 0.15;
  const isNeg = gap < -0.15;
  const color = isPos ? 'text-signal-hawkish' : isNeg ? 'text-signal-dovish' : 'text-signal-neutral';
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;
  const meaning = isPos ? 'Rate Too Low' : isNeg ? 'Rate Too High' : 'Near Fair Value';
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn('w-3.5 h-3.5', color)} />
      <span className={cn('text-sm font-mono font-bold', color)}>
        {gap > 0 ? '+' : ''}{gap.toFixed(3)}%
      </span>
      <span className="text-[10px] text-muted-foreground">({meaning})</span>
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
    Benign: CheckCircle, Neutral: Shield, Stress: AlertTriangle,
  };
  const Icon = IconMap[regime] || Shield;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', colorMap[regime] || colorMap.Neutral)}>
      <Icon className="w-3 h-3" />{regime}
    </span>
  );
}

function RegimeProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(value * 100, 100)}%` }} />
      </div>
    </div>
  );
}

function RegimePanel({ probs }: { probs: RegimeProbs }) {
  return (
    <div className="rounded-lg bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Brain className="w-3 h-3 text-prediction" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Next-Month Regime Probabilities</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <RegimeProbBar label="Restrictive" value={probs.restrictive} color="bg-signal-hawkish" />
        <RegimeProbBar label="Expansionary" value={probs.expansionary} color="bg-signal-dovish" />
        <RegimeProbBar label="ZLB/Neg Rate" value={probs.zlb} color="bg-primary" />
        <RegimeProbBar label="GFC-Like" value={probs.gfc} color="bg-destructive" />
        <RegimeProbBar label="Pandemic-Like" value={probs.pandemic} color="bg-amber-500" />
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground">Env Bias:</span>
          <span className={cn('text-xs font-mono font-bold', probs.env_bias > 0.1 ? 'text-signal-hawkish' : probs.env_bias < -0.1 ? 'text-signal-dovish' : 'text-signal-neutral')}>
            {probs.env_bias > 0 ? '+' : ''}{probs.env_bias.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}

function OOSCard({ metrics }: { metrics: PolicyReactionResult['oos_metrics'] }) {
  return (
    <div className="rounded-lg bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="w-3 h-3 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Out-of-Sample Performance</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="RMSE" value={metrics.rmse.toFixed(4)} />
        <MetricCard label="R² vs Naïve" value={metrics.r2_vs_naive.toFixed(4)} variant="primary" />
        <MetricCard label="R² Level" value={metrics.r2_level.toFixed(4)} />
      </div>
      <p className="text-[8px] text-muted-foreground text-right">{metrics.n_oos} expanding-window forecasts</p>
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

function ContributionsSection({ contributions }: { contributions: Record<string, number> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(contributions).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const shown = expanded ? entries : entries.slice(0, 5);

  return (
    <div className="space-y-2">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-medium hover:text-foreground transition-colors">
        <Activity className="w-3 h-3" />
        Variable Contributions ({entries.length})
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {shown.map(([name, val]) => (
        <div key={name} className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground font-mono truncate max-w-[60%]">{name}</span>
          <span className={cn('font-mono font-semibold', val > 0 ? 'text-signal-hawkish' : val < 0 ? 'text-signal-dovish' : 'text-foreground')}>
            {val > 0 ? '+' : ''}{val.toFixed(4)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BankReactionCard({ data }: { data: PolicyReactionResult }) {
  const isFed = data.bank === 'FED';
  const bankColor = isFed ? 'text-primary' : 'text-prediction';
  const bankBorder = isFed ? 'border-primary/20' : 'border-prediction/20';

  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-4 shadow-sm', bankBorder)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', isFed ? 'bg-primary' : 'bg-prediction')} />
          <span className={cn('text-sm font-bold', bankColor)}>
            {isFed ? 'Federal Reserve' : 'European Central Bank'}
          </span>
        </div>
        <RegimeBadge regime={data.regime} />
      </div>

      {/* Key Rates */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Actual Rate" value={`${data.actual_rate.toFixed(2)}%`} sublabel={data.sample_end} />
        <MetricCard label="Model-Implied" value={`${data.implied_rate.toFixed(3)}%`} sublabel={`R² = ${data.r2_insample.toFixed(4)}`} variant="primary" />
        <div className="rounded-lg border bg-card p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground mb-1">Policy Gap</p>
          <GapIndicator gap={data.gap} />
        </div>
      </div>

      {/* Model Info */}
      <div className="rounded-lg bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground font-medium">{data.model_name}</span>
          <span className="text-[9px] text-muted-foreground">{data.n_features} features</span>
        </div>
      </div>

      {/* OOS Performance */}
      <OOSCard metrics={data.oos_metrics} />

      {/* Regime Probabilities */}
      {data.regime_probabilities && <RegimePanel probs={data.regime_probabilities} />}

      {/* Current Variables */}
      <div className="space-y-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Current Macro & Financial Inputs</span>
        <div className="grid grid-cols-4 gap-2">
          <VarCell label="Inflation Gap" value={data.variables.inflation_gap ?? null} suffix="pp" />
          <VarCell label="Unemp. Gap" value={data.variables.unemployment_gap ?? null} suffix="pp" />
          <VarCell label="2Y Yield" value={data.variables.y2y ?? null} suffix="%" />
          <VarCell label="Yield Slope" value={data.variables.slope ?? null} suffix="pp" />
          <VarCell label="Oil Δ" value={data.variables.oil_log_change ?? null} />
          <VarCell label="Credit Spread" value={data.variables.credit_spread ?? null} suffix="pp" />
          <VarCell label="VIX" value={data.variables.vix ?? null} />
          <VarCell label="FCI" value={data.variables.fci ?? null} />
        </div>
      </div>

      {/* Coefficients */}
      <ContributionsSection contributions={data.contributions || {}} />

      {/* Footer */}
      <div className="flex items-center justify-between text-[9px] text-muted-foreground">
        <span>Sample: {data.sample_start} → {data.sample_end} ({data.sample_size} obs.)</span>
        <span>Stress: {data.stress_score.toFixed(3)}</span>
      </div>
    </div>
  );
}

const REFERENCES = [
  {
    authors: 'González-Astudillo, M., & Tanvir, R.',
    year: '2023',
    title: 'Hawkish or Dovish Fed? Estimating a Time-Varying Reaction Function of the FOMC\'s Median Participant',
    source: 'FEDS',
    role: 'Core reaction-function backbone',
    why: 'Main basis for the macro core. Estimates a time-varying Fed reaction function using SEP inflation and unemployment projections, showing the rule becomes more persistent and coefficients are state-dependent.',
  },
  {
    authors: 'Cour-Thimann, P., & Jung, A.',
    year: '2020',
    title: 'Interest Rate Setting and Communication at the ECB',
    source: 'ECB Working Paper No. 2443',
    role: 'ECB oil & yield-curve evidence',
    why: 'Justifies allowing oil and yield-curve information into the policy reaction function. Shows that adding risk-assessment variables improves modeling of policy decisions.',
  },
  {
    authors: 'Piazzesi, M.',
    year: '2001',
    title: 'An Econometric Model of the Yield Curve with Macroeconomic Jump Effects',
    source: 'NBER Working Paper 8246',
    role: 'Yield-curve information channel',
    why: 'Foundational reference for the idea that the Fed reacts to information in the yield curve. Conceptual basis for including the 2-year yield signal.',
  },
  {
    authors: 'Kiley, M. T.',
    year: '2024',
    title: 'Why Have Long-term Treasury Yields Fallen Since the 1980s? Expected Short Rates and Term Premiums in (Quasi-) Real Time',
    source: 'FEDS',
    role: 'Term premium decomposition',
    why: 'Supports decomposing long yields into expected short rates and term premium. Motivated separate treatment of the 2-year yield and 10-year term premium.',
  },
  {
    authors: 'Filardo, A. J., Hubert, P., & Rungcharoenkitkul, P.',
    year: '2019',
    title: 'The Reaction Function Channel of Monetary Policy and the Financial Cycle',
    source: 'BIS Working Paper No. 816',
    role: 'Financial reaction-function channel',
    why: 'Main support for central banks responding to equity, housing, and credit-market imbalances. Best modern reference for adding a financial-market adjustment block.',
  },
  {
    authors: 'Board of Governors / FRED',
    year: '',
    title: 'Term Premium on a 10 Year Zero Coupon Bond (THREEFYTP10)',
    source: 'FRED Series',
    role: 'Published term premium series',
    why: 'Provides a directly usable 10-year term premium series, replacing rough term-spread proxies with a cleaner measure.',
  },
];

function AcademicReferences() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left hover:text-foreground transition-colors"
      >
        <BookOpen className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium flex-1">
          Methodology & Referenced Studies
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {!expanded && (
        <p className="text-[9px] text-muted-foreground italic">
          SEP-based time-varying Taylor-rule core (González-Astudillo & Tanvir, 2023) with ECB oil/yield-curve evidence, Piazzesi's yield-curve-information view, BIS financial reaction-function channel, and FRED 10Y term premium.
        </p>
      )}

      {expanded && (
        <div className="space-y-3 pt-1">
          <p className="text-[9px] text-muted-foreground">
            The formula combines a SEP-based time-varying Taylor-rule core, motivated by González-Astudillo and Tanvir (2023), with ECB evidence that oil and yield-curve variables can enter reaction functions, Piazzesi's yield-curve-information view of Fed behavior, BIS evidence on a financial reaction-function channel, and a separate FRED-based 10-year term-premium measure to avoid double-counting expectations.
          </p>
          <div className="space-y-2">
            {REFERENCES.map((ref, idx) => (
              <div key={idx} className="rounded-lg bg-muted/20 p-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-foreground leading-tight">
                      {ref.authors} {ref.year && `(${ref.year})`}
                    </p>
                    <p className="text-[9px] text-muted-foreground italic leading-tight mt-0.5">
                      "{ref.title}" — {ref.source}
                    </p>
                  </div>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium whitespace-nowrap shrink-0">
                    {ref.role}
                  </span>
                </div>
                <p className="text-[8px] text-muted-foreground leading-relaxed">{ref.why}</p>
              </div>
            ))}
          </div>
        </div>
      )}
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
        <h2 className="text-lg font-bold">Empirical Policy Corner</h2>
        <TooltipInfo content="Regime-aware econometric models estimate implied policy rates. Fed: 18-feature AutoRegime ElasticNet-Ridge with regime probability interactions. ECB: 14-feature p-value pruned structural break OLS with GFC, sovereign crisis, and negative-rate era interactions. Both evaluated via expanding-window one-step-ahead OOS forecasts." />
      </div>
      <p className="text-[10px] text-muted-foreground -mt-2">
        Fed: AutoRegime ElasticNet-Ridge (lags, VIX², regime probs) · ECB: Structural break OLS (p≤0.10 pruned, GFC/sov crisis/neg-rate interactions) · Real FRED + market data
      </p>

      {isLoading && (
        <div className="grid lg:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
              <Skeleton className="h-5 w-1/3" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
              </div>
              <Skeleton className="h-24" />
              <Skeleton className="h-20" />
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
          <AcademicReferences />
        </>
      )}
    </div>
  );
}
