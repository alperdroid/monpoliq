import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { MetricCard } from '@/components/analytics/MetricCard';
import { BankPanel } from '@/components/dashboard/BankPanel';
import { PredictionPanel } from '@/components/dashboard/PredictionPanel';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCachedSentimentItems,
  type SentimentItem,
} from '@/lib/api/sentiment';
import {
  fetchAIPredictions, toPredictionOutput, toCurrencyPrediction, toTreasuryPrediction,
  type AIPredictionResponse,
} from '@/lib/api/predictions';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceLine,
} from 'recharts';
import { TrendingUp, Brain, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CIEWidget } from '@/components/dashboard/CIEWidget';

/** Filter items to last N days */
function recentItems(items: SentimentItem[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cs = cutoff.toISOString().split('T')[0];
  return items.filter(i => i.item_date >= cs);
}

/** Compute 30-day average excluding neutral zero-score items */
function compute30dAvg(items: SentimentItem[]) {
  const scored = items.filter(i => Math.abs(i.net_score) > 0.001);
  if (!scored.length) return null;
  return Math.round(scored.reduce((s, i) => s + i.net_score, 0) / scored.length * 1000) / 1000;
}

/** Group items by month for chart data */
function monthlyAverages(items: SentimentItem[], bank?: string) {
  const filtered = (bank ? items.filter(i => i.bank === bank) : items).filter(i => Math.abs(i.net_score) > 0.001);
  const byMonth: Record<string, { sum: number; count: number }> = {};
  for (const it of filtered) {
    const month = it.item_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { sum: 0, count: 0 };
    byMonth[month].sum += it.net_score;
    byMonth[month].count++;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { sum, count }]) => ({
      month,
      avg: Math.round((sum / count) * 1000) / 1000,
      count,
    }));
}

/** Monthly volume chart data */
function monthlyVolume(items: SentimentItem[]) {
  const byMonth: Record<string, number> = {};
  for (const it of items) {
    const month = it.item_date.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

const Dashboard = () => {
  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  // AI Predictions
  const { data: aiPrediction, isLoading: isPredictionLoading } = useQuery({
    queryKey: ['ai-predictions'],
    queryFn: fetchAIPredictions,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  // 30-day ALL items for aggregate score (comms + stats) — HIGHLIGHTED
  const recent30 = recentItems(allItems, 30);
  const recent7 = recentItems(allItems, 7);

  const fed30All = recent30.filter(i => i.bank === 'FED');
  const ecb30All = recent30.filter(i => i.bank === 'ECB');
  const fed30Comms = fed30All.filter(i => !i.is_statistical);
  const ecb30Comms = ecb30All.filter(i => !i.is_statistical);
  const fed30Stats = fed30All.filter(i => i.is_statistical);
  const ecb30Stats = ecb30All.filter(i => i.is_statistical);
  const fed7 = recent7.filter(i => i.bank === 'FED');
  const ecb7 = recent7.filter(i => i.bank === 'ECB');

  // Aggregate 30-day scores (comms + stats combined)
  const fed30AggAvg = compute30dAvg(fed30All);
  const ecb30AggAvg = compute30dAvg(ecb30All);

  // Separate 30-day scores
  const fed30CommAvg = compute30dAvg(fed30Comms);
  const ecb30CommAvg = compute30dAvg(ecb30Comms);
  const fed30StatAvg = compute30dAvg(fed30Stats);
  const ecb30StatAvg = compute30dAvg(ecb30Stats);

  // 1-year monthly fluctuation data
  const fedMonthly = monthlyAverages(allItems, 'FED');
  const ecbMonthly = monthlyAverages(allItems, 'ECB');
  const allMonths = [...new Set([...fedMonthly.map(m => m.month), ...ecbMonthly.map(m => m.month)])].sort();
  const fluctuationData = allMonths.map(month => ({
    month,
    fed: fedMonthly.find(m => m.month === month)?.avg ?? null,
    ecb: ecbMonthly.find(m => m.month === month)?.avg ?? null,
  }));

  // Communication volume chart
  const volumeData = monthlyVolume(allItems);

  // Latest items for bank panels
  const fedItems = allItems.filter(i => i.bank === 'FED');
  const ecbItems = allItems.filter(i => i.bank === 'ECB');
  const latestFed = fedItems[0];
  const latestEcb = ecbItems[0];

  // Regime
  const regime = fed30AggAvg !== null && ecb30AggAvg !== null
    ? (fed30AggAvg > 0.1 && ecb30AggAvg < -0.1 ? 'Divergent'
      : fed30AggAvg > 0.1 && ecb30AggAvg > 0.1 ? 'Both Hawkish'
      : fed30AggAvg < -0.1 && ecb30AggAvg < -0.1 ? 'Both Dovish'
      : 'Converging')
    : '—';

  // Derive prediction display values
  const fedPred = aiPrediction ? toPredictionOutput(aiPrediction.fed, 'FED') : null;
  const ecbPred = aiPrediction ? toPredictionOutput(aiPrediction.ecb, 'ECB') : null;
  const eurusdPred = aiPrediction ? toCurrencyPrediction(aiPrediction.eurusd) : null;
  const us10yPred = aiPrediction?.us10y ? toTreasuryPrediction(aiPrediction.us10y) : undefined;

  const stanceLabel = (v: number | null) =>
    v === null ? '—' : v > 0.3 ? 'Hawkish' : v > 0.1 ? 'Sl. Hawkish' : v < -0.3 ? 'Dovish' : v < -0.1 ? 'Sl. Dovish' : 'Neutral';

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Executive Summary Bar */}
      <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Executive Summary</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">30-Day Aggregate Signal</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard
            label="Fed Aggregate"
            value={fed30AggAvg !== null ? (fed30AggAvg > 0 ? '+' : '') + fed30AggAvg.toFixed(3) : '—'}
            sublabel={stanceLabel(fed30AggAvg)}
            variant="primary"
          />
          <MetricCard
            label="ECB Aggregate"
            value={ecb30AggAvg !== null ? (ecb30AggAvg > 0 ? '+' : '') + ecb30AggAvg.toFixed(3) : '—'}
            sublabel={stanceLabel(ecb30AggAvg)}
            variant="primary"
          />
          <MetricCard label="Regime" value={regime} sublabel="FED vs ECB" />
          {isPredictionLoading ? (
            <>
              <div className="space-y-2 p-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-3 w-2/3" /></div>
              <div className="space-y-2 p-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-3 w-2/3" /></div>
              <div className="space-y-2 p-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-3 w-2/3" /></div>
            </>
          ) : fedPred && ecbPred && eurusdPred ? (
            <>
              <MetricCard label="Fed Next" value={fedPred.next_decision.toUpperCase()} sublabel={`${(fedPred.hold_probability * 100).toFixed(0)}% hold`} variant="prediction" />
              <MetricCard label="ECB Next" value={ecbPred.next_decision.toUpperCase()} sublabel={`${(ecbPred.cut_probability * 100).toFixed(0)}% cut`} variant="prediction" />
              <MetricCard label="EUR/USD" value={eurusdPred.direction.toUpperCase()} sublabel={`${(eurusdPred.signal_strength * 100).toFixed(0)}% signal`} variant="prediction" />
            </>
          ) : (
            <>
              <MetricCard label="Fed Next" value="—" sublabel="Loading..." variant="prediction" />
              <MetricCard label="ECB Next" value="—" sublabel="Loading..." variant="prediction" />
              <MetricCard label="EUR/USD" value="—" sublabel="Loading..." variant="prediction" />
            </>
          )}
          <MetricCard label="Comm. Volume" value={String(recent30.length)} sublabel="30d events" trend={recent7.length > 5 ? 'up' : 'flat'} trendValue={`${recent7.length} this week`} />
        </div>
      </div>

      {/* HIGHLIGHTED: 30-Day Aggregate Scores (Comms + Stats) */}
      <div className="rounded-xl border border-primary/20 bg-card p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span className="text-xs font-bold uppercase tracking-widest text-primary">30-Day Aggregate Score (Communications + Statistical Data)</span>
          </div>
          <div className="flex gap-2">
            <Link to="/comms" className="text-[10px] text-primary hover:underline">Comms →</Link>
            <Link to="/stats" className="text-[10px] text-primary hover:underline">Stats →</Link>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">FED Aggregate</span>
            <p className={cn('text-2xl font-mono font-bold',
              fed30AggAvg !== null && fed30AggAvg > 0.05 ? 'text-signal-hawkish' : fed30AggAvg !== null && fed30AggAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {fed30AggAvg !== null ? (fed30AggAvg > 0 ? '+' : '') + fed30AggAvg.toFixed(3) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">{fed30Comms.length} comms + {fed30Stats.length} stats</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">FED Comms Only</span>
            <p className={cn('text-lg font-mono font-semibold',
              fed30CommAvg !== null && fed30CommAvg > 0.05 ? 'text-signal-hawkish' : fed30CommAvg !== null && fed30CommAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {fed30CommAvg !== null ? (fed30CommAvg > 0 ? '+' : '') + fed30CommAvg.toFixed(3) : '—'}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">ECB Aggregate</span>
            <p className={cn('text-2xl font-mono font-bold',
              ecb30AggAvg !== null && ecb30AggAvg > 0.05 ? 'text-signal-hawkish' : ecb30AggAvg !== null && ecb30AggAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {ecb30AggAvg !== null ? (ecb30AggAvg > 0 ? '+' : '') + ecb30AggAvg.toFixed(3) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">{ecb30Comms.length} comms + {ecb30Stats.length} stats</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">ECB Comms Only</span>
            <p className={cn('text-lg font-mono font-semibold',
              ecb30CommAvg !== null && ecb30CommAvg > 0.05 ? 'text-signal-hawkish' : ecb30CommAvg !== null && ecb30CommAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {ecb30CommAvg !== null ? (ecb30CommAvg > 0 ? '+' : '') + ecb30CommAvg.toFixed(3) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* 1-Year Sentiment Fluctuation Chart */}
      {fluctuationData.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Sentiment Fluctuation (Monthly Avg)</h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={fluctuationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
              <Area type="monotone" dataKey="fed" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="FED" connectNulls />
              <Area type="monotone" dataKey="ecb" stroke="hsl(var(--prediction))" fill="hsl(var(--prediction) / 0.15)" strokeWidth={2} name="ECB" connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bank Panels */}
      <div className="grid lg:grid-cols-2 gap-4">
        <BankPanel
          bank="FED"
          score30d={fed30AggAvg ?? 0}
          commCount30d={fed30Comms.length}
          statCount30d={fed30Stats.length}
          totalItems={fedItems.length}
          latestTitle={latestFed?.title || ''}
          latestDate={latestFed?.item_date || ''}
          commCount7d={fed7.length}
        />
        <BankPanel
          bank="ECB"
          score30d={ecb30AggAvg ?? 0}
          commCount30d={ecb30Comms.length}
          statCount30d={ecb30Stats.length}
          totalItems={ecbItems.length}
          latestTitle={latestEcb?.title || ''}
          latestDate={latestEcb?.item_date || ''}
          commCount7d={ecb7.length}
        />
      </div>

      {/* AI Prediction Section */}
      {isPredictionLoading ? (
        <div className="rounded-xl border border-prediction/20 bg-card p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-prediction animate-pulse" />
            <span className="text-sm font-semibold">AI Monetary Intelligence</span>
            <span className="text-[10px] text-muted-foreground ml-2">Analyzing sentiment data...</span>
          </div>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : fedPred && ecbPred && eurusdPred ? (
        <PredictionPanel
          fedPrediction={fedPred}
          ecbPrediction={ecbPred}
          currencyPrediction={eurusdPred}
          treasuryPrediction={us10yPred}
          fedReasoning={aiPrediction?.fed.reasoning}
          ecbReasoning={aiPrediction?.ecb.reasoning}
          eurusdReasoning={aiPrediction?.eurusd.reasoning}
          us10yReasoning={aiPrediction?.us10y?.reasoning}
          generatedAt={aiPrediction?.generated_at}
          dataSummary={aiPrediction?.data_summary}
        />
      ) : (
        <div className="rounded-xl border border-destructive/20 bg-card p-4 text-center shadow-sm">
          <p className="text-xs text-muted-foreground">AI predictions unavailable — refresh to retry</p>
        </div>
      )}

      {/* Communication Volume Chart */}
      {volumeData.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Communication Volume</h3>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Events" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
