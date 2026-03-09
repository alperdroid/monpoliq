import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Area, ComposedChart } from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SentimentItem } from '@/lib/api/sentiment';

interface NarrativeDriftProps {
  items: SentimentItem[];
  meetingDate: string;
  bank: string;
  prevMeetingDate: string | null;
}

/** Compute rolling drift slope and pivot probability */
function computeDrift(items: SentimentItem[], meetingDate: string, prevMeetingDate: string | null) {
  const startDate = prevMeetingDate || (() => {
    const d = new Date(meetingDate);
    d.setDate(d.getDate() - 45);
    return d.toISOString().split('T')[0];
  })();

  const relevant = items
    .filter(i => !i.is_statistical && i.item_date > startDate && i.item_date <= meetingDate && Math.abs(i.net_score) > 0.001)
    .sort((a, b) => a.item_date.localeCompare(b.item_date));

  if (relevant.length < 3) return null;

  // Group by date, compute running 5-item average
  const points: { date: string; score: number; runningAvg: number }[] = [];
  for (let i = 0; i < relevant.length; i++) {
    const window = relevant.slice(Math.max(0, i - 4), i + 1);
    const avg = window.reduce((s, it) => s + it.net_score, 0) / window.length;
    points.push({
      date: relevant[i].item_date.slice(5),
      score: relevant[i].net_score,
      runningAvg: Math.round(avg * 1000) / 1000,
    });
  }

  // Drift slope: linear regression on running averages
  const n = points.length;
  const xArr = points.map((_, i) => i);
  const yArr = points.map(p => p.runningAvg);
  const xMean = xArr.reduce((s, x) => s + x, 0) / n;
  const yMean = yArr.reduce((s, y) => s + y, 0) / n;
  const num = xArr.reduce((s, x, i) => s + (x - xMean) * (yArr[i] - yMean), 0);
  const den = xArr.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const slope = den ? num / den : 0;

  // Pivot detection: check if drift direction changed vs first half
  const mid = Math.floor(n / 2);
  const firstHalfAvg = yArr.slice(0, mid).reduce((s, y) => s + y, 0) / mid;
  const secondHalfAvg = yArr.slice(mid).reduce((s, y) => s + y, 0) / (n - mid);
  const directionChanged = (firstHalfAvg > 0 && secondHalfAvg < 0) || (firstHalfAvg < 0 && secondHalfAvg > 0);

  // Language shift: compare recent 3 items' avg to earlier items
  const recentAvg = yArr.slice(-3).reduce((s, y) => s + y, 0) / 3;
  const earlierAvg = yArr.slice(0, -3).reduce((s, y) => s + y, 0) / Math.max(1, yArr.length - 3);
  const shift = recentAvg - earlierAvg;

  // Simple pivot probability heuristic
  const pivotProb = Math.min(1, (
    (directionChanged ? 0.4 : 0) +
    (Math.abs(shift) > 0.2 ? 0.3 : Math.abs(shift) > 0.1 ? 0.15 : 0) +
    (Math.abs(slope) > 0.05 ? 0.2 : Math.abs(slope) > 0.02 ? 0.1 : 0) +
    (n > 10 ? 0.1 : 0)
  ));

  return {
    points,
    slope: Math.round(slope * 10000) / 10000,
    pivotProbability: Math.round(pivotProb * 100),
    directionChanged,
    shift: Math.round(shift * 1000) / 1000,
    driftLabel: slope > 0.02 ? 'hawkish_drift' : slope < -0.02 ? 'dovish_drift' : 'stable',
    currentTone: yArr[yArr.length - 1],
  };
}

export function NarrativeDrift({ items, meetingDate, bank, prevMeetingDate }: NarrativeDriftProps) {
  const drift = useMemo(
    () => computeDrift(items, meetingDate, prevMeetingDate),
    [items, meetingDate, prevMeetingDate],
  );

  if (!drift) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        Insufficient data for drift analysis (need 3+ scored items).
      </p>
    );
  }

  const driftIcon = drift.driftLabel === 'hawkish_drift'
    ? <TrendingUp className="w-3.5 h-3.5 text-signal-hawkish" />
    : drift.driftLabel === 'dovish_drift'
      ? <TrendingDown className="w-3.5 h-3.5 text-signal-dovish" />
      : <Minus className="w-3.5 h-3.5 text-signal-neutral" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">Narrative Drift Analysis</h4>
        <TooltipInfo content="Tracks changes in communication tone over time using rolling averages and regression analysis. Detects pivot points where messaging direction shifts significantly between meetings." />
      </div>
      {/* Drift Indicators */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5 bg-surface rounded-md px-2.5 py-1.5 border border-border">
          {driftIcon}
          <span className="text-[10px] font-semibold uppercase">
            {drift.driftLabel.replace('_', ' ')}
          </span>
          <span className="text-[9px] text-muted-foreground font-mono ml-1">
            slope: {drift.slope > 0 ? '+' : ''}{drift.slope}
          </span>
        </div>

        <div className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 border',
          drift.pivotProbability > 50
            ? 'bg-signal-hawkish/5 border-signal-hawkish/30'
            : drift.pivotProbability > 25
              ? 'bg-signal-neutral/5 border-signal-neutral/30'
              : 'bg-surface border-border',
        )}>
          <AlertTriangle className={cn(
            'w-3.5 h-3.5',
            drift.pivotProbability > 50 ? 'text-signal-hawkish' : 'text-muted-foreground',
          )} />
          <span className="text-[10px] font-semibold">Pivot: {drift.pivotProbability}%</span>
        </div>

        <div className="flex items-center gap-1.5 bg-surface rounded-md px-2.5 py-1.5 border border-border">
          <span className="text-[10px] text-muted-foreground">Recent shift:</span>
          <span className={cn(
            'text-[10px] font-mono font-semibold',
            drift.shift > 0.05 ? 'text-signal-hawkish' : drift.shift < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
          )}>
            {drift.shift > 0 ? '+' : ''}{drift.shift}
          </span>
        </div>
      </div>

      {/* Drift Chart */}
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={drift.points}>
          <XAxis dataKey="date" tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '10px',
            }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
          <Area type="monotone" dataKey="runningAvg" fill="hsl(var(--primary))" fillOpacity={0.1} stroke="none" />
          <Line type="monotone" dataKey="runningAvg" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="score" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="2 2" dot={{ r: 2, fill: 'hsl(var(--muted-foreground))' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
