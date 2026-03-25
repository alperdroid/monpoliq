import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { GitCompareArrows, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { SentimentItem } from '@/lib/api/sentiment';

interface CrossBankSpreadProps {
  allItems: SentimentItem[];
}

/**
 * Cross-Bank Spread Intelligence
 * Fed stance pressure − ECB stance pressure → FX bias
 */
export function CrossBankSpread({ allItems }: CrossBankSpreadProps) {
  const { spreadData, currentSpread, spreadTrend, fxBias, guidanceGap, uncertaintyGap } = useMemo(() => {
    // Monthly averages per bank
    const byMonth: Record<string, { fedSum: number; fedN: number; ecbSum: number; ecbN: number }> = {};
    const comms = allItems.filter(i => !i.is_statistical && Math.abs(i.net_score) > 0.001);

    for (const item of comms) {
      const m = item.item_date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { fedSum: 0, fedN: 0, ecbSum: 0, ecbN: 0 };
      if (item.bank === 'FED') { byMonth[m].fedSum += item.net_score; byMonth[m].fedN++; }
      if (item.bank === 'ECB') { byMonth[m].ecbSum += item.net_score; byMonth[m].ecbN++; }
    }

    const months = Object.keys(byMonth).sort();
    const data = months.map(m => {
      const d = byMonth[m];
      const fedAvg = d.fedN > 0 ? d.fedSum / d.fedN : 0;
      const ecbAvg = d.ecbN > 0 ? d.ecbSum / d.ecbN : 0;
      return {
        month: m,
        fed: Math.round(fedAvg * 1000) / 1000,
        ecb: Math.round(ecbAvg * 1000) / 1000,
        spread: Math.round((fedAvg - ecbAvg) * 1000) / 1000,
      };
    });

    const latest = data[data.length - 1];
    const prev = data[data.length - 2];
    const spread = latest?.spread ?? 0;
    const trend = prev ? spread - prev.spread : 0;

    // FX bias: positive spread (Fed more hawkish) → USD strength → EUR/USD bearish
    const bias = spread > 0.05 ? 'USD Bullish (EUR/USD ↓)' : spread < -0.05 ? 'Upward Pressure for Euro' : 'Neutral';

    // Guidance gap from policy_dimensions (approximate)
    const recent = allItems.filter(i => {
      const c = new Date(); c.setDate(c.getDate() - 30);
      return i.item_date >= c.toISOString().split('T')[0] && !i.is_statistical;
    });
    const fedDims = recent.filter(i => i.bank === 'FED' && (i as any).policy_dimensions);
    const ecbDims = recent.filter(i => i.bank === 'ECB' && (i as any).policy_dimensions);
    
    const firmCount = (arr: any[]) => arr.filter(i => i.policy_dimensions?.forward_guidance === 'firm').length / Math.max(arr.length, 1);
    const guidGap = Math.round((firmCount(fedDims) - firmCount(ecbDims)) * 100);

    const uncCount = (arr: any[]) => arr.filter(i => {
      const r = ((i.reasons || []) as string[]).join(' ').toLowerCase();
      return r.includes('uncertain') || r.includes('data dependent');
    }).length / Math.max(arr.length, 1);
    const uncGap = Math.round((uncCount(fedDims) - uncCount(ecbDims)) * 100);

    return {
      spreadData: data,
      currentSpread: spread,
      spreadTrend: trend,
      fxBias: bias,
      guidanceGap: guidGap,
      uncertaintyGap: uncGap,
    };
  }, [allItems]);

  const TrendIcon = spreadTrend > 0.02 ? TrendingUp : spreadTrend < -0.02 ? TrendingDown : Minus;

  return (
    <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Cross-Bank Spread Intelligence</span>
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">Fed Stance − ECB Stance</span>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Policy Spread</span>
          <p className={cn(
            'text-2xl font-mono font-bold',
            currentSpread > 0.05 ? 'text-signal-hawkish' : currentSpread < -0.05 ? 'text-signal-dovish' : 'text-foreground',
          )}>
            {currentSpread > 0 ? '+' : ''}{currentSpread.toFixed(3)}
          </p>
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <TrendIcon className="w-3 h-3" />
            <span className="font-mono">{spreadTrend > 0 ? '+' : ''}{spreadTrend.toFixed(3)} MoM</span>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">FX Bias</span>
          <p className={cn(
            'text-sm font-semibold',
            fxBias.includes('USD') ? 'text-signal-hawkish' : fxBias.includes('Euro') ? 'text-signal-dovish' : 'text-foreground',
          )}>
            {fxBias}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Guidance Gap</span>
          <p className="text-lg font-mono font-bold">
            {guidanceGap > 0 ? '+' : ''}{guidanceGap}%
          </p>
          <span className="text-[9px] text-muted-foreground">Fed firmer by</span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Uncertainty Gap</span>
          <p className="text-lg font-mono font-bold">
            {uncertaintyGap > 0 ? '+' : ''}{uncertaintyGap}%
          </p>
          <span className="text-[9px] text-muted-foreground">Fed more uncertain</span>
        </div>
      </div>

      {/* Spread chart */}
      {spreadData.length > 2 && (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={spreadData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }} />
            <Area type="monotone" dataKey="spread" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="Spread (Fed − ECB)" />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <p className="text-[9px] text-muted-foreground">
        Positive spread → Fed relatively more hawkish → USD bullish pressure. Negative → ECB relatively more hawkish → EUR bullish pressure.
      </p>
    </div>
  );
}
