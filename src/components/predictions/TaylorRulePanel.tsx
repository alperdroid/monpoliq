import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { FlaskConical, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface RegimeInfo {
  coefficients: { intercept: number; inflation_gap: number; output_gap: number };
  r_squared: number;
  sample_size: number;
}

interface TaylorRuleResult {
  bank: string;
  regime_model?: string;
  normal_regime?: RegimeInfo;
  zlb_regime?: RegimeInfo | null;
  coefficients: { intercept: number; inflation_gap: number; output_gap: number };
  r_squared: number;
  sample_size: number;
  sample_start: string;
  sample_end: string;
  time_series: { date: string; actual_rate: number; implied_rate: number; inflation: number; unemployment: number; regime?: string }[];
  latest_gap: number;
  latest_implied: number;
  latest_actual: number;
  generated_at: string;
  error?: string;
}

// Classical Taylor Rule: r = r* + π + 0.5(π − π*) + 0.5(y − y*)
// Simplified: r = 2 + π + 0.5·(π − 2) + 0.5·outputGap
// = 2 + 1.5·(π − 2) + 2 + 0.5·outputGap ... but traditionally:
// r = r* + π* + 1.5·(π − π*) + 0.5·(y − y*)
// with r*=2, π*=2: r = 2 + 2 + 1.5·inflGap + 0.5·outputGap = 4 + 1.5·inflGap + 0.5·outputGap
// But our inflation is YoY %, and inflationGap = inflation - 2
// Classic: intercept=4 (r*+π*), β₁=1.5, β₂=0.5
// Note: This uses the "nominal" form. Since our data already has the actual nominal rate,
// we use: implied = r* + π + 1.5·(π - π*) + 0.5·outputGap
// = 2 + inflation + 1.5·(inflation - 2) + 0.5·outputGap
// But that double-counts. The standard textbook form for the nominal rate is:
// i = r* + π* + 1.5·(π - π*) + 0.5·(y - y*) = 2 + 2 + 1.5·inflGap + 0.5·outputGap

const CLASSIC_INTERCEPT = 4; // r* (2%) + π* (2%)
const CLASSIC_INFL_COEFF = 1.5;
const CLASSIC_OUTPUT_COEFF = 0.5;

const YELLEN_INTERCEPT = 4; // r* (2%) + π* (2%)
const YELLEN_INFL_COEFF = 1.0;
const YELLEN_OUTPUT_COEFF = 1.0;

async function fetchTaylorRule(bank: string): Promise<TaylorRuleResult> {
  const { data, error } = await supabase.functions.invoke('taylor-rule', { body: { bank } });
  if (error) throw error;
  return data as TaylorRuleResult;
}

export function TaylorRulePanel() {
  const [bank, setBank] = useState<string>('FED');
  const [showClassic, setShowClassic] = useState(false);
  const [showYellen, setShowYellen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['taylor-rule', bank],
    queryFn: () => fetchTaylorRule(bank),
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  // Compute classic Taylor Rule implied rates from the raw inflation/unemployment data
  const inflTarget = 2.0;
  const unempTarget = bank === 'FED' ? 4.4 : 6.1;

  const chartData = useMemo(() => {
    if (!data?.time_series) return [];
    return data.time_series.map(d => {
      const inflGap = d.inflation - inflTarget;
      const outputGap = -(d.unemployment - unempTarget);
      return {
        ...d,
        classic_rate: Math.round((CLASSIC_INTERCEPT + CLASSIC_INFL_COEFF * inflGap + CLASSIC_OUTPUT_COEFF * outputGap) * 1000) / 1000,
        yellen_rate: Math.round((YELLEN_INTERCEPT + YELLEN_INFL_COEFF * inflGap + YELLEN_OUTPUT_COEFF * outputGap) * 1000) / 1000,
      };
    });
  }, [data, bank]);

  const gap = data?.latest_gap ?? 0;
  const GapIcon = gap > 0.15 ? TrendingUp : gap < -0.15 ? TrendingDown : Minus;
  const gapColor = gap > 0.15 ? 'text-signal-hawkish' : gap < -0.15 ? 'text-signal-dovish' : 'text-signal-neutral';
  const gapLabel = gap > 0.15 ? 'Rate Below Taylor Rule' : gap < -0.15 ? 'Rate Above Taylor Rule' : 'Near Taylor Rule';

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-chart-4" />
          <h3 className="text-sm font-semibold">Taylor Rule Benchmark</h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
              <Switch
                checked={showClassic}
                onCheckedChange={setShowClassic}
                className="h-4 w-7 data-[state=checked]:bg-chart-2"
              />
              <span className="text-[9px] text-muted-foreground">Classic (β₁=1.5)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch
                checked={showYellen}
                onCheckedChange={setShowYellen}
                className="h-4 w-7 data-[state=checked]:bg-chart-5"
              />
              <span className="text-[9px] text-muted-foreground">Yellen (β₂=1.0)</span>
            </div>
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FED">Fed</SelectItem>
              <SelectItem value="ECB">ECB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Two-regime OLS: estimates separate coefficients for normal (rate ≥ 0.5%) vs ZLB periods to correct censoring bias
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
          {/* Normal regime coefficients */}
          <div>
            <p className="text-[9px] text-muted-foreground mb-1.5 uppercase tracking-wider">Normal Regime (rate ≥ 0.5%){data.normal_regime ? ` · n=${data.normal_regime.sample_size}` : ''}</p>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md bg-surface p-2 text-center">
                <p className="text-[8px] text-muted-foreground">Intercept (α)</p>
                <p className="text-xs font-mono font-bold text-foreground">{data.coefficients.intercept.toFixed(3)}</p>
              </div>
              <div className="rounded-md bg-surface p-2 text-center">
                <p className="text-[8px] text-muted-foreground">Inflation Gap (β₁)</p>
                <p className="text-xs font-mono font-bold text-foreground">{data.coefficients.inflation_gap.toFixed(3)}</p>
              </div>
              <div className="rounded-md bg-surface p-2 text-center">
                <p className="text-[8px] text-muted-foreground">Output Gap (β₂)</p>
                <p className="text-xs font-mono font-bold text-foreground">{data.coefficients.output_gap.toFixed(3)}</p>
              </div>
              <div className="rounded-md bg-surface p-2 text-center">
                <p className="text-[8px] text-muted-foreground">R²</p>
                <p className="text-xs font-mono font-bold text-foreground">{(data.normal_regime?.r_squared ?? data.r_squared).toFixed(3)}</p>
              </div>
            </div>
          </div>

          {/* ZLB regime info if available */}
          {data.zlb_regime && (
            <div>
              <p className="text-[9px] text-muted-foreground mb-1.5 uppercase tracking-wider">ZLB Regime (rate &lt; 0.5%) · n={data.zlb_regime.sample_size}</p>
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-md bg-surface/50 p-2 text-center">
                  <p className="text-[8px] text-muted-foreground">Intercept</p>
                  <p className="text-xs font-mono text-muted-foreground">{data.zlb_regime.coefficients.intercept.toFixed(3)}</p>
                </div>
                <div className="rounded-md bg-surface/50 p-2 text-center">
                  <p className="text-[8px] text-muted-foreground">Inflation Gap</p>
                  <p className="text-xs font-mono text-muted-foreground">{data.zlb_regime.coefficients.inflation_gap.toFixed(3)}</p>
                </div>
                <div className="rounded-md bg-surface/50 p-2 text-center">
                  <p className="text-[8px] text-muted-foreground">Output Gap</p>
                  <p className="text-xs font-mono text-muted-foreground">{data.zlb_regime.coefficients.output_gap.toFixed(3)}</p>
                </div>
                <div className="rounded-md bg-surface/50 p-2 text-center">
                  <p className="text-[8px] text-muted-foreground">R²</p>
                  <p className="text-xs font-mono text-muted-foreground">{data.zlb_regime.r_squared.toFixed(3)}</p>
                </div>
              </div>
            </div>
          )}

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
            <LineChart data={chartData}>
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
                  name === 'actual_rate' ? 'Actual Rate' : name === 'classic_rate' ? 'Classic Taylor (β₁=1.5)' : 'Estimated Taylor',
                ]}
              />
              <Line type="monotone" dataKey="actual_rate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="actual_rate" />
              <Line type="monotone" dataKey="implied_rate" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="5 3" dot={false} name="implied_rate" />
              {showClassic && (
                <Line type="monotone" dataKey="classic_rate" stroke="hsl(var(--chart-2))" strokeWidth={1.5} strokeDasharray="2 2" dot={false} name="classic_rate" />
              )}
            </LineChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex items-center gap-4 justify-center text-[10px] flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-primary rounded" />
              <span className="text-muted-foreground">Actual Rate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 rounded" style={{ borderTop: '2px dashed hsl(var(--chart-4))' }} />
              <span className="text-muted-foreground">Estimated Taylor</span>
            </div>
            {showClassic && (
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ borderTop: '2px dotted hsl(var(--chart-2))' }} />
                <span className="text-muted-foreground">Classic (r*=2, β₁=1.5, β₂=0.5)</span>
              </div>
            )}
          </div>

          <p className="text-[9px] text-muted-foreground text-center">
            Sample: {data.sample_start} to {data.sample_end} · Generated {new Date(data.generated_at).toLocaleString()}
          </p>
        </>
      ) : null}
    </div>
  );
}
