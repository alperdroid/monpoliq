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
import { toast } from 'sonner';

/** Known speaker reference data — metrics computed from real items */
const SPEAKER_REFS = [
  { name: 'Jerome Powell', patterns: ['powell'], role: 'Chair', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Christopher Waller', patterns: ['waller'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Michelle Bowman', patterns: ['bowman'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'John Williams', patterns: ['williams'], role: 'President', institution: 'Fed Reserve Bank of New York', bank: 'FED' },
  { name: 'Lisa Cook', patterns: ['cook'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Adriana Kugler', patterns: ['kugler'], role: 'Governor', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Philip Jefferson', patterns: ['jefferson'], role: 'Vice Chair', institution: 'Federal Reserve Board', bank: 'FED' },
  { name: 'Christine Lagarde', patterns: ['lagarde'], role: 'President', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Isabel Schnabel', patterns: ['schnabel'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Piero Cipollone', patterns: ['cipollone'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Philip Lane', patterns: ['lane'], role: 'Chief Economist', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Luis de Guindos', patterns: ['guindos'], role: 'Vice-President', institution: 'European Central Bank', bank: 'ECB' },
  { name: 'Frank Elderson', patterns: ['elderson'], role: 'Executive Board Member', institution: 'European Central Bank', bank: 'ECB' },
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

  return SPEAKER_REFS.map(ref => {
    const matched = items.filter(i => {
      const tl = i.title.toLowerCase();
      return i.bank === ref.bank && ref.patterns.some(p => tl.includes(p));
    });

    const scored = matched.filter(i => Math.abs(i.net_score) > 0.001);
    const avgTone = scored.length ? Math.round(scored.reduce((s, i) => s + i.net_score, 0) / scored.length * 1000) / 1000 : 0;
    const recent30 = matched.filter(i => i.item_date >= cs30);
    const recent30Scored = recent30.filter(i => Math.abs(i.net_score) > 0.001);
    const recentAvg = recent30Scored.length ? Math.round(recent30Scored.reduce((s, i) => s + i.net_score, 0) / recent30Scored.length * 1000) / 1000 : 0;
    const toneChange = recent30Scored.length ? Math.round((recentAvg - avgTone) * 1000) / 1000 : 0;
    const latest = matched[0]?.item_date || '';

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
  }).filter(s => s.communication_count > 0);
}

const Speakers = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const { data: commItems = [], isLoading } = useQuery({
    queryKey: ['comm-items-all'],
    queryFn: () => getCommunicationItems(),
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const speakers = useMemo(() => deriveSpeakers(commItems), [commItems]);

  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/speaker-scraper`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ speakers: ['powell', 'lagarde'], maxItems: 25 }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      return resp.json();
    },
    onSuccess: (data) => {
      toast.success(`Scraped ${data.new_items} new communications`);
      queryClient.invalidateQueries({ queryKey: ['comm-items-all'] });
      queryClient.invalidateQueries({ queryKey: ['all-sentiment-items'] });
    },
    onError: (err: Error) => {
      toast.error(`Scraping failed: ${err.message}`);
    },
  });

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => scrapeMutation.mutate()}
            disabled={scrapeMutation.isPending}
            className="text-xs h-7"
          >
            {scrapeMutation.isPending ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Scraping...</>
            ) : (
              <><Download className="w-3 h-3 mr-1" />Scrape Powell & Lagarde</>
            )}
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {isLoading ? 'Loading...' : `${filtered.length} speakers found`}
          </span>
        </div>
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
