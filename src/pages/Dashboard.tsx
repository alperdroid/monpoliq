import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { MetricCard } from '@/components/analytics/MetricCard';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { BankPanel } from '@/components/dashboard/BankPanel';
import { PredictionPanel } from '@/components/dashboard/PredictionPanel';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fedSummary, ecbSummary,
  officialToneHistory, divergenceHistory, communicationVolumeHistory,
} from '@/data/mock-data';
import {
  getCachedSentimentScores,
  getCachedSentimentItems,
  type CachedSentimentScore,
  type SentimentItem,
} from '@/lib/api/sentiment';
import {
  fetchAIPredictions, toPredictionOutput, toCurrencyPrediction,
  type AIPredictionResponse,
} from '@/lib/api/predictions';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ReferenceLine,
} from 'recharts';
import { MessageSquare, Database, TrendingUp, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Group items by month and compute average net_score (excluding zero-score items) */
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

/** Filter items to last N days */
function recentItems(items: SentimentItem[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cs = cutoff.toISOString().split('T')[0];
  return items.filter(i => i.item_date >= cs);
}

const Dashboard = () => {
  const fedToneData = officialToneHistory.filter(d => d.label === 'FED');
  const ecbToneData = officialToneHistory.filter(d => d.label === 'ECB');

  const combinedTone = fedToneData.map((f, i) => ({
    date: f.date,
    fed: f.value,
    ecb: ecbToneData[i]?.value ?? 0,
  }));

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const { data: scores = [] } = useQuery({
    queryKey: ['sentiment-scores'],
    queryFn: getCachedSentimentScores,
  });

  // AI Predictions
  const { data: aiPrediction, isLoading: isPredictionLoading } = useQuery({
    queryKey: ['ai-predictions'],
    queryFn: fetchAIPredictions,
    staleTime: 1000 * 60 * 30, // 30 min cache
    retry: 1,
  });

  const fedScore = scores.find(s => s.bank === 'FED');
  const ecbScore = scores.find(s => s.bank === 'ECB');

  // 30-day items for current score (exclude zero-score neutrals)
  const recent30 = recentItems(allItems, 30);
  const fed30Comms = recent30.filter(i => i.bank === 'FED' && !i.is_statistical && Math.abs(i.net_score) > 0.001);
  const ecb30Comms = recent30.filter(i => i.bank === 'ECB' && !i.is_statistical && Math.abs(i.net_score) > 0.001);
  const fed30Avg = fed30Comms.length ? Math.round(fed30Comms.reduce((s, i) => s + i.net_score, 0) / fed30Comms.length * 1000) / 1000 : null;
  const ecb30Avg = ecb30Comms.length ? Math.round(ecb30Comms.reduce((s, i) => s + i.net_score, 0) / ecb30Comms.length * 1000) / 1000 : null;

  // 1-year monthly fluctuation data
  const fedMonthly = monthlyAverages(allItems.filter(i => !i.is_statistical), 'FED');
  const ecbMonthly = monthlyAverages(allItems.filter(i => !i.is_statistical), 'ECB');
  const allMonths = [...new Set([...fedMonthly.map(m => m.month), ...ecbMonthly.map(m => m.month)])].sort();
  const fluctuationData = allMonths.map(month => ({
    month,
    fed: fedMonthly.find(m => m.month === month)?.avg ?? null,
    ecb: ecbMonthly.find(m => m.month === month)?.avg ?? null,
  }));

  // Derive prediction display values
  const fedPred = aiPrediction ? toPredictionOutput(aiPrediction.fed, 'FED') : null;
  const ecbPred = aiPrediction ? toPredictionOutput(aiPrediction.ecb, 'ECB') : null;
  const eurusdPred = aiPrediction ? toCurrencyPrediction(aiPrediction.eurusd) : null;

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Executive Summary Bar */}
      <div className="rounded-lg border border-primary/20 bg-card p-4 glow-primary">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Executive Summary</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">Current Regime Signal</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard label="Fed Stance" value={fedSummary.official_stance > 0 ? '+' + fedSummary.official_stance.toFixed(2) : fedSummary.official_stance.toFixed(2)} sublabel="Sl. Hawkish" variant="primary" />
          <MetricCard label="ECB Stance" value={ecbSummary.official_stance > 0 ? '+' + ecbSummary.official_stance.toFixed(2) : ecbSummary.official_stance.toFixed(2)} sublabel="Sl. Dovish" variant="primary" />
          <MetricCard label="Regime" value="Divergent" sublabel="FED hawk / ECB dove" />
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
          <MetricCard label="Comm. Volume" value="25" sublabel="30d events" trend="up" trendValue="+25%" />
        </div>
      </div>

      {/* Live Algorithm Dual Scores — 30-day current */}
      {(fedScore || ecbScore) && (
        <div className="rounded-lg border border-chart-3/30 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-chart-3 animate-pulse-glow" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Algorithm v2.3 — Live Scores (30-day window)</span>
            </div>
            <Link to="/stats" className="text-[10px] text-primary hover:underline">View Details →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-chart-2" />
                <span className="text-[10px] text-muted-foreground">FED 30d Score</span>
              </div>
              <p className={cn('text-lg font-mono font-bold',
                fed30Avg !== null && fed30Avg > 0.05 ? 'text-signal-hawkish' : fed30Avg !== null && fed30Avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
              )}>
                {fed30Avg !== null ? (fed30Avg > 0 ? '+' : '') + fed30Avg.toFixed(3) : '—'}
              </p>
              <p className="text-[9px] text-muted-foreground">{fed30Comms.length} comms in 30d</p>
            </div>
            {fedScore && (
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Database className="w-3 h-3 text-chart-3" />
                  <span className="text-[10px] text-muted-foreground">FED All-time Score 2</span>
                </div>
                <p className={cn('text-lg font-mono font-bold',
                  Number(fedScore.score_2_avg) > 0.05 ? 'text-signal-hawkish' : Number(fedScore.score_2_avg) < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
                )}>
                  {Number(fedScore.score_2_avg) > 0 ? '+' : ''}{Number(fedScore.score_2_avg).toFixed(3)}
                </p>
                <p className="text-[9px] text-muted-foreground">{fedScore.score_2_label} ({fedScore.score_2_count} items)</p>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-chart-2" />
                <span className="text-[10px] text-muted-foreground">ECB 30d Score</span>
              </div>
              <p className={cn('text-lg font-mono font-bold',
                ecb30Avg !== null && ecb30Avg > 0.05 ? 'text-signal-hawkish' : ecb30Avg !== null && ecb30Avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
              )}>
                {ecb30Avg !== null ? (ecb30Avg > 0 ? '+' : '') + ecb30Avg.toFixed(3) : '—'}
              </p>
              <p className="text-[9px] text-muted-foreground">{ecb30Comms.length} comms in 30d</p>
            </div>
            {ecbScore && (
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Database className="w-3 h-3 text-chart-3" />
                  <span className="text-[10px] text-muted-foreground">ECB All-time Score 2</span>
                </div>
                <p className={cn('text-lg font-mono font-bold',
                  Number(ecbScore.score_2_avg) > 0.05 ? 'text-signal-hawkish' : Number(ecbScore.score_2_avg) < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
                )}>
                  {Number(ecbScore.score_2_avg) > 0 ? '+' : ''}{Number(ecbScore.score_2_avg).toFixed(3)}
                </p>
                <p className="text-[9px] text-muted-foreground">{ecbScore.score_2_label} ({ecbScore.score_2_count} items)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1-Year Sentiment Fluctuation Chart */}
      {fluctuationData.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">1-Year Sentiment Fluctuation (Monthly Avg)</h3>
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
        <BankPanel summary={fedSummary} />
        <BankPanel summary={ecbSummary} />
      </div>

      {/* AI Prediction Section */}
      {isPredictionLoading ? (
        <div className="rounded-lg border border-prediction/30 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-prediction animate-pulse" />
            <span className="text-sm font-semibold">AI Monetary Intelligence</span>
            <span className="text-[10px] text-muted-foreground ml-2">Analyzing sentiment data with Gemini...</span>
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
          fedReasoning={aiPrediction?.fed.reasoning}
          ecbReasoning={aiPrediction?.ecb.reasoning}
          eurusdReasoning={aiPrediction?.eurusd.reasoning}
          generatedAt={aiPrediction?.generated_at}
          dataSummary={aiPrediction?.data_summary}
        />
      ) : (
        <div className="rounded-lg border border-destructive/30 bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">AI predictions unavailable — refresh to retry</p>
        </div>
      )}

      {/* Communication Intelligence */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Communication Intelligence</h3>
          <SignalBadge label="Fed" variant="info" size="sm" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="Official Stance" value={`+${fedSummary.official_stance.toFixed(2)}`} />
          <MetricCard label="Member Weighted" value={`+${fedSummary.member_weighted_signal.toFixed(2)}`} />
          <MetricCard label="Divergence" value={fedSummary.divergence.toFixed(2)} trend={fedSummary.divergence > 0.15 ? 'up' : 'flat'} trendValue="rising" />
          <MetricCard label="7d Pressure" value={`${(fedSummary.communication_pressure_7d * 100).toFixed(0)}%`} trend="up" trendValue="active" />
          <MetricCard label="30d Pressure" value={`${(fedSummary.communication_pressure_30d * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Official Tone Over Time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={combinedTone}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[-0.5, 0.6]} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
              <Line type="monotone" dataKey="fed" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="FED" />
              <Line type="monotone" dataKey="ecb" stroke="hsl(var(--prediction))" strokeWidth={2} dot={{ r: 3 }} name="ECB" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Fed: Official vs Member Stance</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={divergenceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
              <Area type="monotone" dataKey="official" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.1)" strokeWidth={2} name="Official" />
              <Area type="monotone" dataKey="member_weighted" stroke="hsl(var(--signal-neutral))" fill="hsl(var(--signal-neutral) / 0.1)" strokeWidth={2} name="Members" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4">Communication Volume</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={communicationVolumeHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Events" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
