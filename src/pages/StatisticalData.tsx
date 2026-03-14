import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { ExpandableTitle } from '@/components/analytics/ExpandableTitle';
import {
  getStatisticalItems,
  runSentimentAnalysis,
  type SentimentItem,
} from '@/lib/api/sentiment';
import { RefreshCw, ExternalLink, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/** Compute stat score from a 75-day window for a given bank */
function compute75dStatScore(items: SentimentItem[], bank: string) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 75);
  const cs = cutoff.toISOString().split('T')[0];
  const recent = items.filter(i => i.bank === bank && i.item_date >= cs && Math.abs(i.net_score) > 0.001);
  if (!recent.length) return null;
  return {
    avg: Math.round(recent.reduce((s, i) => s + i.net_score, 0) / recent.length * 1000) / 1000,
    count: recent.length,
    label: (() => {
      const avg = recent.reduce((s, i) => s + i.net_score, 0) / recent.length;
      return avg <= -0.5 ? 'STRONGLY DOVISH' : avg < -0.1 ? 'DOVISH' : avg >= 0.5 ? 'STRONGLY HAWKISH' : avg > 0.1 ? 'HAWKISH' : 'NEUTRAL';
    })(),
  };
}

const StatisticalData = () => {
  const [bankFilter, setBankFilter] = useState<'FED' | 'ECB' | undefined>(undefined);
  const queryClient = useQueryClient();

  const { data: statItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['stat-items', bankFilter],
    queryFn: () => getStatisticalItems(bankFilter),
  });

  // Fetch ALL stat items (unfiltered) for score computation
  const { data: allStatItems = [] } = useQuery({
    queryKey: ['stat-items-all'],
    queryFn: () => getStatisticalItems(),
  });

  const refreshMutation = useMutation({
    mutationFn: () => runSentimentAnalysis('both', 60, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stat-items'] });
      queryClient.invalidateQueries({ queryKey: ['stat-items-all'] });
      queryClient.invalidateQueries({ queryKey: ['comm-items'] });
      queryClient.invalidateQueries({ queryKey: ['sentiment-scores'] });
      toast.success('Sentiment analysis complete');
    },
    onError: (error) => {
      toast.error(`Analysis failed: ${error.message}`);
    },
  });

  const fedStatScore = useMemo(() => compute75dStatScore(allStatItems, 'FED'), [allStatItems]);
  const ecbStatScore = useMemo(() => compute75dStatScore(allStatItems, 'ECB'), [allStatItems]);

  const filteredItems = bankFilter
    ? statItems.filter(i => i.bank === bankFilter)
    : statItems;

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Statistical Releases</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Score based on statistical data only (FRED, Eurostat) — 75-day window
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

      {/* Score Cards — Stats Only */}
      <div className="grid lg:grid-cols-2 gap-4">
        <StatScoreCard bank="FED" label="Federal Reserve" score={fedStatScore} />
        <StatScoreCard bank="ECB" label="European Central Bank" score={ecbStatScore} />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[
          { label: 'All', value: undefined },
          { label: 'Fed', value: 'FED' as const },
          { label: 'ECB', value: 'ECB' as const },
        ].map(f => (
          <Button
            key={f.label}
            variant={bankFilter === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBankFilter(f.value)}
            className="text-xs"
          >{f.label}</Button>
        ))}
      </div>

      {/* Items Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-2.5 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground">Bank</th>
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
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading data…</td></tr>
              )}
              {!loadingItems && filteredItems.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">
                  No data yet. Click "Refresh Data" to run the analysis.
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
                  <td className="p-2.5 text-muted-foreground max-w-[100px] truncate">{item.source}</td>
                  <td className="p-2.5"><ExpandableTitle title={item.title} maxWidth="max-w-[250px]" /></td>
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

function StatScoreCard({ bank, label, score }: {
  bank: string;
  label: string;
  score: { avg: number; count: number; label: string } | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full', bank === 'FED' ? 'bg-primary' : 'bg-prediction')} />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      {!score ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No scored statistical data available. Click "Refresh Data" to fetch latest releases.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Database className="w-3 h-3 text-chart-3" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Statistical Data-Implied Policy (75d)</p>
          </div>
          <p className={cn(
            'text-xl font-mono font-bold',
            score.avg > 0.05 ? 'text-signal-hawkish' : score.avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
          )}>
            {score.avg > 0 ? '+' : ''}{score.avg.toFixed(3)}
          </p>
          <p className="text-[10px] text-muted-foreground">{score.label}</p>
          <p className="text-[10px] text-muted-foreground">{score.count} items</p>
        </div>
      )}
    </div>
  );
}

export default StatisticalData;
