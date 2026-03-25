import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, ReferenceLine, CartesianGrid, AreaChart, Area, LineChart, Line } from 'recharts';
import { TrendingUp, Activity } from 'lucide-react';

interface OISPoint {
  horizon: string;
  ois_rate: number;
  model_rate: number;
}

interface OISData {
  fed: OISPoint[];
  ecb: OISPoint[];
  market_date: string;
  notes: string;
  generated_at: string;
  error?: string;
}

async function fetchOISCurve(): Promise<OISData> {
  const { data, error } = await supabase.functions.invoke('ois-curve', { body: {} });
  if (error) throw error;
  return data as OISData;
}

function CurveChart({ data, bank }: { data: OISPoint[]; bank: string }) {
  const chartData = data.map(d => ({
    ...d,
    gap: Math.round((d.ois_rate - d.model_rate) * 100) / 100,
  }));

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="horizon" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '10px',
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(2)}%`,
              name === 'ois_rate' ? 'Market OIS' : name === 'model_rate' ? 'Model Fundamental' : 'Gap',
            ]}
          />
          <Area
            type="monotone"
            dataKey="model_rate"
            stroke="hsl(var(--chart-4))"
            fill="hsl(var(--chart-4) / 0.1)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ r: 4, fill: 'hsl(var(--chart-4))' }}
            name="model_rate"
          />
          <Area
            type="monotone"
            dataKey="ois_rate"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary) / 0.15)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'hsl(var(--primary))' }}
            name="ois_rate"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Gap indicator row */}
      <div className="flex gap-2 justify-center">
        {chartData.map((d, i) => (
          <div key={i} className="text-center">
            <p className="text-[9px] text-muted-foreground">{d.horizon}</p>
            <p className={cn(
              'text-[10px] font-mono font-bold',
              d.gap > 0.05 ? 'text-signal-hawkish' : d.gap < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {d.gap > 0 ? '+' : ''}{d.gap.toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OISOverlayChart() {
  const [bankView, setBankView] = useState<'FED' | 'ECB'>('FED');

  const { data, isLoading } = useQuery({
    queryKey: ['ois-curve'],
    queryFn: fetchOISCurve,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  return (
    <div className="rounded-lg border border-prediction/30 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-prediction" />
          <h3 className="text-sm font-semibold">OIS Market Pricing vs Model</h3>
        </div>
        <Tabs value={bankView} onValueChange={v => setBankView(v as 'FED' | 'ECB')}>
          <TabsList className="h-7">
            <TabsTrigger value="FED" className="text-xs px-3 h-6">Fed</TabsTrigger>
            <TabsTrigger value="ECB" className="text-xs px-3 h-6">ECB</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="text-xs text-muted-foreground">
        Real OIS swap-implied forward rates vs fundamental model predictions. Gap = tradeable signal.
      </p>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : data?.error ? (
        <p className="text-xs text-muted-foreground text-center py-6">{data.error}</p>
      ) : data ? (
        <>
          <CurveChart data={bankView === 'FED' ? data.fed : data.ecb} bank={bankView} />

          {/* Legend */}
          <div className="flex items-center gap-6 justify-center text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-primary rounded" />
              <span className="text-muted-foreground">Market OIS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 rounded" style={{ borderTop: '2px dashed hsl(var(--chart-4))' }} />
              <span className="text-muted-foreground">Model Fundamental</span>
            </div>
          </div>

          {/* Notes */}
          {data.notes && (
            <div className="rounded-md bg-surface p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{data.notes}</p>
            </div>
          )}

          <p className="text-[9px] text-muted-foreground text-center">
            Market date: {data.market_date} · Generated {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        </>
      ) : null}
    </div>
  );
}
