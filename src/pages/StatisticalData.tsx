import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import {
  getCachedSentimentItems,
  getCachedSentimentScores,
  getStatisticalItems,
  runSentimentAnalysis,
  type SentimentItem,
  type CachedSentimentScore,
} from '@/lib/api/sentiment';
import { RefreshCw, ExternalLink, Database, MessageSquare, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const StatisticalData = () => {
  const [bankFilter, setBankFilter] = useState<'FED' | 'ECB' | undefined>(undefined);
  const queryClient = useQueryClient();

  const { data: statItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['stat-items', bankFilter],
    queryFn: () => getStatisticalItems(bankFilter),
  });

  const { data: commItems = [] } = useQuery({
    queryKey: ['comm-items', bankFilter],
    queryFn: () => getCachedSentimentItems(bankFilter),
  });

  const { data: scores = [] } = useQuery({
    queryKey: ['sentiment-scores'],
    queryFn: getCachedSentimentScores,
  });

  const refreshMutation = useMutation({
    mutationFn: () => runSentimentAnalysis('both', 60, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stat-items'] });
      queryClient.invalidateQueries({ queryKey: ['comm-items'] });
      queryClient.invalidateQueries({ queryKey: ['sentiment-scores'] });
      toast.success('Sentiment analysis complete');
    },
    onError: (error) => {
      toast.error(`Analysis failed: ${error.message}`);
    },
  });

  const fedScore = scores.find(s => s.bank === 'FED');
  const ecbScore = scores.find(s => s.bank === 'ECB');

  const allItems = [...statItems, ...commItems.filter(c => !c.is_statistical)]
    .sort((a, b) => b.item_date.localeCompare(a.item_date));

  const filteredItems = bankFilter
    ? allItems.filter(i => i.bank === bankFilter)
    : allItems;

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Statistical Data & Sentiment</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Dual scores: communication-only (Score 1) vs communication + statistical data (Score 2)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshMutation.isPending && 'animate-spin')} />
          {refreshMutation.isPending ? 'Analyzing…' : 'Refresh Data'}
        </Button>
      </div>

      {/* Dual Score Summary */}
      <div className="grid lg:grid-cols-2 gap-4">
        <DualScoreCard
          bank="FED"
          label="Federal Reserve"
          score={fedScore}
        />
        <DualScoreCard
          bank="ECB"
          label="European Central Bank"
          score={ecbScore}
        />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <Button
          variant={bankFilter === undefined ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBankFilter(undefined)}
          className="text-xs"
        >All</Button>
        <Button
          variant={bankFilter === 'FED' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBankFilter('FED')}
          className="text-xs"
        >Fed</Button>
        <Button
          variant={bankFilter === 'ECB' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBankFilter('ECB')}
          className="text-xs"
        >ECB</Button>
      </div>

      {/* Items Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-2.5 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Bank</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Type</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Source</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Title</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Metric</th>
                <th className="text-right p-2.5 font-medium text-muted-foreground">Value</th>
                <th className="text-right p-2.5 font-medium text-muted-foreground">Score</th>
                <th className="text-center p-2.5 font-medium text-muted-foreground">Signal</th>
                <th className="text-center p-2.5 font-medium text-muted-foreground">Link</th>
              </tr>
            </thead>
            <tbody>
              {loadingItems && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Loading data…</td></tr>
              )}
              {!loadingItems && filteredItems.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                  No data yet. Click "Refresh Data" to run the sentiment analysis algorithm.
                </td></tr>
              )}
              {filteredItems.map((item, idx) => (
                <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-2.5 font-mono text-muted-foreground whitespace-nowrap">{item.item_date}</td>
                  <td className="p-2.5">
                    <span className={cn(
                      'inline-flex items-center gap-1',
                      item.bank === 'FED' ? 'text-primary' : 'text-prediction',
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', item.bank === 'FED' ? 'bg-primary' : 'bg-prediction')} />
                      {item.bank}
                    </span>
                  </td>
                  <td className="p-2.5">
                    {item.is_statistical ? (
                      <span className="inline-flex items-center gap-1 text-chart-3">
                        <BarChart3 className="w-3 h-3" /> Stat
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-chart-2">
                        <MessageSquare className="w-3 h-3" /> Comm
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-muted-foreground max-w-[100px] truncate">{item.source}</td>
                  <td className="p-2.5 max-w-[250px] truncate font-medium" title={item.title}>{item.title}</td>
                  <td className="p-2.5 text-muted-foreground max-w-[120px] truncate">{item.stat_metric || '—'}</td>
                  <td className="p-2.5 text-right font-mono">
                    {item.stat_value !== null ? item.stat_value.toFixed(2) : '—'}
                  </td>
                  <td className={cn(
                    'p-2.5 text-right font-mono font-semibold',
                    item.net_score > 0.05 ? 'text-signal-hawkish' : item.net_score < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
                  )}>
                    {item.net_score > 0 ? '+' : ''}{item.net_score.toFixed(3)}
                  </td>
                  <td className="p-2.5 text-center">
                    <SignalBadge
                      label={item.label}
                      variant={item.label === 'hawkish' ? 'hawkish' : item.label === 'dovish' ? 'dovish' : 'neutral'}
                      size="sm"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        <ExternalLink className="w-3.5 h-3.5 inline" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

function DualScoreCard({ bank, label, score }: {
  bank: string;
  label: string;
  score?: CachedSentimentScore;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full', bank === 'FED' ? 'bg-primary' : 'bg-prediction')} />
        <h3 className="text-sm font-semibold">{label}</h3>
        {score && (
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            Updated {new Date(score.fetched_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {!score ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No scores yet. Run analysis to populate.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3 text-chart-2" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Score 1 — Comms Only</p>
            </div>
            <p className={cn(
              'text-xl font-mono font-bold',
              score.score_1_avg > 0.05 ? 'text-signal-hawkish' : score.score_1_avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {score.score_1_avg > 0 ? '+' : ''}{Number(score.score_1_avg).toFixed(3)}
            </p>
            <p className="text-[10px] text-muted-foreground">{score.score_1_label}</p>
            <p className="text-[10px] text-muted-foreground">{score.score_1_count} items</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-chart-3" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Score 2 — Comms + Stats</p>
            </div>
            <p className={cn(
              'text-xl font-mono font-bold',
              score.score_2_avg > 0.05 ? 'text-signal-hawkish' : score.score_2_avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {score.score_2_avg > 0 ? '+' : ''}{Number(score.score_2_avg).toFixed(3)}
            </p>
            <p className="text-[10px] text-muted-foreground">{score.score_2_label}</p>
            <p className="text-[10px] text-muted-foreground">{score.score_2_count} items</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default StatisticalData;
