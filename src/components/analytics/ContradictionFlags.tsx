import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { AlertOctagon, ChevronDown, ChevronRight } from 'lucide-react';

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

const severityDot: Record<string, string> = {
  high: 'bg-signal-hawkish',
  medium: 'bg-signal-neutral',
  low: 'bg-muted-foreground',
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

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function ContradictionFlags({ bank }: ContradictionFlagsProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

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
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error || !data?.contradictions?.length) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-muted-foreground">
          {error ? 'Contradiction analysis unavailable' : `No contradictions detected for ${bank}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-signal-hawkish" />
          <h4 className="text-xs font-semibold">{bank} Contradictions</h4>
          <span className="text-[10px] bg-signal-hawkish/10 text-signal-hawkish px-1.5 py-0.5 rounded-full font-mono font-semibold">
            {data.contradictions.length}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        {data.contradictions.map((c, i) => {
          const isExpanded = expandedIndex === i;
          return (
            <div key={i} className="rounded-md border border-border bg-surface/50 overflow-hidden">
              {/* Compact row — always visible */}
              <button
                onClick={() => setExpandedIndex(isExpanded ? null : i)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface transition-colors"
              >
                <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', severityDot[c.severity])} />
                <span className="text-xs font-medium flex-shrink-0">{c.speaker}</span>
                <SignalBadge label={typeLabels[c.type]} variant={typeVariants[c.type]} size="sm" />
                <span className="text-[11px] text-muted-foreground truncate flex-1">
                  {truncate(c.explanation, 60)}
                </span>
                {isExpanded
                  ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                }
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2 animate-slide-in">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Earlier{c.earlier_date ? ` · ${c.earlier_date}` : ''}</p>
                      <p className="text-xs leading-relaxed">{c.earlier_statement}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Later{c.later_date ? ` · ${c.later_date}` : ''}</p>
                      <p className="text-xs leading-relaxed">{c.later_statement}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground italic">{c.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
