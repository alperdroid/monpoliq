import { useParams, Link } from 'react-router-dom';
import { mockEvents } from '@/data/mock-data';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const EventDetail = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const event = mockEvents.find(e => e.event_id === eventId);

  if (!event) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Event not found</p>
      </div>
    );
  }

  const relatedBySpeaker = mockEvents.filter(e => e.speaker === event.speaker && e.event_id !== event.event_id);
  const relatedByMeeting = mockEvents.filter(e => e.linked_meeting_date === event.linked_meeting_date && e.event_id !== event.event_id && e.bank === event.bank);

  return (
    <div className="space-y-6 animate-slide-in max-w-5xl">
      <Link to="/events" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Events
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SignalBadge label={event.bank} variant="info" size="md" />
            <SignalBadge label={event.event_type.replace(/_/g, ' ')} variant="neutral" size="md" />
            {event.is_core_policy_signal && <SignalBadge label="Core Signal" variant="hawkish" size="md" />}
          </div>
          <h1 className="text-xl font-semibold">{event.title}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {event.speaker && <span className="font-medium text-foreground">{event.speaker}</span>}
            {event.speaker_role && <span>{event.speaker_role}</span>}
            <span>•</span>
            <span className="font-mono">{new Date(event.event_ts).toLocaleString()}</span>
          </div>
        </div>
        <a href={event.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0">
          Source <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Metrics */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Signal Breakdown</h3>
            {event.metrics ? (
              <div className="space-y-4">
                <StanceGauge value={event.metrics.stance} label="Stance" size="md" />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <MetricCard label="Guidance Strength" value={`${(event.metrics.guidance_strength * 100).toFixed(0)}%`} />
                  <MetricCard label="Inflation Focus" value={`${(event.metrics.inflation_focus * 100).toFixed(0)}%`} />
                  <MetricCard label="Growth Focus" value={`${(event.metrics.growth_focus * 100).toFixed(0)}%`} />
                  <MetricCard label="Uncertainty" value={`${(event.metrics.uncertainty * 100).toFixed(0)}%`} />
                  <MetricCard label="QT Signal" value={`${(event.metrics.qt_signal * 100).toFixed(0)}%`} />
                  <MetricCard label="Trust Score" value={event.trust_score.toFixed(3)} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Metrics pending algorithm integration</p>
            )}
          </div>

          {/* Full text */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Communication Text</h3>
            {event.summary && (
              <div className="bg-surface rounded p-3 mb-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Summary</p>
                <p className="text-sm">{event.summary}</p>
              </div>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">{event.clean_text}</p>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Event Metadata</h3>
            <div className="space-y-2 text-xs">
              {[
                ['Institution', event.institution],
                ['Source Tier', event.source_tier.replace(/_/g, ' ')],
                ['Trust Score', event.trust_score.toFixed(3)],
                ['Priority Score', event.signal_priority_score.toFixed(2)],
                ['Linked Meeting', event.linked_meeting_date || '—'],
                ['Days to Meeting', event.link_distance_days?.toString() || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {relatedBySpeaker.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">By {event.speaker}</h3>
              <div className="space-y-2">
                {relatedBySpeaker.map(e => (
                  <Link key={e.event_id} to={`/events/${e.event_id}`} className="block text-xs text-foreground hover:text-primary transition-colors truncate">
                    <span className="text-muted-foreground font-mono mr-1.5">
                      {new Date(e.event_ts).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                    </span>
                    {e.title}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {relatedByMeeting.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Same Meeting Cycle</h3>
              <div className="space-y-2">
                {relatedByMeeting.map(e => (
                  <Link key={e.event_id} to={`/events/${e.event_id}`} className="block text-xs text-foreground hover:text-primary transition-colors truncate">
                    <span className="text-muted-foreground font-mono mr-1.5">
                      {new Date(e.event_ts).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                    </span>
                    {e.title}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventDetail;
