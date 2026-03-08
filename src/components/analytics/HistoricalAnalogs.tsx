import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { History, ArrowRight } from 'lucide-react';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Analog {
  title: string;
  date: string;
  score?: number;
  similarity_reason: string;
  what_happened_next: string;
  next_decision: string;
  tone_shift: 'hawkish' | 'dovish' | 'stable';
  market_reaction?: string;
}

interface AnalogResult {
  analogs: Analog[];
  pattern_summary: string;
  source_event: { title: string; date: string; bank: string };
  generated_at: string;
}

async function fetchAnalogs(event_title: string, event_date: string, event_score: number, bank: string): Promise<AnalogResult> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/historical-analogs`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_title, event_date, event_score, bank }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

const toneVariant = (t: string) => t === 'hawkish' ? 'hawkish' : t === 'dovish' ? 'dovish' : 'neutral';

export function HistoricalAnalogs() {
  const [selectedBank, setSelectedBank] = useState<string>('FED');
  const [selectedEvent, setSelectedEvent] = useState<string>('');

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const recentComms = allItems
    .filter(i => i.bank === selectedBank && !i.is_statistical)
    .slice(0, 20);

  const currentEvent = recentComms.find(i => i.title === selectedEvent) || recentComms[0];

  const { data: result, isLoading, error } = useQuery({
    queryKey: ['historical-analogs', currentEvent?.title, selectedBank],
    queryFn: () => currentEvent
      ? fetchAnalogs(currentEvent.title, currentEvent.item_date, currentEvent.net_score, selectedBank)
      : Promise.reject('No event'),
    enabled: !!currentEvent,
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-prediction" />
        <h3 className="text-sm font-semibold">Closest Historical Analogs</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={selectedBank} onValueChange={v => { setSelectedBank(v); setSelectedEvent(''); }}>
          <SelectTrigger className="w-24 h-8 text-xs bg-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
        {recentComms.length > 0 && (
          <Select value={selectedEvent || recentComms[0]?.title || ''} onValueChange={setSelectedEvent}>
            <SelectTrigger className="w-72 h-8 text-xs bg-surface"><SelectValue placeholder="Select event..." /></SelectTrigger>
            <SelectContent>
              {recentComms.map((item, i) => (
                <SelectItem key={i} value={item.title}>
                  <span className="truncate">{item.item_date}: {item.title.slice(0, 50)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {result?.analogs && (
        <div className="space-y-3">
          {result.pattern_summary && (
            <p className="text-[11px] text-muted-foreground italic bg-surface rounded-md p-2">
              {result.pattern_summary}
            </p>
          )}
          {result.analogs.map((analog, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{analog.title}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{analog.date}</p>
                </div>
                <SignalBadge label={analog.tone_shift} variant={toneVariant(analog.tone_shift)} size="sm" />
              </div>
              <p className="text-[11px] text-muted-foreground">{analog.similarity_reason}</p>
              <div className="flex items-center gap-2 text-[10px]">
                <ArrowRight className="w-3 h-3 text-primary" />
                <span className="font-medium">Next: {analog.next_decision}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{analog.what_happened_next}</p>
              {analog.market_reaction && (
                <p className="text-[9px] text-muted-foreground bg-surface rounded px-2 py-1">
                  Market: {analog.market_reaction}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {error && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-4">Historical analogs unavailable</p>
      )}
    </div>
  );
}
