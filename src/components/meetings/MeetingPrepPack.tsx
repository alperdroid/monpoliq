import { useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { FileDown, Printer, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import type { SentimentItem } from '@/lib/api/sentiment';
import { CENTRAL_BANK_MEETINGS, getUpcomingMeetings } from '@/data/meeting-schedule';

interface MeetingPrepPackProps {
  allItems: SentimentItem[];
}

function computePackData(items: SentimentItem[], bank: string, meetingDate: string) {
  const comms = items.filter(i => i.bank === bank && !i.is_statistical);
  const stats = items.filter(i => i.bank === bank && i.is_statistical);

  const previousMeeting = CENTRAL_BANK_MEETINGS
    .filter(m => m.bank === bank && m.date < meetingDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const sinceStr = previousMeeting?.date || '2000-01-01';
  const todayStr = new Date().toISOString().split('T')[0];
  const endDate = todayStr < meetingDate ? todayStr : meetingDate;
  const recentComms = comms.filter(i => i.item_date > sinceStr && i.item_date <= endDate);
  const recentStats = stats.filter(i => i.item_date > sinceStr && i.item_date <= endDate);

  // Average tone
  const scored = recentComms.filter(i => Math.abs(i.net_score) > 0.001);
  const avgTone = scored.length ? scored.reduce((s, i) => s + i.net_score, 0) / scored.length : 0;

  // Speaker shifts
  const speakerPatterns = ['powell', 'waller', 'bowman', 'williams', 'cook', 'lagarde', 'schnabel', 'lane'];
  const speakerShifts = speakerPatterns.map(sp => {
    const matched = recentComms.filter(i => i.title.toLowerCase().includes(sp));
    const allMatched = comms.filter(i => i.title.toLowerCase().includes(sp));
    const recentAvg = matched.length ? matched.reduce((s, i) => s + i.net_score, 0) / matched.length : null;
    const allAvg = allMatched.length ? allMatched.reduce((s, i) => s + i.net_score, 0) / allMatched.length : null;
    if (recentAvg === null || allAvg === null) return null;
    return { name: sp.charAt(0).toUpperCase() + sp.slice(1), recent: recentAvg, baseline: allAvg, shift: recentAvg - allAvg, count: matched.length };
  }).filter(Boolean) as { name: string; recent: number; baseline: number; shift: number; count: number }[];

  // Label distribution
  const hawks = recentComms.filter(i => i.label?.includes('hawk')).length;
  const doves = recentComms.filter(i => i.label?.includes('dov')).length;
  const neutrals = recentComms.filter(i => i.label === 'neutral').length;

  // Top communications
  const topComms = recentComms
    .sort((a, b) => Math.abs(b.net_score) - Math.abs(a.net_score))
    .slice(0, 8);

  return { recentComms, recentStats, avgTone, speakerShifts, hawks, doves, neutrals, topComms };
}

export function MeetingPrepPack({ allItems }: MeetingPrepPackProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const packs = useMemo(() => {
    const nextByBank = getUpcomingMeetings().reduce((acc, meeting) => {
      if (!acc[meeting.bank]) acc[meeting.bank] = meeting;
      return acc;
    }, {} as Record<string, ReturnType<typeof getUpcomingMeetings>[number]>);

    return Object.values(nextByBank)
      .sort((a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank))
      .map(m => ({
        ...m,
        data: computePackData(allItems, m.bank, m.date),
      }));
  }, [allItems]);

  const handlePrint = () => {
    if (printRef.current) {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
      printWindow.document.write(`
        <html><head><title>Meeting Prep Pack</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a2e; padding: 20px; }
          h1 { font-size: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 4px; }
          h2 { font-size: 13px; margin-top: 16px; color: #2563eb; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          td, th { padding: 4px 8px; border: 1px solid #e2e8f0; text-align: left; font-size: 10px; }
          th { background: #f1f5f9; font-weight: 600; }
          .metric { font-family: monospace; font-weight: 700; }
          .hawk { color: #dc2626; } .dove { color: #059669; } .neutral { color: #d97706; }
          @media print { body { padding: 0; } }
        </style>
        </head><body>${printRef.current.innerHTML}</body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Meeting Prep Pack</h3>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-xs h-7">
          <Printer className="w-3 h-3" /> Print / Save PDF
        </Button>
      </div>

      <div ref={printRef}>
        {packs.map(pack => (
          <div key={pack.id} className="rounded-lg border border-border bg-card p-5 space-y-4 mb-4 break-inside-avoid">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold">{pack.label}</h1>
              <SignalBadge label={pack.bank} variant="info" />
            </div>

            {/* Aggregate Tone */}
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase">Avg Tone</p>
                <p className={cn('text-lg font-mono font-bold',
                  pack.data.avgTone > 0.05 ? 'text-signal-hawkish' : pack.data.avgTone < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral'
                )}>
                  {pack.data.avgTone > 0 ? '+' : ''}{pack.data.avgTone.toFixed(3)}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase">Comms</p>
                <p className="text-lg font-mono font-bold">{pack.data.recentComms.length}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase">Stats</p>
                <p className="text-lg font-mono font-bold">{pack.data.recentStats.length}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase">Distribution</p>
                <div className="flex gap-1 mt-1">
                  <span className="text-[9px] text-signal-hawkish font-mono">{pack.data.hawks}H</span>
                  <span className="text-[9px] text-signal-neutral font-mono">{pack.data.neutrals}N</span>
                  <span className="text-[9px] text-signal-dovish font-mono">{pack.data.doves}D</span>
                </div>
              </div>
            </div>

            {/* Speaker Shifts */}
            {pack.data.speakerShifts.length > 0 && (
              <div>
                <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Speaker Shifts</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {pack.data.speakerShifts.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).map(sp => (
                    <div key={sp.name} className="rounded-md bg-surface border border-border p-2">
                      <p className="text-[10px] font-semibold">{sp.name}</p>
                      <p className={cn('text-xs font-mono',
                        sp.shift > 0.02 ? 'text-signal-hawkish' : sp.shift < -0.02 ? 'text-signal-dovish' : 'text-muted-foreground'
                      )}>
                        {sp.shift > 0 ? '↑' : sp.shift < -0.02 ? '↓' : '→'} {sp.shift > 0 ? '+' : ''}{sp.shift.toFixed(3)}
                      </p>
                      <p className="text-[9px] text-muted-foreground">{sp.count} comms</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Communications */}
            <div>
              <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Key Communications</h2>
              <div className="space-y-1">
                {pack.data.topComms.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-muted-foreground w-16 flex-shrink-0">{item.item_date}</span>
                    <span className="truncate flex-1">{item.title}</span>
                    <span className={cn('font-mono flex-shrink-0',
                      item.net_score > 0.05 ? 'text-signal-hawkish' : item.net_score < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral'
                    )}>
                      {item.net_score > 0 ? '+' : ''}{item.net_score.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
