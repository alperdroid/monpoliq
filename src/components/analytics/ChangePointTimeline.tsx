import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import type { SentimentItem } from '@/lib/api/sentiment';

interface ChangePoint {
  date: string;
  type: 'regime_shift' | 'guidance_change' | 'tone_reversal';
  magnitude: number;
  before_avg: number;
  after_avg: number;
  description: string;
}

/**
 * CUSUM-based change-point detection on the sentiment time series.
 * Groups items by week, computes weekly averages, then detects significant shifts.
 */
function detectChangePoints(items: SentimentItem[], bank: string): ChangePoint[] {
  const comms = items
    .filter(i => i.bank === bank && !i.is_statistical && Math.abs(i.net_score) > 0.001)
    .sort((a, b) => a.item_date.localeCompare(b.item_date));

  if (comms.length < 10) return [];

  // Group by ISO week
  const byWeek: Record<string, { scores: number[]; dates: string[] }> = {};
  for (const item of comms) {
    const d = new Date(item.item_date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    if (!byWeek[key]) byWeek[key] = { scores: [], dates: [] };
    byWeek[key].scores.push(item.net_score);
    byWeek[key].dates.push(item.item_date);
  }

  const weeks = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({
      week,
      avg: data.scores.reduce((s, v) => s + v, 0) / data.scores.length,
      count: data.scores.length,
    }));

  if (weeks.length < 4) return [];

  // Global mean and std
  const globalMean = weeks.reduce((s, w) => s + w.avg, 0) / weeks.length;
  const globalStd = Math.sqrt(weeks.reduce((s, w) => s + (w.avg - globalMean) ** 2, 0) / weeks.length) || 0.05;

  // CUSUM detection
  const threshold = globalStd * 2.5;
  const changePoints: ChangePoint[] = [];
  let cusumPos = 0;
  let cusumNeg = 0;

  for (let i = 1; i < weeks.length; i++) {
    const diff = weeks[i].avg - globalMean;
    cusumPos = Math.max(0, cusumPos + diff - globalStd * 0.5);
    cusumNeg = Math.min(0, cusumNeg + diff + globalStd * 0.5);

    if (cusumPos > threshold || cusumNeg < -threshold) {
      // Compute before/after averages
      const beforeStart = Math.max(0, i - 4);
      const beforeAvg = weeks.slice(beforeStart, i).reduce((s, w) => s + w.avg, 0) / Math.max(i - beforeStart, 1);
      const afterEnd = Math.min(weeks.length, i + 4);
      const afterAvg = weeks.slice(i, afterEnd).reduce((s, w) => s + w.avg, 0) / Math.max(afterEnd - i, 1);
      const magnitude = Math.abs(afterAvg - beforeAvg);

      const shift = afterAvg - beforeAvg;
      const type: ChangePoint['type'] =
        magnitude > globalStd * 3 ? 'regime_shift' :
        Math.sign(afterAvg) !== Math.sign(beforeAvg) ? 'tone_reversal' :
        'guidance_change';

      const description =
        type === 'regime_shift' ? `Major regime shift: tone moved ${shift > 0 ? 'hawkish' : 'dovish'} by ${magnitude.toFixed(3)}`
        : type === 'tone_reversal' ? `Tone reversal from ${beforeAvg > 0 ? 'hawkish' : 'dovish'} to ${afterAvg > 0 ? 'hawkish' : 'dovish'}`
        : `Guidance shifted ${shift > 0 ? 'hawkish' : 'dovish'} by ${magnitude.toFixed(3)}`;

      changePoints.push({
        date: weeks[i].week,
        type,
        magnitude,
        before_avg: Math.round(beforeAvg * 1000) / 1000,
        after_avg: Math.round(afterAvg * 1000) / 1000,
        description,
      });

      // Reset CUSUM after detection
      cusumPos = 0;
      cusumNeg = 0;
    }
  }

  return changePoints;
}

interface ChangePointTimelineProps {
  allItems: SentimentItem[];
  bank: string;
}

const typeColors: Record<string, string> = {
  regime_shift: 'bg-signal-hawkish/15 text-signal-hawkish border-signal-hawkish/25',
  tone_reversal: 'bg-signal-neutral/15 text-signal-neutral border-signal-neutral/25',
  guidance_change: 'bg-primary/10 text-primary border-primary/20',
};

const typeLabels: Record<string, string> = {
  regime_shift: 'Regime Shift',
  tone_reversal: 'Tone Reversal',
  guidance_change: 'Guidance Change',
};

export function ChangePointTimeline({ allItems, bank }: ChangePointTimelineProps) {
  const changePoints = useMemo(() => detectChangePoints(allItems, bank), [allItems, bank]);

  if (changePoints.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">No significant change points detected for {bank}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {changePoints.map((cp, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className={cn('w-3 h-3 rounded-full border', typeColors[cp.type])} />
            {i < changePoints.length - 1 && <div className="w-px h-8 bg-border" />}
          </div>
          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-muted-foreground">{cp.date}</span>
              <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider', typeColors[cp.type])}>
                {typeLabels[cp.type]}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                magnitude: {cp.magnitude.toFixed(3)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{cp.description}</p>
            <div className="flex gap-3 mt-1">
              <span className="text-[9px] text-muted-foreground">
                Before: <span className={cn('font-mono', cp.before_avg > 0 ? 'text-signal-hawkish' : 'text-signal-dovish')}>
                  {cp.before_avg > 0 ? '+' : ''}{cp.before_avg.toFixed(3)}
                </span>
              </span>
              <span className="text-[9px] text-muted-foreground">→</span>
              <span className="text-[9px] text-muted-foreground">
                After: <span className={cn('font-mono', cp.after_avg > 0 ? 'text-signal-hawkish' : 'text-signal-dovish')}>
                  {cp.after_avg > 0 ? '+' : ''}{cp.after_avg.toFixed(3)}
                </span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChangePointSection({ allItems }: { allItems: SentimentItem[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-signal-neutral" />
        <h3 className="text-sm font-semibold">Language Change-Point Detection</h3>
        <span className="text-[9px] text-muted-foreground ml-auto">CUSUM algorithm</span>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-medium text-primary mb-2">Federal Reserve</p>
          <ChangePointTimeline allItems={allItems} bank="FED" />
        </div>
        <div>
          <p className="text-xs font-medium text-prediction mb-2">European Central Bank</p>
          <ChangePointTimeline allItems={allItems} bank="ECB" />
        </div>
      </div>
    </div>
  );
}
