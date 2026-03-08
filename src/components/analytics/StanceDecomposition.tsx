import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Layers } from 'lucide-react';
import type { SentimentItem } from '@/lib/api/sentiment';

interface StanceDecompositionProps {
  items: SentimentItem[];
  bank: string;
}

interface WaterfallItem {
  name: string;
  value: number;
  cumulative: number;
  isTotal?: boolean;
  color: string;
}

/**
 * Decomposes the aggregate stance score into contributing factors
 * derived from policy_dimensions and scoring reasons.
 */
export function StanceDecomposition({ items, bank }: StanceDecompositionProps) {
  const waterfall = useMemo(() => {
    const comms = items.filter(i => i.bank === bank && !i.is_statistical);
    const recent30 = comms.filter(i => {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
      return i.item_date >= cutoff.toISOString().split('T')[0];
    });

    if (recent30.length === 0) return [];

    // Count dimension contributions from reasons and scores
    let inflationPressure = 0;
    let restrictiveEmphasis = 0;
    let growthRisks = 0;
    let uncertaintyDrag = 0;
    let guidanceFirmness = 0;
    let balanceSheetSignal = 0;

    for (const item of recent30) {
      const score = item.net_score || 0;
      const reasons = (item.reasons || []).map((r: string) => r.toLowerCase());
      const dims = (item as any).policy_dimensions;

      // Inflation persistence language (hawkish +)
      const hasInflation = reasons.some((r: string) => r.includes('inflation') || r.includes('price'));
      if (hasInflation) inflationPressure += Math.max(score * 0.4, 0);

      // Restrictive policy emphasis (hawkish +)
      const hasRestrictive = reasons.some((r: string) => r.includes('restrictive') || r.includes('tight') || r.includes('more to do'));
      if (hasRestrictive) restrictiveEmphasis += Math.max(score * 0.3, 0);

      // Growth downside risks (dovish -)
      const hasGrowth = reasons.some((r: string) => r.includes('growth') || r.includes('slowdown') || r.includes('recession'));
      if (hasGrowth) growthRisks += Math.min(score * 0.3, 0);

      // Uncertainty language (dovish -)
      const hasUncertainty = reasons.some((r: string) => r.includes('uncertain') || r.includes('data dependent') || r.includes('monitor'));
      if (hasUncertainty) uncertaintyDrag -= 0.02;

      // Guidance firmness
      if (dims?.forward_guidance === 'firm') guidanceFirmness += 0.02;
      else if (dims?.forward_guidance === 'open-ended' || dims?.forward_guidance === 'open_ended') guidanceFirmness -= 0.02;

      // Balance sheet
      if (dims?.balance_sheet === 'active_qt' || dims?.balance_sheet === 'tightening') balanceSheetSignal += 0.01;
      else if (dims?.balance_sheet === 'easing' || dims?.balance_sheet === 'reinvesting') balanceSheetSignal -= 0.01;
    }

    // Normalize by count
    const n = recent30.length;
    const factors: { name: string; value: number }[] = [
      { name: 'Inflation Persistence', value: Math.round((inflationPressure / n) * 1000) / 1000 },
      { name: 'Restrictive Emphasis', value: Math.round((restrictiveEmphasis / n) * 1000) / 1000 },
      { name: 'Growth Risks', value: Math.round((growthRisks / n) * 1000) / 1000 },
      { name: 'Uncertainty Drag', value: Math.round((uncertaintyDrag / n) * 1000) / 1000 },
      { name: 'Guidance Firmness', value: Math.round((guidanceFirmness / n) * 1000) / 1000 },
      { name: 'Balance Sheet', value: Math.round((balanceSheetSignal / n) * 1000) / 1000 },
    ].filter(f => Math.abs(f.value) > 0.001);

    // Sort by absolute value descending
    factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    // Build waterfall
    let cumulative = 0;
    const result: WaterfallItem[] = [];
    for (const f of factors) {
      result.push({
        name: f.value > 0 ? `+ ${f.name}` : `– ${f.name.replace('Risks', 'risks').replace('Drag', 'drag')}`,
        value: f.value,
        cumulative: cumulative + f.value,
        color: f.value > 0 ? 'hsl(var(--signal-hawkish))' : 'hsl(var(--signal-dovish))',
      });
      cumulative += f.value;
    }

    // Add total bar
    result.push({
      name: 'Net Score',
      value: cumulative,
      cumulative,
      isTotal: true,
      color: cumulative > 0 ? 'hsl(var(--primary))' : 'hsl(var(--prediction))',
    });

    return result;
  }, [items, bank]);

  if (waterfall.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">No decomposition data for {bank}</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="rounded-lg border border-border bg-card p-2 shadow-xl text-xs">
        <p className="font-medium">{d.name}</p>
        <p className="font-mono">{d.value > 0 ? '+' : ''}{d.value.toFixed(3)}</p>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider">{bank} — What Moved the Score?</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(waterfall.length * 36, 180)}>
        <BarChart data={waterfall} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 120 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={115} />
          <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {waterfall.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} fillOpacity={entry.isTotal ? 1 : 0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
