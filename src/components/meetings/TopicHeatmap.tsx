import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import type { SentimentItem } from '@/lib/api/sentiment';

const TOPIC_LABELS: Record<string, string> = {
  inflation_dynamics: 'Inflation',
  wages_labor: 'Wages / Labor',
  credit_conditions: 'Credit',
  housing: 'Housing',
  energy_supply: 'Energy / Supply',
  fiscal_geo_risk: 'Fiscal / Geo',
  financial_stability: 'Fin. Stability',
  growth_outlook: 'Growth',
  qe_qt: 'QE / QT',
  forward_guidance: 'Fwd Guidance',
};

const ALL_TOPICS = Object.keys(TOPIC_LABELS);

/**
 * Smooth heat color ramp using CSS oklch for perceptually uniform gradients.
 * 0 → neutral gray, 0.01–0.3 → cool teal, 0.3–0.6 → warm amber, 0.6–1 → hot coral/red
 */
function heatColor(intensity: number): string {
  if (intensity === 0) return 'hsl(var(--muted))';
  // Interpolate through a perceptual ramp
  const h = 200 - intensity * 200; // 200 (teal) → 0 (red)
  const s = 50 + intensity * 40;   // 50% → 90%
  const l = 85 - intensity * 40;   // 85% → 45%
  return `hsl(${h} ${s}% ${l}%)`;
}

function heatTextColor(intensity: number): string {
  return intensity > 0.5 ? 'hsl(0 0% 100%)' : 'hsl(var(--foreground))';
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
              className="relative rounded-md overflow-hidden text-center transition-all duration-300"
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

/** Cross-meeting heatmap matrix: rows = topics, columns = meetings (chronological) */
export function TopicHeatmapMatrix({
  meetings,
}: {
  meetings: { id: string; label: string; bank: string; items: any[] }[];
}) {
  // Sort columns newest → oldest (left → right)
  const sorted = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const dateA = a.id.split('-').slice(1).join('-');
      const dateB = b.id.split('-').slice(1).join('-');
      return dateB.localeCompare(dateA);
    });
  }, [meetings]);

  const matrix = useMemo(() => {
    return ALL_TOPICS.map(topic => {
      const row = sorted.map(m => {
        let count = 0;
        for (const item of m.items) {
          const topics = (item as any).topics as string[] | undefined;
          if (topics?.includes(topic)) count++;
        }
        return count;
      });
      return { topic, row };
    });
  }, [sorted]);

  const globalMax = Math.max(1, ...matrix.flatMap(r => r.row));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground sticky left-0 bg-card z-10 min-w-[100px] border-b border-border">
              Topic
            </th>
            {sorted.map(m => {
              const dateParts = m.label.split('—')[0].trim();
              return (
                <th
                  key={m.id}
                  className="py-2.5 px-1 font-medium text-muted-foreground text-center min-w-[54px] border-b border-border"
                >
                  <div className="truncate max-w-[72px] text-[9px]">{dateParts}</div>
                  <span
                    className={cn(
                      'inline-block mt-0.5 text-[7px] font-bold px-1.5 py-0.5 rounded-full',
                      m.bank === 'FED'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-accent text-accent-foreground',
                    )}
                  >
                    {m.bank}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {matrix.map(({ topic, row }) => (
            <tr key={topic} className="group">
              <td className="py-2 px-3 font-semibold text-foreground sticky left-0 bg-card z-10 border-b border-border/30 text-[11px]">
                {TOPIC_LABELS[topic]}
              </td>
              {row.map((count, i) => {
                const intensity = count / globalMax;
                return (
                  <td key={sorted[i].id} className="py-1 px-0.5 text-center border-b border-border/30">
                    <div
                      className="mx-auto rounded-md w-full h-9 flex items-center justify-center font-bold text-xs transition-all duration-300 hover:scale-105 hover:shadow-md cursor-default"
                      style={{
                        backgroundColor: heatColor(intensity),
                        color: heatTextColor(intensity),
                      }}
                      title={`${TOPIC_LABELS[topic]}: ${count} mentions`}
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
      <div className="flex items-center gap-1.5 mt-4 text-[9px] text-muted-foreground">
        <span className="font-medium mr-1">Intensity</span>
        {[0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map(v => (
          <div
            key={v}
            className="w-6 h-3.5 rounded-sm transition-all"
            style={{ backgroundColor: heatColor(v) }}
            title={`${Math.round(v * 100)}%`}
          />
        ))}
        <span className="ml-1 text-[8px]">Low → High</span>
      </div>
    </div>
  );
}

export { ALL_TOPICS, TOPIC_LABELS };
