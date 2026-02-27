import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { mockSpeakers } from '@/data/mock-data';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { TrendChip } from '@/components/analytics/TrendChip';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, User } from 'lucide-react';

const Speakers = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return mockSpeakers.filter(s => {
      if (bankFilter !== 'all' && s.bank !== bankFilter) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.market_impact_score - a.market_impact_score);
  }, [bankFilter, searchQuery]);

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Speaker Intelligence</h1>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length} speakers</span>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search speakers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs w-48 bg-surface" />
        </div>
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-28 h-8 text-xs bg-surface"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((speaker) => (
          <div key={speaker.id} className="rounded-lg border border-border bg-card p-4 space-y-3 hover:border-primary/30 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{speaker.name}</p>
                  <p className="text-[11px] text-muted-foreground">{speaker.role}</p>
                </div>
              </div>
              <SignalBadge label={speaker.bank} variant="info" />
            </div>

            <p className="text-[10px] text-muted-foreground">{speaker.institution}</p>

            <StanceGauge value={speaker.average_tone} label="Average Tone" size="sm" showLabels={false} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Credibility</p>
                <p className="text-sm font-mono font-semibold">{(speaker.credibility_score * 100).toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Market Impact</p>
                <p className="text-sm font-mono font-semibold">{(speaker.market_impact_score * 100).toFixed(0)}%</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <TrendChip
                label="Tone Δ"
                value={speaker.recent_tone_change > 0 ? `+${speaker.recent_tone_change.toFixed(2)}` : speaker.recent_tone_change.toFixed(2)}
                direction={speaker.recent_tone_change > 0 ? 'up' : speaker.recent_tone_change < 0 ? 'down' : 'flat'}
                variant={speaker.recent_tone_change > 0.05 ? 'hawkish' : speaker.recent_tone_change < -0.05 ? 'dovish' : 'neutral'}
              />
              <TrendChip
                label="vs Official"
                value={speaker.vs_official_stance > 0 ? `+${speaker.vs_official_stance.toFixed(2)}` : speaker.vs_official_stance.toFixed(2)}
                variant={Math.abs(speaker.vs_official_stance) > 0.15 ? 'hawkish' : 'neutral'}
              />
            </div>

            <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
              <span>{speaker.communication_count_30d} comms (30d)</span>
              <span className="font-mono">Latest: {new Date(speaker.latest_communication_date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Speakers;
