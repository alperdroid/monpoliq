import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Area, ReferenceLine, CartesianGrid } from 'recharts';
import { FlaskConical, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface TaylorRuleResult {
  bank: string;
  coefficients: { intercept: number; inflation_gap: number; output_gap: number };
  r_squared: number;
  sample_size: number;
  sample_start: string;
  sample_end: string;
  time_series: { date: string; actual_rate: number; implied_rate: number; inflation: number; unemployment: number }[];
  latest_gap: number;
  latest_implied: number;
  latest_actual: number;
  generated_at: string;
  error?: string;
}

async function fetchTaylorRule(bank: string): Promise<TaylorRuleResult> {
  const { data, error } = await supabase.functions.invoke('taylor-rule', { body: { bank } });
  if (error) throw error;
  return data as TaylorRuleResult;
}

export function TaylorRulePanel() {
  const [bank, setBank] = useState<string>('FED');

  const { data, isLoading } = useQuery({
    queryKey: ['taylor-rule', bank],
    queryFn: () => fetchTaylorRule(bank),
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const gap = data?.latest_gap ?? 0;
  const GapIcon = gap > 0.15 ? TrendingUp : gap < -0.15 ? TrendingDown : Minus;
  const gapColor = gap > 0.15 ? 'text-signal-hawkish' : gap < -0.15 ? 'text-signal-dovish' : 'text-signal-neutral';
  const gapLabel = gap > 0.15 ? 'Rate Below Taylor Rule' : gap < -0.15 ? 'Rate Above Taylor Rule' : 'Near Taylor Rule';

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-chart-4" />
          <h3 className="text-sm font-semibold">Classical Taylor Rule Benchmark</h3>
        </div>
        <Select value={bank} onValueChange={setBank}>
          <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-[10px] text-muted-foreground">
        OLS regression: Rate = α + β₁·(π - π*) + β₂·(y - y*) using historical FRED data
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : data?.error ? (
        <p className="text-xs text-muted-foreground text-center py-6">{data.error}</p>
      ) : data ? (
        <>
          {/* Coefficients */}
          <div className="grid grid-cols-5 gap-3">
            <div className="rounded-md bg-surface p-2.5 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Intercept (α)</p>
              <p className="text-sm font-mono font-bold text-foreground">{data.coefficients.intercept.toFixed(3)}</p>
            </div>
            <div className="rounded-md bg-surface p-2.5 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Inflation Gap (β₁)</p>
              <p className="text-sm font-mono font-bold text-foreground">{data.coefficients.inflation_gap.toFixed(3)}</p>
            </div>
            <div className="rounded-md bg-surface p-2.5 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Output Gap (β₂)</p>
              <p className="text-sm font-mono font-bold text-foreground">{data.coefficients.output_gap.toFixed(3)}</p>
            </div>
            <div className="rounded-md bg-surface p-2.5 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">R²</p>
              <p className="text-sm font-mono font-bold text-foreground">{data.r_squared.toFixed(3)}</p>
            </div>
            <div className="rounded-md bg-surface p-2.5 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Observations</p>
              <p className="text-sm font-mono font-bold text-foreground">{data.sample_size}</p>
            </div>
          </div>

          {/* Gap indicator */}
          <div className="flex items-center gap-2 px-2">
            <GapIcon className={cn('w-4 h-4', gapColor)} />
            <span className={cn('text-sm font-mono font-bold', gapColor)}>
              {gap > 0 ? '+' : ''}{gap.toFixed(3)}%
            </span>
            <span className="text-xs text-muted-foreground">({gapLabel})</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              Actual: {data.latest_actual.toFixed(2)}% | Implied: {data.latest_implied.toFixed(2)}%
            </span>
          </div>

          {/* Chart */}
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.time_series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v: string) => {
                  const [y, m] = v.split('-');
                  return parseInt(m) === 1 ? y : '';
                }}
              />
              <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '10px',
                }}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)}%`,
                  name === 'actual_rate' ? 'Actual Rate' : 'Taylor-Implied',
                ]}
              />
              <Line type="monotone" dataKey="actual_rate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="actual_rate" />
              <Line type="monotone" dataKey="implied_rate" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="5 3" dot={false} name="implied_rate" />
            </LineChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex items-center gap-6 justify-center text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-primary rounded" />
              <span className="text-muted-foreground">Actual Policy Rate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 rounded" style={{ borderTop: '2px dashed hsl(var(--chart-4))' }} />
              <span className="text-muted-foreground">Taylor Rule Implied</span>
            </div>
          </div>

          <p className="text-[9px] text-muted-foreground text-center">
            Sample: {data.sample_start} to {data.sample_end} · Generated {new Date(data.generated_at).toLocaleString()}
          </p>
        </>
      ) : null}
    </div>
  );
}
