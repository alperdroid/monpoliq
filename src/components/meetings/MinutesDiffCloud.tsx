import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Plus, Minus } from 'lucide-react';

interface Phrase {
  text: string;
  weight: number;
  category: string;
}

interface DiffEntry {
  text: string;
  significance: string;
}

interface MinutesDiffResult {
  bank: string;
  current: { date: string; title: string; score: number; phrases: Phrase[] } | null;
  previous: { date: string; title: string; score: number; phrases: Phrase[] } | null;
  added: DiffEntry[];
  removed: DiffEntry[];
  summary: string;
  generated_at: string;
  error?: string;
}

async function fetchMinutesDiff(bank: string): Promise<MinutesDiffResult> {
  const { data, error } = await supabase.functions.invoke('minutes-diff', {
    body: { bank },
  });
  if (error) throw error;
  return data as MinutesDiffResult;
}

function WordCloud({ phrases, addedTexts, removedTexts }: { phrases: Phrase[]; addedTexts: Set<string>; removedTexts: Set<string> }) {
  const maxWeight = Math.max(...phrases.map(p => p.weight), 1);

  return (
    <div className="flex flex-wrap gap-1.5 p-3 min-h-[120px]">
      {phrases.map((phrase, i) => {
        const size = 10 + (phrase.weight / maxWeight) * 10;
        const isAdded = addedTexts.has(phrase.text.toLowerCase());
        const isRemoved = removedTexts.has(phrase.text.toLowerCase());
        return (
          <span
            key={i}
            className={cn(
              'inline-block px-1.5 py-0.5 rounded transition-all cursor-default',
              isAdded && 'bg-data-positive/20 text-data-positive font-semibold ring-1 ring-data-positive/30',
              isRemoved && 'bg-data-negative/20 text-data-negative font-semibold ring-1 ring-data-negative/30',
              !isAdded && !isRemoved && 'text-muted-foreground',
            )}
            style={{ fontSize: `${size}px` }}
            title={`Weight: ${phrase.weight} | Category: ${phrase.category}`}
          >
            {phrase.text}
          </span>
        );
      })}
    </div>
  );
}

export function MinutesDiffCloud() {
  const [bank, setBank] = useState<string>('FED');

  const { data, isLoading } = useQuery({
    queryKey: ['minutes-diff', bank],
    queryFn: () => fetchMinutesDiff(bank),
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const addedTexts = new Set((data?.added || []).map(a => a.text.toLowerCase()));
  const removedTexts = new Set((data?.removed || []).map(r => r.text.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Minutes Language Diff</h3>
        </div>
        <Select value={bank} onValueChange={setBank}>
          <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : data?.error || !data?.current || !data?.previous ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          {data?.error || 'Not enough minutes data available for comparison'}
        </p>
      ) : (
        <>
          {/* Side-by-side word clouds */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-card">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Previous — {new Date(data.previous.date + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                </p>
                <p className="text-[9px] text-muted-foreground truncate">{data.previous.title}</p>
              </div>
              <WordCloud phrases={data.previous.phrases} addedTexts={new Set()} removedTexts={removedTexts} />
            </div>
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-card">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Current — {data.current.date}
                </p>
                <p className="text-[9px] text-muted-foreground truncate">{data.current.title}</p>
              </div>
              <WordCloud phrases={data.current.phrases} addedTexts={addedTexts} removedTexts={new Set()} />
            </div>
          </div>

          {/* Summary */}
          {data.summary && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs text-foreground leading-relaxed">{data.summary}</p>
            </div>
          )}

          {/* Key Changes */}
          <div className="grid md:grid-cols-2 gap-3">
            {data.added.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-data-positive font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> New Phrases
                </p>
                {data.added.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded bg-data-positive/5">
                    <span className="font-medium text-data-positive whitespace-nowrap">"{item.text}"</span>
                    <span className="text-muted-foreground text-[10px]">{item.significance}</span>
                  </div>
                ))}
              </div>
            )}
            {data.removed.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-data-negative font-medium flex items-center gap-1">
                  <Minus className="w-3 h-3" /> Removed Phrases
                </p>
                {data.removed.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded bg-data-negative/5">
                    <span className="font-medium text-data-negative whitespace-nowrap">"{item.text}"</span>
                    <span className="text-muted-foreground text-[10px]">{item.significance}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
