import { cn } from '@/lib/utils';
import { mockMeetingCycles, mockEvents } from '@/data/mock-data';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { Calendar, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

const MeetingCycles = () => {
  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meeting Cycles</h1>
        <span className="text-xs text-muted-foreground font-mono">{mockMeetingCycles.length} meetings</span>
      </div>

      <div className="space-y-6">
        {mockMeetingCycles.map((cycle) => {
          const isPast = cycle.decision !== null;
          const allEvents = [...cycle.pre_meeting_events, ...cycle.post_meeting_events].sort(
            (a, b) => new Date(a.event_ts).getTime() - new Date(b.event_ts).getTime()
          );

          return (
            <div key={cycle.meeting_id} className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-border bg-surface flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-md flex items-center justify-center',
                    isPast ? 'bg-data-positive/10' : 'bg-primary/10',
                  )}>
                    {isPast ? <CheckCircle className="w-4 h-4 text-data-positive" /> : <Clock className="w-4 h-4 text-primary" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {cycle.bank} — {new Date(cycle.meeting_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </h3>
                      <SignalBadge label={cycle.bank} variant="info" />
                      {!isPast && <SignalBadge label="UPCOMING" variant="neutral" size="md" />}
                    </div>
                    {cycle.decision && <p className="text-xs text-muted-foreground mt-0.5">{cycle.decision}</p>}
                  </div>
                </div>
                {cycle.foreshadowed !== null && (
                  <div className="flex items-center gap-1.5">
                    {cycle.foreshadowed ? (
                      <span className="text-[10px] text-data-positive font-medium flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Foreshadowed by members
                      </span>
                    ) : (
                      <span className="text-[10px] text-signal-neutral font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Not foreshadowed
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4 grid lg:grid-cols-2 gap-4">
                {/* Tone Evolution Chart */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Tone Evolution into Meeting</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={cycle.tone_evolution}>
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" domain={[-0.5, 0.6]} />
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
                </div>

                {/* Event Timeline */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Communications ({allEvents.length})
                  </p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {allEvents.length === 0 && <p className="text-xs text-muted-foreground">No linked communications</p>}
                    {allEvents.map(e => (
                      <Link
                        key={e.event_id}
                        to={`/events/${e.event_id}`}
                        className="flex items-center gap-2 text-xs hover:bg-accent/30 rounded p-1.5 transition-colors"
                      >
                        <span className="font-mono text-muted-foreground text-[10px] w-12 flex-shrink-0">
                          {new Date(e.event_ts).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                        </span>
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full flex-shrink-0',
                          new Date(e.event_date) < new Date(cycle.meeting_date) ? 'bg-primary' : 'bg-signal-neutral',
                        )} />
                        <span className="truncate text-foreground">{e.title}</span>
                        {e.is_core_policy_signal && <SignalBadge label="CORE" variant="hawkish" />}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MeetingCycles;
