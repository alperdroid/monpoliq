import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { TopicHeatmap } from '@/components/meetings/TopicHeatmap';
import { NarrativeDrift } from '@/components/meetings/NarrativeDrift';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { CheckCircle, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MeetingPrepPack } from '@/components/meetings/MeetingPrepPack';
import { MinutesDiffCloud } from '@/components/meetings/MinutesDiffCloud';

/** Real central bank meeting dates with verified decisions */
const REAL_MEETINGS = [
  {
    meeting_id: 'ecb-2025-10-30',
    bank: 'ECB' as const,
    meeting_date: '2025-10-30',
    decision: 'Hold — Deposit Facility Rate at 2.00%',
  },
  {
    meeting_id: 'fed-2025-10-29',
    bank: 'FED' as const,
    meeting_date: '2025-10-29',
    decision: 'Cut 25bps — Fed Funds Rate to 3.75–4.00%',
  },
  {
    meeting_id: 'ecb-2025-12-18',
    bank: 'ECB' as const,
    meeting_date: '2025-12-18',
    decision: 'Hold — Deposit Facility Rate at 2.00%',
  },
  {
    meeting_id: 'fed-2025-12-10',
    bank: 'FED' as const,
    meeting_date: '2025-12-10',
    decision: 'Cut 25bps — Fed Funds Rate to 3.50–3.75%',
  },
  {
    meeting_id: 'ecb-2026-02-05',
    bank: 'ECB' as const,
    meeting_date: '2026-02-05',
    decision: 'Hold — Deposit Facility Rate at 2.00%',
  },
  {
    meeting_id: 'fed-2026-01-29',
    bank: 'FED' as const,
    meeting_date: '2026-01-29',
    decision: 'Hold — Fed Funds Rate at 3.50–3.75%',
  },
  {
    meeting_id: 'ecb-2026-03-19',
    bank: 'ECB' as const,
    meeting_date: '2026-03-19',
    decision: 'Hold — Deposit Facility Rate at 2.00%',
  },
  {
    meeting_id: 'fed-2026-03-19',
    bank: 'FED' as const,
    meeting_date: '2026-03-19',
    decision: 'Hold — Fed Funds Rate at 3.50–3.75%',
  },
  // Upcoming meetings
  {
    meeting_id: 'ecb-2026-04-30',
    bank: 'ECB' as const,
    meeting_date: '2026-04-30',
    decision: null,
  },
  {
    meeting_id: 'fed-2026-04-30',
    bank: 'FED' as const,
    meeting_date: '2026-04-30',
    decision: null,
  },
  {
    meeting_id: 'ecb-2026-06-11',
    bank: 'ECB' as const,
    meeting_date: '2026-06-11',
    decision: null,
  },
  {
    meeting_id: 'fed-2026-06-11',
    bank: 'FED' as const,
    meeting_date: '2026-06-11',
    decision: null,
  },
];

/** Link real sentiment items to a meeting as pre/post communications */
function linkItemsToMeeting(
  items: SentimentItem[],
  bank: string,
  meetingDate: string,
  prevMeetingDate: string | null,
  nextMeetingDate: string | null,
) {
  const bankItems = items.filter(i => i.bank === bank && !i.is_statistical);
  const meetingTs = new Date(meetingDate).getTime();

  // Pre-meeting: items between previous meeting (exclusive) and this meeting (inclusive)
  const startDate = prevMeetingDate || '2000-01-01';
  const pre = bankItems.filter(i => i.item_date > startDate && i.item_date <= meetingDate);

  // Post-meeting: items after this meeting but before next meeting
  const endDate = nextMeetingDate || '2099-12-31';
  const post = bankItems.filter(i => i.item_date > meetingDate && i.item_date < endDate);

  return { pre, post };
}

/** Build tone evolution from real scored items leading into a meeting */
function buildToneEvolution(items: SentimentItem[], meetingDate: string) {
  // Look at items in the 30 days before the meeting
  const meetingTs = new Date(meetingDate);
  const startTs = new Date(meetingDate);
  startTs.setDate(startTs.getDate() - 30);
  const startStr = startTs.toISOString().split('T')[0];

  const relevant = items
    .filter(i => i.item_date >= startStr && i.item_date <= meetingDate && Math.abs(i.net_score) > 0.001)
    .sort((a, b) => a.item_date.localeCompare(b.item_date));

  if (relevant.length === 0) return [];

  // Group by date, compute running average
  const byDate: Record<string, number[]> = {};
  for (const item of relevant) {
    if (!byDate[item.item_date]) byDate[item.item_date] = [];
    byDate[item.item_date].push(item.net_score);
  }

  let runningSum = 0;
  let runningCount = 0;
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => {
      runningSum += scores.reduce((s, v) => s + v, 0);
      runningCount += scores.length;
      return {
        date: date.slice(5), // MM-DD
        tone: Math.round((runningSum / runningCount) * 1000) / 1000,
      };
    });
}

const MeetingCycles = () => {
  const [tagging, setTagging] = useState(false);
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const meetings = useMemo(() => {
    const sorted = [...REAL_MEETINGS].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));

    return sorted.map((meeting, idx) => {
      const sameBankMeetings = REAL_MEETINGS
        .filter(m => m.bank === meeting.bank)
        .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
      const myIdx = sameBankMeetings.findIndex(m => m.meeting_id === meeting.meeting_id);
      const prevMeeting = myIdx > 0 ? sameBankMeetings[myIdx - 1].meeting_date : null;
      const nextMeeting = myIdx < sameBankMeetings.length - 1 ? sameBankMeetings[myIdx + 1].meeting_date : null;

      const { pre, post } = linkItemsToMeeting(allItems, meeting.bank, meeting.meeting_date, prevMeeting, nextMeeting);
      const toneEvolution = buildToneEvolution(
        allItems.filter(i => i.bank === meeting.bank),
        meeting.meeting_date,
      );

      // Auto-switch: meeting is past if decision is set OR 5+ days have elapsed since meeting date
      const daysSinceMeeting = (Date.now() - new Date(meeting.meeting_date + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24);
      const isPast = meeting.decision !== null || daysSinceMeeting >= 5;
      const allComms = [...pre, ...post].sort((a, b) => a.item_date.localeCompare(b.item_date));

      return {
        ...meeting,
        isPast,
        preCount: pre.length,
        postCount: post.length,
        allComms,
        toneEvolution,
        prevMeetingDate: prevMeeting,
      };
    });
  }, [allItems]);

  const pastMeetings = meetings.filter(m => m.isPast);
  const upcomingMeetings = meetings.filter(m => !m.isPast);

  const runTopicAnalysis = async () => {
    setTagging(true);
    try {
      const { data, error } = await supabase.functions.invoke('topic-analysis', { body: {} });
      if (error) throw error;
      toast.success(`Tagged ${data?.tagged || 0} items with topics`);
    } catch (e: any) {
      toast.error(e.message || 'Topic analysis failed');
    } finally {
      setTagging(false);
    }
  };

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meeting Cycles</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runTopicAnalysis} disabled={tagging} className="gap-1.5 text-xs h-7">
            {tagging ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {tagging ? 'Tagging…' : 'Run Topic Analysis'}
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {isLoading ? 'Loading…' : `${meetings.length} meetings`}
          </span>
        </div>
      </div>

      {/* Meeting Prep Pack */}
      {allItems.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <MeetingPrepPack allItems={allItems as any} />
        </div>
      )}

      {/* Minutes Language Diff */}
      <div className="rounded-lg border border-border bg-card p-4">
        <MinutesDiffCloud />
      </div>

      {upcomingMeetings.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Upcoming</p>
          {upcomingMeetings.map(meeting => (
            <MeetingCard key={meeting.meeting_id} meeting={meeting} allItems={allItems} />
          ))}
        </div>
      )}

      {pastMeetings.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Past Decisions</p>
          {pastMeetings.map(meeting => (
            <MeetingCard key={meeting.meeting_id} meeting={meeting} allItems={allItems} />
          ))}
        </div>
      )}
    </div>
  );
};

function MeetingCard({ meeting, allItems }: {
  meeting: {
    meeting_id: string;
    bank: string;
    meeting_date: string;
    decision: string | null;
    isPast: boolean;
    preCount: number;
    postCount: number;
    allComms: SentimentItem[];
    toneEvolution: { date: string; tone: number }[];
    prevMeetingDate: string | null;
  };
  allItems: SentimentItem[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border bg-surface flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-8 h-8 rounded-md flex items-center justify-center',
            meeting.isPast ? 'bg-data-positive/10' : 'bg-primary/10',
          )}>
            {meeting.isPast
              ? <CheckCircle className="w-4 h-4 text-data-positive" />
              : <Clock className="w-4 h-4 text-primary" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                {meeting.bank} — {new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <SignalBadge label={meeting.bank} variant="info" />
              {!meeting.isPast && <SignalBadge label="UPCOMING" variant="neutral" size="md" />}
            </div>
            {meeting.decision && (
              <p className="text-xs text-muted-foreground mt-0.5">{meeting.decision}</p>
            )}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {meeting.preCount} pre · {meeting.postCount} post
        </div>
      </div>

      <div className="p-4 grid lg:grid-cols-2 gap-4">
        {/* Tone Evolution Chart */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Tone Evolution (30d into meeting)
          </p>
          {meeting.toneEvolution.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={meeting.toneEvolution}>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '10px',
                  }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                <Line type="monotone" dataKey="tone" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground py-8 text-center">No scored communications in this window</p>
          )}
        </div>

        {/* Linked Communications */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Linked Communications ({meeting.allComms.length})
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {meeting.allComms.length === 0 && (
              <p className="text-xs text-muted-foreground">No linked communications</p>
            )}
            {meeting.allComms.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs hover:bg-accent/30 rounded p-1.5 transition-colors"
              >
                <span className="font-mono text-muted-foreground text-[10px] w-14 flex-shrink-0">
                  {new Date(item.item_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                </span>
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  item.item_date <= meeting.meeting_date ? 'bg-primary' : 'bg-signal-neutral',
                )} />
                <span className="truncate text-foreground">{item.title}</span>
                {item.net_score !== 0 && (
                  <span className={cn(
                    'text-[9px] font-mono flex-shrink-0',
                    item.net_score > 0.05 ? 'text-signal-hawkish' : item.net_score < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
                  )}>
                    {item.net_score > 0 ? '+' : ''}{item.net_score.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Narrative Drift & Pivot Detector */}
      <div className="p-4 border-t border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Narrative Drift & Pivot Radar
        </p>
        <NarrativeDrift
          items={allItems.filter(i => i.bank === meeting.bank)}
          meetingDate={meeting.meeting_date}
          bank={meeting.bank}
          prevMeetingDate={meeting.prevMeetingDate}
        />
      </div>

      {/* Topic Heatmap — only for past meetings with completed policy texts */}
      {meeting.isPast && (
        <div className="p-4 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Topic Heatmap
          </p>
          <TopicHeatmap items={meeting.allComms} meetingDate={meeting.meeting_date} />
        </div>
      )}
    </div>
  );
}

export default MeetingCycles;
