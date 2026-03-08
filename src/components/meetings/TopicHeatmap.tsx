import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { SentimentItem } from '@/lib/api/sentiment';

const TOPIC_LABELS: Record<string, string> = {
  inflation_dynamics: 'Inflation',
  wages_labor: 'Wages/Labor',
  credit_conditions: 'Credit',
  housing: 'Housing',
  energy_supply: 'Energy/Supply',
  fiscal_geo_risk: 'Fiscal/Geo',
  financial_stability: 'Fin. Stability',
  growth_outlook: 'Growth',
  qe_qt: 'QE/QT',
  forward_guidance: 'Fwd Guidance',
};

const ALL_TOPICS = Object.keys(TOPIC_LABELS);

interface TopicHeatmapProps {
  items: SentimentItem[];
  meetingDate: string;
}

export function TopicHeatmap({ items, meetingDate }: TopicHeatmapProps) {
  const topicCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of ALL_TOPICS) counts[t] = 0;

    for (const item of items) {
      const topics = (item as any).topics as string[] | undefined;
      if (!topics) continue;
      for (const t of topics) {
        if (counts[t] !== undefined) counts[t]++;
      }
    }
    return counts;
  }, [items]);

  const maxCount = Math.max(1, ...Object.values(topicCounts));
  const dominant = Object.entries(topicCounts)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  if (dominant.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        No topic data — run topic analysis to populate.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ALL_TOPICS.map(topic => {
          const count = topicCounts[topic];
          const intensity = count / maxCount;
          return (
            <div
              key={topic}
              className={cn(
                'px-2 py-1 rounded text-[9px] font-mono border transition-all',
                intensity > 0.6
                  ? 'bg-primary/20 border-primary/40 text-primary font-semibold'
                  : intensity > 0.3
                    ? 'bg-primary/10 border-primary/20 text-primary/80'
                    : intensity > 0
                      ? 'bg-muted border-border text-muted-foreground'
                      : 'bg-transparent border-border/50 text-muted-foreground/40',
              )}
              title={`${TOPIC_LABELS[topic]}: ${count} items`}
            >
              {TOPIC_LABELS[topic]} {count > 0 && <span className="ml-0.5 opacity-70">({count})</span>}
            </div>
          );
        })}
      </div>
      {dominant.length > 0 && (
        <p className="text-[10px] text-muted-foreground italic">
          This cycle dominated by: {dominant.map(([t]) => TOPIC_LABELS[t]).join(' + ')}
        </p>
      )}
    </div>
  );
}
