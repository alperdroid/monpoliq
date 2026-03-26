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
import { TrendingUp, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CIEWidget } from '@/components/dashboard/CIEWidget';
import { StanceDecomposition } from '@/components/analytics/StanceDecomposition';
import { CrossBankSpread } from '@/components/analytics/CrossBankSpread';
import { SurpriseIndex } from '@/components/analytics/SurpriseIndex';
import { ChangePointSection } from '@/components/analytics/ChangePointTimeline';

/** Filter items to last N days */
function recentItems(items: SentimentItem[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cs = cutoff.toISOString().split('T')[0];
  return items.filter(i => i.item_date >= cs);
}

/** Compute average excluding neutral zero-score items */
function computeAvg(items: SentimentItem[]) {
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

  // Use 45-day window for comms, 60-day for stats (matching dedicated pages)
  const recentComms45 = recentItems(allItems.filter(i => !i.is_statistical), 45);
  const recentStats60 = recentItems(allItems.filter(i => i.is_statistical), 60);
  const recent7 = recentItems(allItems, 7);

  const fed45Comms = recentComms45.filter(i => i.bank === 'FED');
  const ecb45Comms = recentComms45.filter(i => i.bank === 'ECB');
  const fed60Stats = recentStats60.filter(i => i.bank === 'FED');
  const ecb60Stats = recentStats60.filter(i => i.bank === 'ECB');
  const fed7 = recent7.filter(i => i.bank === 'FED');
  const ecb7 = recent7.filter(i => i.bank === 'ECB');

  // Aggregate scores (comms 45d + stats 60d combined)
  const fedAggAll = [...fed45Comms, ...fed60Stats];
  const ecbAggAll = [...ecb45Comms, ...ecb60Stats];
  const fedAggAvg = computeAvg(fedAggAll);
  const ecbAggAvg = computeAvg(ecbAggAll);

  // Separate scores
  const fedCommAvg = computeAvg(fed45Comms);
  const ecbCommAvg = computeAvg(ecb45Comms);
  const fedStatAvg = computeAvg(fed60Stats);
  const ecbStatAvg = computeAvg(ecb60Stats);

  // 1.5-year monthly fluctuation data
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const eighteenMonthsCutoff = eighteenMonthsAgo.toISOString().split('T')[0].slice(0, 7);
  const recentItems18m = allItems.filter(i => i.item_date.slice(0, 7) >= eighteenMonthsCutoff);
  const fedMonthly = monthlyAverages(recentItems18m, 'FED');
  const ecbMonthly = monthlyAverages(recentItems18m, 'ECB');
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
  const regime = fedAggAvg !== null && ecbAggAvg !== null
    ? (fedAggAvg > 0.1 && ecbAggAvg < -0.1 ? 'Divergent'
      : fedAggAvg > 0.1 && ecbAggAvg > 0.1 ? 'Both Hawkish'
      : fedAggAvg < -0.1 && ecbAggAvg < -0.1 ? 'Both Dovish'
      : 'Converging')
    : '—';

  // Derive prediction display values
  const fedPred = aiPrediction ? toPredictionOutput(aiPrediction.fed, 'FED') : null;
  const ecbPred = aiPrediction ? toPredictionOutput(aiPrediction.ecb, 'ECB') : null;
  const eurusdPred = aiPrediction ? toCurrencyPrediction(aiPrediction.eurusd) : null;
  const us10yPred = aiPrediction?.us10y ? toTreasuryPrediction(aiPrediction.us10y) : undefined;

  const stanceLabel = (v: number | null) =>
    v === null ? '—' : v > 0.3 ? 'Hawkish' : v > 0.1 ? 'Sl. Hawkish' : v < -0.3 ? 'Dovish' : v < -0.1 ? 'Sl. Dovish' : 'Neutral';

  const totalRecentItems = fedAggAll.length + ecbAggAll.length;

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Executive Summary Bar */}
      <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Executive Summary</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">Aggregate Signal (Comms 45d + Stats 60d)</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard
            label="Fed Aggregate"
            value={fedAggAvg !== null ? (fedAggAvg > 0 ? '+' : '') + fedAggAvg.toFixed(3) : '—'}
            sublabel={stanceLabel(fedAggAvg)}
            variant="primary"
          />
          <MetricCard
            label="ECB Aggregate"
            value={ecbAggAvg !== null ? (ecbAggAvg > 0 ? '+' : '') + ecbAggAvg.toFixed(3) : '—'}
            sublabel={stanceLabel(ecbAggAvg)}
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
              <MetricCard label="Fed Path (Fund.)" value={fedPred.next_decision.toUpperCase()} sublabel={`${(fedPred.hold_probability * 100).toFixed(0)}% hold`} variant="prediction" />
              <MetricCard label="ECB Path (Fund.)" value={ecbPred.next_decision.toUpperCase()} sublabel={`${(ecbPred.cut_probability * 100).toFixed(0)}% cut`} variant="prediction" />
              <MetricCard label="EUR/USD (Fund.)" value={eurusdPred.direction.toUpperCase()} sublabel={`${(eurusdPred.signal_strength * 100).toFixed(0)}% signal`} variant="prediction" />
            </>
          ) : (
            <>
              <MetricCard label="Fed Path (Fund.)" value="—" sublabel="Loading..." variant="prediction" />
              <MetricCard label="ECB Path (Fund.)" value="—" sublabel="Loading..." variant="prediction" />
              <MetricCard label="EUR/USD (Fund.)" value="—" sublabel="Loading..." variant="prediction" />
            </>
          )}
          <MetricCard label="Comm. Volume" value={String(totalRecentItems)} sublabel="recent events" trend={recent7.length > 5 ? 'up' : 'flat'} trendValue={`${recent7.length} this week`} />
        </div>
      </div>

      {/* Aggregate Scores (Comms 45d + Stats 60d) */}
      <div className="rounded-xl border border-primary/20 bg-card p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Aggregate Score (Comms 45d + Stats 60d)</span>
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
              fedAggAvg !== null && fedAggAvg > 0.05 ? 'text-signal-hawkish' : fedAggAvg !== null && fedAggAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {fedAggAvg !== null ? (fedAggAvg > 0 ? '+' : '') + fedAggAvg.toFixed(3) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">{fed45Comms.length} comms (45d) + {fed60Stats.length} stats (60d)</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">FED Comms Only (45d)</span>
            <p className={cn('text-lg font-mono font-semibold',
              fedCommAvg !== null && fedCommAvg > 0.05 ? 'text-signal-hawkish' : fedCommAvg !== null && fedCommAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {fedCommAvg !== null ? (fedCommAvg > 0 ? '+' : '') + fedCommAvg.toFixed(3) : '—'}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">ECB Aggregate</span>
            <p className={cn('text-2xl font-mono font-bold',
              ecbAggAvg !== null && ecbAggAvg > 0.05 ? 'text-signal-hawkish' : ecbAggAvg !== null && ecbAggAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {ecbAggAvg !== null ? (ecbAggAvg > 0 ? '+' : '') + ecbAggAvg.toFixed(3) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">{ecb45Comms.length} comms (45d) + {ecb60Stats.length} stats (60d)</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">ECB Comms Only (45d)</span>
            <p className={cn('text-lg font-mono font-semibold',
              ecbCommAvg !== null && ecbCommAvg > 0.05 ? 'text-signal-hawkish' : ecbCommAvg !== null && ecbCommAvg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {ecbCommAvg !== null ? (ecbCommAvg > 0 ? '+' : '') + ecbCommAvg.toFixed(3) : '—'}
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

      {/* CIE: Communication vs Model Gap */}
      <CIEWidget allItems={allItems} aiPrediction={aiPrediction} isPredictionLoading={isPredictionLoading} />

      {/* Stance Decomposition Waterfall */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <StanceDecomposition items={allItems as any} bank="FED" />
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <StanceDecomposition items={allItems as any} bank="ECB" />
        </div>
      </div>

      {/* Surprise Index */}
      <SurpriseIndex allItems={allItems as any} />

      {/* Change-Point Detection */}
      <ChangePointSection allItems={allItems as any} />

      {/* Cross-Bank Spread */}
      <CrossBankSpread allItems={allItems as any} />

      {/* Bank Panels */}
      <div className="grid lg:grid-cols-2 gap-4">
        <BankPanel
          bank="FED"
          score30d={fedAggAvg ?? 0}
          commCount30d={fed45Comms.length}
          statCount30d={fed60Stats.length}
          totalItems={fedItems.length}
          latestTitle={latestFed?.title || ''}
          latestDate={latestFed?.item_date || ''}
          commCount7d={fed7.length}
        />
        <BankPanel
          bank="ECB"
          score30d={ecbAggAvg ?? 0}
          commCount30d={ecb45Comms.length}
          statCount30d={ecb60Stats.length}
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

    </div>
  );
};

export default Dashboard;
