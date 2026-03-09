import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { mockEvents } from '@/data/mock-data';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink } from 'lucide-react';
import type { Bank, EventType } from '@/types/central-bank';

const Events = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return mockEvents.filter(e => {
      if (bankFilter !== 'all' && e.bank !== bankFilter) return false;
      if (typeFilter !== 'all' && e.event_type !== typeFilter) return false;
      if (searchQuery && !e.title.toLowerCase().includes(searchQuery.toLowerCase()) && !e.speaker?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.event_ts).getTime() - new Date(a.event_ts).getTime());
  }, [bankFilter, typeFilter, searchQuery]);

  const eventTypes = [...new Set(mockEvents.map(e => e.event_type))];

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Events Explorer</h1>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length} events</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events, speakers..."
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
          <SelectTrigger className="w-44 h-8 text-xs bg-surface">
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {eventTypes.map(t => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Bank</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Speaker</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Type</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Title</th>
                <th className="text-left p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Tier</th>
                <th className="text-right p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Trust</th>
                <th className="text-right p-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Priority</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr
                  key={event.event_id}
                  className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors cursor-pointer"
                >
                  <td className="p-3 font-mono text-muted-foreground whitespace-nowrap">
                    {new Date(event.event_ts).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                  </td>
                  <td className="p-3">
                    <SignalBadge label={event.bank} variant="info" />
                  </td>
                  <td className="p-3 font-medium">{event.speaker || '—'}</td>
                  <td className="p-3">
                    <span className="text-muted-foreground">{event.event_type.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="p-3 max-w-xs">
                    <Link to={`/events/${event.event_id}`} className="text-foreground hover:text-primary transition-colors flex items-center gap-1">
                      <span className="truncate">{event.title}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className="text-[10px] text-muted-foreground">{event.source_tier.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="p-3 text-right font-mono">{event.trust_score.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono">
                    <span className={cn(
                      event.signal_priority_score > 0.9 ? 'text-signal-hawkish font-semibold' : 'text-muted-foreground'
                    )}>
                      {event.signal_priority_score.toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Events;
