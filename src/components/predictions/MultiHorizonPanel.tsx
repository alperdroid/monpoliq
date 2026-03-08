import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Clock, Calendar, TrendingUp } from 'lucide-react';

interface HorizonForecast {
  fed: {
    near_term: { direction: string; confidence: number; summary: string };
    meeting: { hike_prob: number; hold_prob: number; cut_prob: number; confidence: number; summary: string };
    policy_path: { bias: string; magnitude: string; confidence: number; summary: string };
  };
  ecb: {
    near_term: { direction: string; confidence: number; summary: string };
    meeting: { hike_prob: number; hold_prob: number; cut_prob: number; confidence: number; summary: string };
    policy_path: { bias: string; magnitude: string; confidence: number; summary: string };
  };
  generated_at?: string;
}

async function fetchMultiHorizon(): Promise<HorizonForecast> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/multi-horizon`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

const dirVariant = (d: string) => d === 'hawkish' ? 'hawkish' : d === 'dovish' ? 'dovish' : 'neutral';
const biasVariant = (b: string) => b === 'tightening' ? 'hawkish' : b === 'easing' ? 'dovish' : 'neutral';

function BankHorizon({ label, data }: { label: string; data: HorizonForecast['fed'] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-primary">{label}</p>

      {/* Near-term */}
      <div className="rounded-md border border-border bg-surface p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">1–7 Day Direction</span>
          <SignalBadge label={data.near_term.direction} variant={dirVariant(data.near_term.direction)} size="sm" className="ml-auto" />
        </div>
        <p className="text-[11px] text-muted-foreground">{data.near_term.summary}</p>
        <div className="flex items-center gap-1">
          <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${data.near_term.confidence * 100}%` }} />
          </div>
          <span className="text-[9px] font-mono text-muted-foreground">{(data.near_term.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Meeting */}
      <div className="rounded-md border border-border bg-surface p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Next Meeting</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-mono font-bold text-signal-hawkish">{(data.meeting.hike_prob * 100).toFixed(0)}%</p>
            <p className="text-[9px] text-muted-foreground">Hike</p>
          </div>
          <div>
            <p className="text-lg font-mono font-bold text-signal-neutral">{(data.meeting.hold_prob * 100).toFixed(0)}%</p>
            <p className="text-[9px] text-muted-foreground">Hold</p>
          </div>
          <div>
            <p className="text-lg font-mono font-bold text-signal-dovish">{(data.meeting.cut_prob * 100).toFixed(0)}%</p>
            <p className="text-[9px] text-muted-foreground">Cut</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{data.meeting.summary}</p>
      </div>

      {/* Policy path */}
      <div className="rounded-md border border-border bg-surface p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">1–3 Month Path</span>
          <SignalBadge label={`${data.policy_path.magnitude} ${data.policy_path.bias}`} variant={biasVariant(data.policy_path.bias)} size="sm" className="ml-auto" />
        </div>
        <p className="text-[11px] text-muted-foreground">{data.policy_path.summary}</p>
        <div className="flex items-center gap-1">
          <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${data.policy_path.confidence * 100}%` }} />
          </div>
          <span className="text-[9px] font-mono text-muted-foreground">{(data.policy_path.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

export function MultiHorizonPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['multi-horizon'],
    queryFn: fetchMultiHorizon,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-sm font-semibold">Computing multi-horizon forecasts...</span>
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Multi-horizon forecasts unavailable</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Multi-Horizon Forecasts</h3>
        </div>
        {data.generated_at && (
          <span className="text-[9px] text-muted-foreground font-mono">
            {new Date(data.generated_at).toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <BankHorizon label="Federal Reserve" data={data.fed} />
        <BankHorizon label="European Central Bank" data={data.ecb} />
      </div>
    </div>
  );
}
