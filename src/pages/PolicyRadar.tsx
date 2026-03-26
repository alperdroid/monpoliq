import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Radar, Filter } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, Cell, ReferenceLine } from 'recharts';

interface RadarItem {
  id: string;
  bank: string;
  title: string;
  item_date: string;
  net_score: number;
  word_count: number;
  policy_dimensions: any;
  label: string;
  source: string;
}

// Known FOMC/ECB meeting dates for cycle filtering
const MEETING_DATES: Record<string, string[]> = {
  FED: ['2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10', '2026-01-29', '2026-03-19', '2026-04-30', '2026-06-11', '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17'],
  ECB: ['2025-03-06', '2025-04-17', '2025-06-05', '2025-07-24', '2025-09-11', '2025-10-30', '2025-12-18', '2026-02-05', '2026-03-19', '2026-04-30', '2026-06-11', '2026-07-23', '2026-09-10', '2026-10-29', '2026-12-17'],
};

function getMeetingCycleLabel(bank: string, date: string): string {
  const dates = MEETING_DATES[bank] || [];
  for (let i = 0; i < dates.length; i++) {
    if (date <= dates[i]) {
      const d = new Date(dates[i]);
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
  }
  return 'Future';
}

function getGuidanceStrength(dims: any): number {
  if (!dims) return 0.5;
  const g = dims.forward_guidance;
  if (g === 'firm') return 0.9;
  if (g === 'conditional') return 0.5;
  if (g === 'open-ended' || g === 'open_ended') return 0.2;
  return 0.5;
}

function getDominantTopic(dims: any): string {
  if (!dims) return 'general';
  const rf = dims.reaction_function;
  if (rf === 'inflation_priority' || rf === 'inflation') return 'inflation';
  if (rf === 'growth_priority' || rf === 'growth') return 'growth';
  if (rf === 'financial_stability' || rf === 'stability') return 'stability';
  return 'general';
}

const TOPIC_COLORS: Record<string, string> = {
  inflation: 'hsl(var(--signal-hawkish))',
  growth: 'hsl(var(--signal-dovish))',
  stability: 'hsl(var(--chart-4))',
  general: 'hsl(var(--muted-foreground))',
};

const PolicyRadar = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [cycleFilter, setCycleFilter] = useState<string>('all');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['radar-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sentiment_items')
        .select('id, bank, title, item_date, net_score, word_count, policy_dimensions, label, source')
        .eq('is_statistical', false)
        .order('item_date', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RadarItem[];
    },
  });

  const radarData = useMemo(() => {
    let filtered = items;
    if (bankFilter !== 'all') filtered = filtered.filter(i => i.bank === bankFilter);

    return filtered.map(item => ({
      x: item.net_score,
      y: getGuidanceStrength(item.policy_dimensions),
      z: Math.max(item.word_count || 100, 50),
      topic: getDominantTopic(item.policy_dimensions),
      title: item.title,
      date: item.item_date,
      bank: item.bank,
      label: item.label,
      cycle: getMeetingCycleLabel(item.bank, item.item_date),
    }));
  }, [items, bankFilter]);

  const filteredData = useMemo(() => {
    if (cycleFilter === 'all') return radarData;
    return radarData.filter(d => d.cycle === cycleFilter);
  }, [radarData, cycleFilter]);

  const cycles = useMemo(() => {
    const set = new Set(radarData.map(d => d.cycle));
    return ['all', ...Array.from(set)];
  }, [radarData]);

  // Quadrant stats
  const hawkFirm = filteredData.filter(d => d.x > 0 && d.y > 0.5).length;
  const hawkSoft = filteredData.filter(d => d.x > 0 && d.y <= 0.5).length;
  const doveFirm = filteredData.filter(d => d.x <= 0 && d.y > 0.5).length;
  const doveSoft = filteredData.filter(d => d.x <= 0 && d.y <= 0.5).length;

  // Drift detection
  const recent = filteredData.filter(d => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    return d.date >= cutoff.toISOString().split('T')[0];
  });
  const older = filteredData.filter(d => {
    const c1 = new Date(); c1.setDate(c1.getDate() - 14);
    const c2 = new Date(); c2.setDate(c2.getDate() - 45);
    return d.date < c1.toISOString().split('T')[0] && d.date >= c2.toISOString().split('T')[0];
  });
  const recentAvgX = recent.length ? recent.reduce((s, d) => s + d.x, 0) / recent.length : 0;
  const olderAvgX = older.length ? older.reduce((s, d) => s + d.x, 0) / older.length : 0;
  const drift = recentAvgX - olderAvgX;
  const driftLabel = Math.abs(drift) < 0.05 ? 'Stable' : drift > 0 ? 'Drifting Hawkish' : 'Drifting Dovish';

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-1 max-w-xs">
        <p className="font-medium truncate">{d.title}</p>
        <div className="flex gap-2">
          <SignalBadge label={d.bank} variant="info" />
          <SignalBadge label={d.topic} variant={d.topic === 'inflation' ? 'hawkish' : d.topic === 'growth' ? 'dovish' : 'neutral'} />
        </div>
        <p className="text-muted-foreground">
          Tone: <span className="font-mono">{d.x > 0 ? '+' : ''}{d.x.toFixed(3)}</span> · 
          Guidance: <span className="font-mono">{d.y.toFixed(2)}</span>
        </p>
        <p className="text-muted-foreground">{d.date}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Policy Radar</h1>
          <TooltipInfo content="2D scatter plot positioning communications by stance (hawkish/dovish) vs guidance strength (firm/conditional). Quadrant analysis reveals committee positioning and drift patterns over time." />
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {isLoading ? 'Loading…' : `${filteredData.length} communications plotted`}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-28 h-8 text-xs bg-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cycleFilter} onValueChange={setCycleFilter}>
          <SelectTrigger className="w-36 h-8 text-xs bg-surface"><SelectValue placeholder="Meeting Cycle" /></SelectTrigger>
          <SelectContent>
            {cycles.map(c => (
              <SelectItem key={c} value={c}>{c === 'all' ? 'All Cycles' : c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Drift Indicator */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className={cn(
          'rounded-lg border p-3 space-y-1',
          Math.abs(drift) > 0.05 ? 'border-signal-hawkish/30 bg-signal-hawkish/5' : 'border-border bg-card',
        )}>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Committee Drift</span>
          <p className={cn(
            'text-sm font-semibold',
            drift > 0.05 ? 'text-signal-hawkish' : drift < -0.05 ? 'text-signal-dovish' : 'text-foreground',
          )}>{driftLabel}</p>
          <p className="text-[9px] text-muted-foreground font-mono">{drift > 0 ? '+' : ''}{drift.toFixed(3)} shift</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hawk + Firm</span>
          <p className="text-lg font-mono font-bold text-signal-hawkish">{hawkFirm}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hawk + Soft</span>
          <p className="text-lg font-mono font-bold text-signal-neutral">{hawkSoft}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Dove + Firm</span>
          <p className="text-lg font-mono font-bold text-signal-dovish">{doveFirm}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Dove + Soft</span>
          <p className="text-lg font-mono font-bold text-muted-foreground">{doveSoft}</p>
        </div>
      </div>

      {/* 2D Scatter Plot */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: TOPIC_COLORS.inflation }} />
            <span className="text-[10px] text-muted-foreground">Inflation</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: TOPIC_COLORS.growth }} />
            <span className="text-[10px] text-muted-foreground">Growth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: TOPIC_COLORS.stability }} />
            <span className="text-[10px] text-muted-foreground">Fin. Stability</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: TOPIC_COLORS.general }} />
            <span className="text-[10px] text-muted-foreground">General</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[-1, 1]}
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              label={{ value: '← Dovish — Hawkish →', position: 'bottom', offset: 10, style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 1]}
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              label={{ value: 'Guidance Strength ↑', angle: -90, position: 'insideLeft', offset: -15, style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
            />
            <ZAxis type="number" dataKey="z" range={[30, 300]} />
            <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine y={0.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={filteredData}>
              {filteredData.map((entry, idx) => (
                <Cell key={idx} fill={TOPIC_COLORS[entry.topic] || TOPIC_COLORS.general} fillOpacity={0.7} stroke={TOPIC_COLORS[entry.topic]} strokeWidth={1} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-2 px-8">
          <span>Dot size = communication length · Color = dominant topic</span>
          <span>Quadrant labels: Firm Hawk | Firm Dove | Soft Hawk | Soft Dove</span>
        </div>
      </div>
    </div>
  );
};

export default PolicyRadar;
