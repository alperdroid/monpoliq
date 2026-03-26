import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface EventRow {
  id: string;
  bank: string;
  source: string;
  title: string;
  item_date: string;
  label: string | null;
  net_score: number | null;
  hawk_pts: number | null;
  dove_pts: number | null;
  is_statistical: boolean;
  url: string | null;
  word_count: number | null;
  topics: string[] | null;
  reasons: string[] | null;
}

const Events = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: events = [], isLoading, isRefetching } = useQuery({
    queryKey: ['events-explorer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sentiment_items')
        .select('id, bank, source, title, item_date, label, net_score, hawk_pts, dove_pts, is_statistical, url, word_count, topics, reasons')
        .order('item_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  const sourceTypes = useMemo(() => [...new Set(events.map(e => e.source))].sort(), [events]);

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (bankFilter !== 'all' && e.bank !== bankFilter) return false;
      if (typeFilter !== 'all' && e.source !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!e.title.toLowerCase().includes(q) && !e.source.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [bankFilter, typeFilter, searchQuery, events]);

  const labelVariant = (label: string | null): 'hawkish' | 'dovish' | 'neutral' | 'info' => {
    if (!label) return 'neutral';
    if (label.includes('hawk')) return 'hawkish';
    if (label.includes('dov')) return 'dovish';
    return 'neutral';
  };

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Events Explorer</h1>
          <TooltipInfo content="Live database of all scraped central bank communications, statistical releases, and policy documents." />
          {(isLoading || isRefetching) && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
        </div>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length} events</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events, sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-56 bg-surface"
          />
        </div>
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-28 h-8 text-xs bg-surface">
            <SelectValue placeholder="Bank" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56 h-8 text-xs bg-surface">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sourceTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-fixed">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[110px]">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[50px]">Bank</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[110px]">Source</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Title</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[80px]">Label</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[160px]">Topics</th>
                <th className="text-right p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[65px]">Score</th>
                <th className="text-right p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px] w-[55px]">Words</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors"
                >
                  <td className="p-3 font-mono text-muted-foreground whitespace-nowrap">
                    {new Date(event.item_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="p-3">
                    <SignalBadge label={event.bank} variant="info" />
                  </td>
                  <td className="p-3">
                    <span className="text-muted-foreground text-[11px]">{event.source}</span>
                  </td>
                  <td className="p-3 overflow-hidden">
                    {event.url ? (
                      <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors flex items-center gap-1 min-w-0">
                        <span className="truncate block">{event.title}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                      </a>
                    ) : (
                      <span className="truncate block">{event.title}</span>
                    )}
                  </td>
                  <td className="p-3">
                    {event.label && (
                      <SignalBadge label={event.label} variant={labelVariant(event.label)} />
                    )}
                  </td>
                  <td className="p-3">
                    {event.topics && event.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {event.topics.slice(0, 2).map(t => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {t.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {event.topics.length > 2 && (
                          <span className="text-[9px] text-muted-foreground">+{event.topics.length - 2}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">
                    <span className={cn(
                      event.net_score && event.net_score > 0.1 ? 'text-signal-hawkish' :
                      event.net_score && event.net_score < -0.1 ? 'text-signal-dovish' :
                      event.net_score && Math.abs(event.net_score) > 0.001 ? 'text-signal-neutral' :
                      'text-muted-foreground'
                    )}>
                      {event.net_score?.toFixed(2) ?? '—'}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-muted-foreground">
                    {event.word_count || '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No events found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Events;
