import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { AlertOctagon } from 'lucide-react';

interface Contradiction {
  speaker: string;
  type: 'self_contradiction' | 'official_contradiction' | 'soft_contradiction';
  severity: 'high' | 'medium' | 'low';
  earlier_statement: string;
  later_statement: string;
  earlier_date?: string;
  later_date?: string;
  explanation: string;
}

interface ContradictionResult {
  contradictions: Contradiction[];
  summary: string;
  bank: string;
  generated_at: string;
}

async function fetchContradictions(bank: string): Promise<ContradictionResult> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/contradiction-detector`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

const severityStyles: Record<string, string> = {
  high: 'border-signal-hawkish/30 bg-signal-hawkish/5',
  medium: 'border-signal-neutral/30 bg-signal-neutral/5',
  low: 'border-border bg-surface',
};

const typeLabels: Record<string, string> = {
  self_contradiction: 'Self',
  official_contradiction: 'vs Official',
  soft_contradiction: 'Soft Shift',
};

const typeVariants: Record<string, 'hawkish' | 'neutral' | 'info'> = {
  self_contradiction: 'hawkish',
  official_contradiction: 'neutral',
  soft_contradiction: 'info',
};

interface ContradictionFlagsProps {
  bank: string;
}

export function ContradictionFlags({ bank }: ContradictionFlagsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['contradictions', bank],
    queryFn: () => fetchContradictions(bank),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
          <span className="text-xs text-muted-foreground">Analyzing contradictions for {bank}...</span>
        </div>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error || !data?.contradictions?.length) {
    return (
      <div className="text-center py-3">
        <p className="text-[11px] text-muted-foreground">
          {error ? 'Contradiction analysis unavailable' : `No contradictions detected for ${bank}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-signal-hawkish" />
          <h4 className="text-xs font-semibold">{bank} Contradiction Flags</h4>
          <span className="text-[9px] text-muted-foreground">{data.contradictions.length} detected</span>
        </div>
        {data.generated_at && (
          <span className="text-[9px] text-muted-foreground font-mono">
            {new Date(data.generated_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {data.summary && (
        <p className="text-[11px] text-muted-foreground italic">{data.summary}</p>
      )}

      <div className="space-y-2">
        {data.contradictions.map((c, i) => (
          <div key={i} className={cn('rounded-md border p-3 space-y-1.5', severityStyles[c.severity])}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold capitalize">{c.speaker}</span>
              <SignalBadge label={typeLabels[c.type]} variant={typeVariants[c.type]} size="sm" />
              <SignalBadge
                label={c.severity}
                variant={c.severity === 'high' ? 'hawkish' : c.severity === 'medium' ? 'neutral' : 'info'}
                size="sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Earlier</p>
                <p className="text-[11px]">{c.earlier_statement}</p>
                {c.earlier_date && <p className="text-[9px] font-mono text-muted-foreground">{c.earlier_date}</p>}
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Later</p>
                <p className="text-[11px]">{c.later_statement}</p>
                {c.later_date && <p className="text-[9px] font-mono text-muted-foreground">{c.later_date}</p>}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{c.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
