import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { TopicHeatmap, TopicHeatmapMatrix } from '@/components/meetings/TopicHeatmap';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { RefreshCw, Loader2, FileText, Grid3X3 } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/** All past meetings with actual data, sorted oldest → newest */
const PAST_MEETINGS = [
  { id: 'ecb-2025-03-06', bank: 'ECB', date: '2025-03-06', label: 'ECB Mar 2025 — Cut to 2.50%' },
  { id: 'fed-2025-03-19', bank: 'FED', date: '2025-03-19', label: 'FOMC Mar 2025 — Hold at 4.25–4.50%' },
  { id: 'ecb-2025-04-17', bank: 'ECB', date: '2025-04-17', label: 'ECB Apr 2025 — Cut to 2.25%' },
  { id: 'fed-2025-05-07', bank: 'FED', date: '2025-05-07', label: 'FOMC May 2025 — Hold at 4.25–4.50%' },
  { id: 'ecb-2025-06-05', bank: 'ECB', date: '2025-06-05', label: 'ECB Jun 2025 — Cut to 2.00%' },
  { id: 'fed-2025-06-18', bank: 'FED', date: '2025-06-18', label: 'FOMC Jun 2025 — Cut to 4.00–4.25%' },
  { id: 'ecb-2025-07-24', bank: 'ECB', date: '2025-07-24', label: 'ECB Jul 2025 — Hold at 2.00%' },
  { id: 'fed-2025-07-30', bank: 'FED', date: '2025-07-30', label: 'FOMC Jul 2025 — Cut to 3.75–4.00%' },
  { id: 'ecb-2025-09-11', bank: 'ECB', date: '2025-09-11', label: 'ECB Sep 2025 — Hold at 2.00%' },
  { id: 'fed-2025-09-17', bank: 'FED', date: '2025-09-17', label: 'FOMC Sep 2025 — Cut to 3.50–3.75%' },
  { id: 'fed-2025-10-29', bank: 'FED', date: '2025-10-29', label: 'FOMC Oct 2025 — Hold at 3.50–3.75%' },
  { id: 'ecb-2025-10-30', bank: 'ECB', date: '2025-10-30', label: 'ECB Oct 2025 — Hold at 2.00%' },
  { id: 'fed-2025-12-10', bank: 'FED', date: '2025-12-10', label: 'FOMC Dec 2025 — Cut to 3.25–3.50%' },
  { id: 'ecb-2025-12-18', bank: 'ECB', date: '2025-12-18', label: 'ECB Dec 2025 — Hold at 2.00%' },
  { id: 'fed-2026-01-28', bank: 'FED', date: '2026-01-28', label: 'FOMC Jan 2026 — Hold at 3.25–3.50%' },
  { id: 'ecb-2026-02-05', bank: 'ECB', date: '2026-02-05', label: 'ECB Feb 2026 — Hold at 2.00%' },
].sort((a, b) => a.date.localeCompare(b.date));

const POLICY_SOURCES = [
  'fomc press conference', 'fomc minutes', 'fomc statement',
  'ecb press conference', 'ecb monetary policy statement', 'ecb monetary policy accounts',
  'fed press conference', 'fed minutes', 'fed statement',
  'press conf', 'minutes', 'statement', 'monetary policy',
  'fed monetary',
];

function isPolicyText(item: SentimentItem): boolean {
  const src = (item.source || '').toLowerCase();
  const title = (item.title || '').toLowerCase();
  return POLICY_SOURCES.some(ps => src.includes(ps) || title.includes(ps));
}

const TopicHeatmaps = () => {
  const [tagging, setTagging] = useState(false);
  const [bankFilter, setBankFilter] = useState<'ALL' | 'FED' | 'ECB'>('ALL');

  const { data: allItems = [], isLoading, refetch } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  // Chronological order for display (oldest → newest)
  const filteredMeetings = useMemo(() => {
    if (bankFilter === 'ALL') return PAST_MEETINGS;
    return PAST_MEETINGS.filter(m => m.bank === bankFilter);
  }, [bankFilter]);

  const meetingTopicData = useMemo(() => {
    return filteredMeetings.map(meeting => {
      const sameBankAll = PAST_MEETINGS
        .filter(m => m.bank === meeting.bank)
        .sort((a, b) => a.date.localeCompare(b.date));
      const myIdx = sameBankAll.findIndex(m => m.id === meeting.id);
      const prevDate = myIdx > 0 ? sameBankAll[myIdx - 1].date : null;
      const startDate = prevDate || '2000-01-01';

      const bankItems = allItems.filter(
        i => i.bank === meeting.bank && !i.is_statistical && i.item_date > startDate && i.item_date <= meeting.date,
      );

      const policyItems = bankItems.filter(isPolicyText);
      const itemsForHeatmap = policyItems.length > 0 ? policyItems : bankItems;
      const taggedCount = itemsForHeatmap.filter(i => (i as any).topics?.length > 0).length;
      const classifiedCount = itemsForHeatmap.filter(i => (i as any).policy_dimensions != null).length;

      return { ...meeting, items: itemsForHeatmap, totalComms: bankItems.length, policyTexts: policyItems.length, taggedCount, classifiedCount };
    });
  }, [filteredMeetings, allItems]);

  const runTopicAnalysis = async () => {
    setTagging(true);
    try {
      const { data, error } = await supabase.functions.invoke('topic-analysis', { body: {} });
      if (error) throw error;
      toast.success(`Tagged ${data?.tagged || 0} items with topics (${data?.processed || 0} processed)`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Topic analysis failed');
    } finally {
      setTagging(false);
    }
  };

  const totalTagged = meetingTopicData.reduce((s, m) => s + m.taggedCount, 0);
  const totalItems = meetingTopicData.reduce((s, m) => s + m.items.length, 0);

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Topic Heatmaps</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Thematic analysis of <strong>official policy texts</strong> per meeting cycle
              {isLoading ? ' — loading…' : ` — ${totalTagged}/${totalItems} tagged`}
            </p>
          </div>
          <TooltipInfo content="Heat map visualization showing concentration of policy topics (inflation, growth, QE/QT, etc.) across different meeting cycles. Darker colors indicate higher frequency of topic mentions." />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 rounded-lg border border-border p-0.5 bg-muted/30">
            {(['ALL', 'FED', 'ECB'] as const).map(b => (
              <Button
                key={b}
                variant={bankFilter === b ? 'default' : 'ghost'}
                size="sm"
                className="h-6 text-[10px] px-2.5 rounded-md"
                onClick={() => setBankFilter(b)}
              >
                {b}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={runTopicAnalysis} disabled={tagging} className="gap-1.5 text-xs h-7">
            {tagging ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {tagging ? 'Tagging…' : 'Run Topic Analysis'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="matrix" className="space-y-4">
        <TabsList className="h-8">
          <TabsTrigger value="matrix" className="text-xs gap-1.5 h-6">
            <Grid3X3 className="w-3 h-3" /> Topic Heatmap
          </TabsTrigger>
          <TabsTrigger value="cards" className="text-xs gap-1.5 h-6">
            <FileText className="w-3 h-3" /> Per-Meeting Cards
          </TabsTrigger>
        </TabsList>

        {/* Matrix view */}
        <TabsContent value="matrix">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <TopicHeatmapMatrix meetings={meetingTopicData} />
          </div>
        </TabsContent>

        {/* Card view */}
        <TabsContent value="cards">
          <div className="space-y-3">
            {[...meetingTopicData].reverse().map(m => (
              <div key={m.id} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between bg-muted/20">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">{m.label}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {m.policyTexts} policy texts · {m.totalComms} total comms · {m.taggedCount} tagged · {m.classifiedCount} classified
                      </p>
                    </div>
                  </div>
                  <SignalBadge label={m.bank} variant="info" />
                </div>
                <div className="p-4">
                  <TopicHeatmap items={m.items} meetingDate={m.date} />
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TopicHeatmaps;
