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
  // Include both comms and statistical items for a richer signal
  const all = items
    .filter(i => i.bank === bank && Math.abs(i.net_score) > 0.001)
    .sort((a, b) => a.item_date.localeCompare(b.item_date));

  if (all.length < 8) return [];

  // Group by date (daily resolution for finer detection)
  const byDate: Record<string, number[]> = {};
  for (const item of all) {
    if (!byDate[item.item_date]) byDate[item.item_date] = [];
    byDate[item.item_date].push(item.net_score);
  }

  const days = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date,
      avg: scores.reduce((s, v) => s + v, 0) / scores.length,
      count: scores.length,
    }));

  if (days.length < 5) return [];

  // Compute rolling 5-day averages for smoothing
  const windowSize = Math.min(5, Math.floor(days.length / 3));
  const smoothed: { date: string; avg: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = days.slice(start, i + 1);
    const weightedSum = window.reduce((s, w) => s + w.avg * w.count, 0);
    const totalCount = window.reduce((s, w) => s + w.count, 0);
    smoothed.push({ date: days[i].date, avg: weightedSum / totalCount });
  }

  // Global stats on smoothed series
  const globalMean = smoothed.reduce((s, w) => s + w.avg, 0) / smoothed.length;
  const variance = smoothed.reduce((s, w) => s + (w.avg - globalMean) ** 2, 0) / smoothed.length;
  const globalStd = Math.sqrt(variance) || 0.03;

  // Adaptive threshold: lower for small datasets, standard for large
  const baseThreshold = smoothed.length < 15 ? 1.8 : 2.0;
  const threshold = globalStd * baseThreshold;
  
  // Minimum magnitude to report (avoid trivial detections)
  const minMagnitude = Math.max(0.03, globalStd * 0.5);

  const changePoints: ChangePoint[] = [];
  let cusumPos = 0;
  let cusumNeg = 0;
  const drift = globalStd * 0.3; // Tighter drift allowance

  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i].avg - globalMean;
    cusumPos = Math.max(0, cusumPos + diff - drift);
    cusumNeg = Math.min(0, cusumNeg + diff + drift);

    if (cusumPos > threshold || cusumNeg < -threshold) {
      // Compute before/after using smoothed values
      const lookback = Math.min(i, Math.max(3, Math.floor(smoothed.length / 4)));
      const lookahead = Math.min(smoothed.length - i, lookback);
      
      const beforeSlice = smoothed.slice(Math.max(0, i - lookback), i);
      const afterSlice = smoothed.slice(i, i + lookahead);
      
      const beforeAvg = beforeSlice.length > 0
        ? beforeSlice.reduce((s, w) => s + w.avg, 0) / beforeSlice.length : 0;
      const afterAvg = afterSlice.length > 0
        ? afterSlice.reduce((s, w) => s + w.avg, 0) / afterSlice.length : 0;
      const magnitude = Math.abs(afterAvg - beforeAvg);

      // Skip if magnitude is trivial
      if (magnitude < minMagnitude) {
        // Don't reset CUSUM — let it continue accumulating
        continue;
      }

      // Avoid duplicate detections within 7 days
      const lastCp = changePoints[changePoints.length - 1];
      if (lastCp) {
        const daysBetween = (new Date(smoothed[i].date).getTime() - new Date(lastCp.date).getTime()) / 86400000;
        if (daysBetween < 7) {
          // Keep the larger magnitude one
          if (magnitude > lastCp.magnitude) changePoints.pop();
          else continue;
        }
      }

      const shift = afterAvg - beforeAvg;
      const type: ChangePoint['type'] =
        magnitude > globalStd * 2.5 ? 'regime_shift' :
        (beforeAvg > 0.01 && afterAvg < -0.01) || (beforeAvg < -0.01 && afterAvg > 0.01) ? 'tone_reversal' :
        'guidance_change';

      const description =
        type === 'regime_shift' ? `Major regime shift: tone moved ${shift > 0 ? 'hawkish' : 'dovish'} by ${magnitude.toFixed(3)}`
        : type === 'tone_reversal' ? `Tone reversal from ${beforeAvg > 0 ? 'hawkish' : 'dovish'} to ${afterAvg > 0 ? 'hawkish' : 'dovish'}`
        : `Guidance shifted ${shift > 0 ? 'hawkish' : 'dovish'} by ${magnitude.toFixed(3)}`;

      changePoints.push({
        date: smoothed[i].date,
        type,
        magnitude,
        before_avg: Math.round(beforeAvg * 1000) / 1000,
        after_avg: Math.round(afterAvg * 1000) / 1000,
        description,
      });

      // Reset CUSUM after confirmed detection
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
