import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { AlertTriangle, ArrowUp, ArrowDown, TrendingUp } from 'lucide-react';

interface DissentRecord {
  id: string;
  bank: string;
  meeting_date: string;
  member_name: string;
  dissent_direction: 'hawkish' | 'dovish';
  preferred_action: string | null;
  committee_action: string | null;
  notes: string | null;
}

interface MemberDissentProfile {
  name: string;
  totalDissents: number;
  hawkishDissents: number;
  dovishDissents: number;
  dissentRate: number; // dissents / total meetings they could have voted in
  lastDissent: string;
  dissents: DissentRecord[];
}

export function DissentTimeline() {
  const { data: dissents = [], isLoading } = useQuery({
    queryKey: ['dissent-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dissent_history')
        .select('*')
        .eq('bank', 'FED')
        .order('meeting_date', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DissentRecord[];
    },
  });

  // Member profiles
  const profiles = useMemo<MemberDissentProfile[]>(() => {
    const byMember: Record<string, DissentRecord[]> = {};
    for (const d of dissents) {
      if (!byMember[d.member_name]) byMember[d.member_name] = [];
      byMember[d.member_name].push(d);
    }
    return Object.entries(byMember)
      .map(([name, recs]) => ({
        name,
        totalDissents: recs.length,
        hawkishDissents: recs.filter(r => r.dissent_direction === 'hawkish').length,
        dovishDissents: recs.filter(r => r.dissent_direction === 'dovish').length,
        dissentRate: recs.length / 8, // approximate: ~8 meetings/year
        lastDissent: recs[0].meeting_date,
        dissents: recs,
      }))
      .sort((a, b) => b.totalDissents - a.totalDissents);
  }, [dissents]);

  // Timeline data grouped by year
  const byYear = useMemo(() => {
    const years: Record<string, DissentRecord[]> = {};
    for (const d of dissents) {
      const y = d.meeting_date.slice(0, 4);
      if (!years[y]) years[y] = [];
      years[y].push(d);
    }
    return Object.entries(years).sort(([a], [b]) => b.localeCompare(a));
  }, [dissents]);

  // Stats
  const totalHawkish = dissents.filter(d => d.dissent_direction === 'hawkish').length;
  const totalDovish = dissents.filter(d => d.dissent_direction === 'dovish').length;
  const hawkishPct = dissents.length > 0 ? Math.round((totalHawkish / dissents.length) * 100) : 0;

  if (isLoading) {
    return <div className="text-xs text-muted-foreground animate-pulse p-4">Loading dissent history…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Dissents</span>
          <p className="text-2xl font-mono font-bold text-foreground">{dissents.length}</p>
          <p className="text-[9px] text-muted-foreground">2015–2026</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hawkish Dissents</span>
          <p className="text-2xl font-mono font-bold text-signal-hawkish">{totalHawkish}</p>
          <p className="text-[9px] text-muted-foreground">{hawkishPct}% of all dissents</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Dovish Dissents</span>
          <p className="text-2xl font-mono font-bold text-signal-dovish">{totalDovish}</p>
          <p className="text-[9px] text-muted-foreground">{100 - hawkishPct}% of all dissents</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Unique Dissenters</span>
          <p className="text-2xl font-mono font-bold text-primary">{profiles.length}</p>
          <p className="text-[9px] text-muted-foreground">Distinct members</p>
        </div>
      </div>

      {/* Dissent Direction Split Bar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Dissent Direction Split</span>
        <div className="flex h-7 rounded overflow-hidden">
          <div
            className="bg-signal-hawkish flex items-center justify-center transition-all"
            style={{ width: `${hawkishPct}%` }}
          >
            <span className="text-[10px] font-mono font-bold text-signal-hawkish-fg flex items-center gap-1">
              <ArrowUp className="w-3 h-3" /> {hawkishPct}% Hawkish
            </span>
          </div>
          <div
            className="bg-signal-dovish flex items-center justify-center transition-all"
            style={{ width: `${100 - hawkishPct}%` }}
          >
            <span className="text-[10px] font-mono font-bold text-signal-dovish-fg flex items-center gap-1">
              <ArrowDown className="w-3 h-3" /> {100 - hawkishPct}% Dovish
            </span>
          </div>
        </div>
      </div>

      {/* Member Dissent Profiles */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-surface flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Serial Dissenters — Member Profiles</span>
        </div>
        <div className="grid grid-cols-12 gap-2 p-3 bg-surface text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
          <div className="col-span-3">Member</div>
          <div className="col-span-2 text-center">Total</div>
          <div className="col-span-3 text-center">Direction</div>
          <div className="col-span-2 text-center">Last Dissent</div>
          <div className="col-span-2 text-center">Lean</div>
        </div>
        {profiles.map(p => (
          <div key={p.name} className="grid grid-cols-12 gap-2 p-3 border-b border-border last:border-0 text-xs items-center">
            <div className="col-span-3 font-medium">{p.name}</div>
            <div className="col-span-2 text-center font-mono font-bold">{p.totalDissents}</div>
            <div className="col-span-3 flex justify-center gap-1">
              {p.hawkishDissents > 0 && (
                <span className="text-[9px] bg-signal-hawkish/15 text-signal-hawkish border border-signal-hawkish/25 px-1.5 py-0.5 rounded font-mono">
                  {p.hawkishDissents}H
                </span>
              )}
              {p.dovishDissents > 0 && (
                <span className="text-[9px] bg-signal-dovish/15 text-signal-dovish border border-signal-dovish/25 px-1.5 py-0.5 rounded font-mono">
                  {p.dovishDissents}D
                </span>
              )}
            </div>
            <div className="col-span-2 text-center font-mono text-muted-foreground text-[10px]">
              {new Date(p.lastDissent).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </div>
            <div className="col-span-2 flex justify-center">
              <SignalBadge
                label={p.hawkishDissents > p.dovishDissents ? 'HAWK' : p.dovishDissents > p.hawkishDissents ? 'DOVE' : 'MIXED'}
                variant={p.hawkishDissents > p.dovishDissents ? 'hawkish' : p.dovishDissents > p.hawkishDissents ? 'dovish' : 'neutral'}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Voting History Timeline */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-surface flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Dissent Timeline</span>
        </div>
        {byYear.map(([year, records]) => (
          <div key={year}>
            <div className="px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{year} — {records.length} dissent{records.length !== 1 ? 's' : ''}</span>
            </div>
            {records.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0 text-xs">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  r.dissent_direction === 'hawkish' ? 'bg-signal-hawkish' : 'bg-signal-dovish',
                )} />
                <span className="font-mono text-muted-foreground w-20 flex-shrink-0">
                  {new Date(r.meeting_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className="font-medium flex-shrink-0 w-36">{r.member_name}</span>
                <span className="text-muted-foreground flex-1 truncate">
                  Preferred <strong>{r.preferred_action}</strong> vs committee <strong>{r.committee_action}</strong>
                </span>
                <SignalBadge
                  label={r.dissent_direction}
                  variant={r.dissent_direction}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
