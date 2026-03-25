import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { PredictionPanel } from '@/components/dashboard/PredictionPanel';
import { MetricCard } from '@/components/analytics/MetricCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Brain, LineChart } from 'lucide-react';
import { PivotProbabilityPanel } from '@/components/predictions/PivotProbabilityPanel';
import { MultiHorizonPanel } from '@/components/predictions/MultiHorizonPanel';
import { MarketSentimentTable } from '@/components/predictions/MarketSentimentTable';

import { OISOverlayChart } from '@/components/predictions/OISOverlayChart';

import {
  getCachedSentimentItems,
  type SentimentItem,
} from '@/lib/api/sentiment';
import {
  fetchAIPredictions, toPredictionOutput, toCurrencyPrediction, toTreasuryPrediction,
} from '@/lib/api/predictions';

function recentItems(items: SentimentItem[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cs = cutoff.toISOString().split('T')[0];
  return items.filter(i => i.item_date >= cs);
}

function compute30dAvg(items: SentimentItem[]) {
  const scored = items.filter(i => Math.abs(i.net_score) > 0.001);
  if (!scored.length) return null;
  return Math.round(scored.reduce((s, i) => s + i.net_score, 0) / scored.length * 1000) / 1000;
}

const Predictions = () => {
  const { data: aiPrediction, isLoading } = useQuery({
    queryKey: ['ai-predictions'],
    queryFn: fetchAIPredictions,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const fedPred = aiPrediction ? toPredictionOutput(aiPrediction.fed, 'FED') : null;
  const ecbPred = aiPrediction ? toPredictionOutput(aiPrediction.ecb, 'ECB') : null;
  const eurusdPred = aiPrediction ? toCurrencyPrediction(aiPrediction.eurusd) : null;
  const us10yPred = aiPrediction?.us10y ? toTreasuryPrediction(aiPrediction.us10y) : undefined;

  // Real underlying signal data
  const recent30 = recentItems(allItems, 30);
  const fedComms30 = recent30.filter(i => i.bank === 'FED' && !i.is_statistical);
  const ecbComms30 = recent30.filter(i => i.bank === 'ECB' && !i.is_statistical);
  const fedStats30 = recent30.filter(i => i.bank === 'FED' && i.is_statistical);
  const ecbStats30 = recent30.filter(i => i.bank === 'ECB' && i.is_statistical);

  const fed30Avg = compute30dAvg(recent30.filter(i => i.bank === 'FED'));
  const ecb30Avg = compute30dAvg(recent30.filter(i => i.bank === 'ECB'));

  return (
    <div className="space-y-6 animate-slide-in max-w-3xl">
      <div>
        <div className="flex items-center gap-2">
          <LineChart className="w-5 h-5 text-prediction" />
          <h1 className="text-lg font-semibold">Fundamental vs Market View</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Comparing communication-implied policy paths against market pricing expectations
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-prediction/30 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-prediction animate-pulse" />
            <span className="text-sm font-semibold">Analyzing data...</span>
          </div>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
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
        <div className="rounded-lg border border-destructive/30 bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Fundamental predictions unavailable — check your connection and retry</p>
        </div>
      )}


      {/* OIS Market Pricing Overlay */}
      <OISOverlayChart />

      {/* Divergence Alert */}
      <DivergenceAlertWidget />

      {/* Multi-Horizon Forecasts */}
      <MultiHorizonPanel />

      {/* Pivot Probability */}
      <PivotProbabilityPanel />

      {/* Market Sentiment Table */}
      <MarketSentimentTable />


      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">Underlying Communication Signals (30-Day Window)</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-primary">Federal Reserve</p>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="30d Score" value={fed30Avg !== null ? (fed30Avg > 0 ? '+' : '') + fed30Avg.toFixed(3) : '—'} />
              <MetricCard label="Comms" value={String(fedComms30.length)} sublabel="30d items" />
              <MetricCard label="Stats" value={String(fedStats30.length)} sublabel="30d items" />
              <MetricCard label="Total" value={String(allItems.filter(i => i.bank === 'FED').length)} sublabel="all time" />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium text-prediction">European Central Bank</p>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="30d Score" value={ecb30Avg !== null ? (ecb30Avg > 0 ? '+' : '') + ecb30Avg.toFixed(3) : '—'} />
              <MetricCard label="Comms" value={String(ecbComms30.length)} sublabel="30d items" />
              <MetricCard label="Stats" value={String(ecbStats30.length)} sublabel="30d items" />
              <MetricCard label="Total" value={String(allItems.filter(i => i.bank === 'ECB').length)} sublabel="all time" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Predictions;
