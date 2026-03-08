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

// Heat colors: transparent → cool blue → warm orange → hot red
function heatColor(intensity: number): string {
  if (intensity === 0) return 'hsl(220 15% 96%)';
  if (intensity <= 0.2) return 'hsl(220 60% 92%)';
  if (intensity <= 0.4) return 'hsl(220 70% 78%)';
  if (intensity <= 0.6) return 'hsl(30 80% 70%)';
  if (intensity <= 0.8) return 'hsl(20 90% 58%)';
  return 'hsl(0 85% 50%)';
}

function heatTextColor(intensity: number): string {
  if (intensity <= 0.4) return 'hsl(220 20% 30%)';
  return 'hsl(0 0% 100%)';
}

interface TopicHeatmapProps {
  items: SentimentItem[];
  meetingDate: string;
  compact?: boolean;
}

export function TopicHeatmap({ items, meetingDate, compact }: TopicHeatmapProps) {
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
      <div className={cn('grid gap-1', compact ? 'grid-cols-5' : 'grid-cols-5 sm:grid-cols-10')}>
        {ALL_TOPICS.map(topic => {
          const count = topicCounts[topic];
          const intensity = count / maxCount;
          return (
            <div
              key={topic}
              className="relative rounded-md overflow-hidden text-center transition-all"
              style={{
                backgroundColor: heatColor(intensity),
                color: heatTextColor(intensity),
              }}
              title={`${TOPIC_LABELS[topic]}: ${count} mentions`}
            >
              <div className={cn('px-1 py-2', compact ? 'py-1.5' : 'py-3')}>
                <div className={cn('font-semibold truncate', compact ? 'text-[8px]' : 'text-[10px]')}>
                  {TOPIC_LABELS[topic]}
                </div>
                {count > 0 && (
                  <div className={cn('font-bold', compact ? 'text-xs' : 'text-sm')}>
                    {count}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!compact && dominant.length > 0 && (
        <p className="text-[10px] text-muted-foreground italic">
          Dominated by: <strong>{dominant.map(([t]) => TOPIC_LABELS[t]).join(' + ')}</strong>
        </p>
      )}
    </div>
  );
}

/** Cross-meeting heatmap matrix: rows = topics, columns = meetings */
export function TopicHeatmapMatrix({
  meetings,
}: {
  meetings: { id: string; label: string; bank: string; items: any[] }[];
}) {
  const matrix = useMemo(() => {
    return ALL_TOPICS.map(topic => {
      const row = meetings.map(m => {
        let count = 0;
        for (const item of m.items) {
          const topics = (item as any).topics as string[] | undefined;
          if (topics?.includes(topic)) count++;
        }
        return count;
      });
      return { topic, row };
    });
  }, [meetings]);

  const globalMax = Math.max(1, ...matrix.flatMap(r => r.row));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="text-left py-2 px-2 font-semibold text-muted-foreground sticky left-0 bg-background z-10 min-w-[90px]">
              Topic
            </th>
            {meetings.map(m => (
              <th
                key={m.id}
                className="py-2 px-1 font-medium text-muted-foreground text-center min-w-[60px]"
              >
                <div className="truncate max-w-[80px]">{m.label.split('—')[0].trim()}</div>
                <span
                  className={cn(
                    'inline-block mt-0.5 text-[8px] font-bold px-1 py-0.5 rounded',
                    m.bank === 'FED'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-accent/10 text-accent-foreground',
                  )}
                >
                  {m.bank}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map(({ topic, row }) => (
            <tr key={topic} className="border-t border-border/30">
              <td className="py-1.5 px-2 font-semibold text-foreground sticky left-0 bg-background z-10">
                {TOPIC_LABELS[topic]}
              </td>
              {row.map((count, i) => {
                const intensity = count / globalMax;
                return (
                  <td key={meetings[i].id} className="py-1 px-0.5 text-center">
                    <div
                      className="mx-auto rounded w-full h-8 flex items-center justify-center font-bold text-xs transition-all"
                      style={{
                        backgroundColor: heatColor(intensity),
                        color: heatTextColor(intensity),
                      }}
                      title={`${TOPIC_LABELS[topic]}: ${count}`}
                    >
                      {count > 0 ? count : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[9px] text-muted-foreground">
        <span>Intensity:</span>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => (
          <div
            key={v}
            className="w-5 h-3 rounded-sm"
            style={{ backgroundColor: heatColor(v) }}
            title={`${Math.round(v * 100)}%`}
          />
        ))}
        <span className="ml-1">Low → High</span>
      </div>
    </div>
  );
}

export { ALL_TOPICS, TOPIC_LABELS };
