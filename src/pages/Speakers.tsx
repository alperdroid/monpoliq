import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { TrendChip } from '@/components/analytics/TrendChip';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, User } from 'lucide-react';
import { getCommunicationItems, getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { SpeakerDNAPanel } from '@/components/speakers/SpeakerDNA';

/**
 * Known speaker reference data — metrics computed from real items.
 * `until` marks a departure date: items after it are ignored and the member is
 * dropped from the roster. Independently, anyone with no communication in the
 * last ACTIVE_WINDOW_DAYS is treated as no longer on the committee, so the
 * roster prunes itself month over month without manual edits.
 */
const ACTIVE_WINDOW_DAYS = 120;

const SPEAKER_REFS: { name: string; patterns: string[]; role: string; institution: string; bank: string; until?: string }[] = [
  // Jerome Powell left the Board — kept only for historical matching up to his departure.
  { name: 'Jerome Powell', patterns: ['powell'], role: 'Chair (former)', institution: 'Federal Reserve Board', bank: 'FED', until: '2026-06-01' },
  { name: 'Michael Barr', patterns: ['barr'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },

  { name: 'Christopher Waller', patterns: ['waller'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Michelle Bowman', patterns: ['bowman'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'John Williams', patterns: ['williams'], role: 'President', institution: 'Fed Reserve Bank of New York', bank: 'FED' },
  { name: 'Lisa Cook', patterns: ['cook'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Adriana Kugler', patterns: ['kugler'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Philip Jefferson', patterns: ['jefferson'], role: 'Vice Chair', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Thomas Barkin', patterns: ['barkin'], role: 'President', institution: 'Fed Reserve Bank of Richmond', bank: 'FED' },
  { name: 'Raphael Bostic', patterns: ['bostic'], role: 'President', institution: 'Fed Reserve Bank of Atlanta', bank: 'FED' },
  { name: 'Mary Daly', patterns: ['daly'], role: 'President', institution: 'Fed Reserve Bank of San Francisco', bank: 'FED' },
  { name: 'Austan Goolsbee', patterns: ['goolsbee'], role: 'President', institution: 'Fed Reserve Bank of Chicago', bank: 'FED' },
  { name: 'Neel Kashkari', patterns: ['kashkari'], role: 'President', institution: 'Fed Reserve Bank of Minneapolis', bank: 'FED' },
  { name: 'Alberto Musalem', patterns: ['musalem'], role: 'President', institution: 'Fed Reserve Bank of St. Louis', bank: 'FED' },
  { name: 'Beth Hammack', patterns: ['hammack'], role: 'President', institution: 'Fed Reserve Bank of Cleveland', bank: 'FED' },
  { name: 'Christine Lagarde', patterns: ['lagarde'], role: 'President', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Isabel Schnabel', patterns: ['schnabel'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Piero Cipollone', patterns: ['cipollone'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Philip Lane', patterns: ['lane'], role: 'Chief Economist', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Luis de Guindos', patterns: ['guindos'], role: 'Vice-President', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Frank Elderson', patterns: ['elderson'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Joachim Nagel', patterns: ['nagel'], role: 'President', institution: 'Deutsche Bundesbank', bank: 'ECB' },
  { name: 'François Villeroy de Galhau', patterns: ['villeroy'], role: 'Governor', institution: 'Banque de France', bank: 'ECB' },
  { name: 'Klaas Knot', patterns: ['knot'], role: 'President', institution: 'De Nederlandsche Bank', bank: 'ECB' },
  { name: 'Mário Centeno', patterns: ['centeno'], role: 'Governor', institution: 'Banco de Portugal', bank: 'ECB' },
  { name: 'Mārtiņš Kazāks', patterns: ['kazāks', 'kazaks'], role: 'Governor', institution: 'Bank of Latvia', bank: 'ECB' },
  { name: 'Robert Holzmann', patterns: ['holzmann'], role: 'Governor', institution: 'Oesterreichische Nationalbank', bank: 'ECB' },
  { name: 'Madis Muller', patterns: ['muller', 'müller'], role: 'Governor', institution: 'Bank of Estonia', bank: 'ECB' },
  { name: 'Yannis Stournaras', patterns: ['stournaras'], role: 'Governor', institution: 'Bank of Greece', bank: 'ECB' },
  { name: 'Olli Rehn', patterns: ['rehn'], role: 'Governor', institution: 'Bank of Finland', bank: 'ECB' },
  { name: 'Gediminas Šimkus', patterns: ['simkus', 'šimkus'], role: 'Chairman', institution: 'Bank of Lithuania', bank: 'ECB' },
  { name: 'Boris Vujčić', patterns: ['vujčić', 'vujcic'], role: 'Governor', institution: 'Croatian National Bank', bank: 'ECB' },
  { name: 'Gabriel Makhlouf', patterns: ['makhlouf'], role: 'Governor', institution: 'Central Bank of Ireland', bank: 'ECB' },
  { name: 'Pierre Wunsch', patterns: ['wunsch'], role: 'Governor', institution: 'National Bank of Belgium', bank: 'ECB' },
];

interface DerivedSpeaker {
  name: string;
  role: string;
  institution: string;
  bank: string;
  average_tone: number;
  communication_count: number;
  communication_count_30d: number;
  latest_communication_date: string;
  recent_tone_change: number;
}

function deriveSpeakers(items: SentimentItem[]): DerivedSpeaker[] {
  const cutoff30d = new Date();
  cutoff30d.setDate(cutoff30d.getDate() - 30);
  const cs30 = cutoff30d.toISOString().split('T')[0];
  const activeCutoff = new Date();
  activeCutoff.setDate(activeCutoff.getDate() - ACTIVE_WINDOW_DAYS);
  const csActive = activeCutoff.toISOString().split('T')[0];

  return SPEAKER_REFS.map(ref => {
    const matched = items.filter(i => {
      const tl = i.title.toLowerCase();
      if (i.bank !== ref.bank) return false;
      if (ref.until && i.item_date > ref.until) return false;
      return ref.patterns.some(p => tl.includes(p));
    });

    const scored = matched.filter(i => Math.abs(i.net_score) > 0.001);
    const avgTone = scored.length ? Math.round(scored.reduce((s, i) => s + i.net_score, 0) / scored.length * 1000) / 1000 : 0;
    const recent30 = matched.filter(i => i.item_date >= cs30);
    const recent30Scored = recent30.filter(i => Math.abs(i.net_score) > 0.001);
    const recentAvg = recent30Scored.length ? Math.round(recent30Scored.reduce((s, i) => s + i.net_score, 0) / recent30Scored.length * 1000) / 1000 : 0;
    const toneChange = recent30Scored.length ? Math.round((recentAvg - avgTone) * 1000) / 1000 : 0;
    const latest = matched.reduce((m, i) => (i.item_date > m ? i.item_date : m), '');

    return {
      name: ref.name,
      role: ref.role,
      institution: ref.institution,
      bank: ref.bank,
      average_tone: avgTone,
      communication_count: matched.length,
      communication_count_30d: recent30.length,
      latest_communication_date: latest,
      recent_tone_change: toneChange,
    };
  })
    // Current committee only: must have spoken inside the rolling activity window.
    .filter(s => s.communication_count > 0 && s.latest_communication_date >= csActive);
}


const Speakers = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: commItems = [], isLoading } = useQuery({
    queryKey: ['comm-items-all'],
    queryFn: () => getCommunicationItems(),
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const speakers = useMemo(() => deriveSpeakers(commItems), [commItems]);

  const filtered = useMemo(() => {
    return speakers.filter(s => {
      if (bankFilter !== 'all' && s.bank !== bankFilter) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.communication_count - a.communication_count);
  }, [speakers, bankFilter, searchQuery]);

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Speaker Intelligence</h1>
        <span className="text-xs text-muted-foreground font-mono">
          {isLoading ? 'Loading...' : `${filtered.length} speakers found`}
        </span>
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

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {commItems.length === 0
              ? 'No communication data yet. Run the sentiment analysis from the Communications page first.'
              : 'No speakers match your filters.'}
          </p>
        </div>
      )}

      {/* Speaker DNA Profiles */}
      {allItems.length > 0 && <SpeakerDNAPanel allItems={allItems} bankFilter={bankFilter} />}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((speaker) => (
          <div key={speaker.name} className="rounded-lg border border-border bg-card p-4 space-y-3 hover:border-primary/30 transition-colors">
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
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Comms</p>
                <p className="text-sm font-mono font-semibold">{speaker.communication_count}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">30d Comms</p>
                <p className="text-sm font-mono font-semibold">{speaker.communication_count_30d}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <TrendChip
                label="Tone Δ"
                value={speaker.recent_tone_change > 0 ? `+${speaker.recent_tone_change.toFixed(2)}` : speaker.recent_tone_change.toFixed(2)}
                direction={speaker.recent_tone_change > 0 ? 'up' : speaker.recent_tone_change < 0 ? 'down' : 'flat'}
                variant={speaker.recent_tone_change > 0.05 ? 'hawkish' : speaker.recent_tone_change < -0.05 ? 'dovish' : 'neutral'}
              />
            </div>

            <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
              <span>{speaker.communication_count_30d} comms (30d)</span>
              <span className="font-mono">
                {speaker.latest_communication_date
                  ? `Latest: ${new Date(speaker.latest_communication_date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}`
                  : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Speakers;
