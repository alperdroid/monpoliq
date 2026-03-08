import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { TopicHeatmap } from '@/components/meetings/TopicHeatmap';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { RefreshCw, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';

/** Past meetings only — topic analysis requires completed policy texts */
const PAST_MEETINGS = [
  { id: 'fed-2026-01-28', bank: 'FED', date: '2026-01-28', label: 'FOMC Jan 2026 — Hold at 3.50–3.75%' },
  { id: 'ecb-2026-02-05', bank: 'ECB', date: '2026-02-05', label: 'ECB Feb 2026 — Hold at 2.00%' },
  { id: 'fed-2025-12-10', bank: 'FED', date: '2025-12-10', label: 'FOMC Dec 2025 — Cut to 3.50–3.75%' },
  { id: 'ecb-2025-12-18', bank: 'ECB', date: '2025-12-18', label: 'ECB Dec 2025 — Hold at 2.00%' },
  { id: 'fed-2025-10-29', bank: 'FED', date: '2025-10-29', label: 'FOMC Oct 2025 — Cut to 3.75–4.00%' },
  { id: 'ecb-2025-10-30', bank: 'ECB', date: '2025-10-30', label: 'ECB Oct 2025 — Hold at 2.00%' },
];

const POLICY_SOURCES = [
  'FOMC Press Conference',
  'FOMC Minutes',
  'FOMC Statement',
  'ECB Press Conference',
  'ECB Monetary Policy Statement',
  'ECB Monetary Policy Accounts',
  'Fed Press Conference',
  'Fed Minutes',
  'Fed Statement',
];

function isPolicyText(item: SentimentItem): boolean {
  const src = item.source?.toLowerCase() || '';
  const title = item.title?.toLowerCase() || '';
  return POLICY_SOURCES.some(ps => src.includes(ps.toLowerCase()) || title.includes(ps.toLowerCase()))
    || src.includes('press conf')
    || src.includes('minutes')
    || src.includes('statement')
    || title.includes('press conf')
    || title.includes('minutes')
    || title.includes('monetary policy');
}

const TopicHeatmaps = () => {
  const [tagging, setTagging] = useState(false);
  const [bankFilter, setBankFilter] = useState<'ALL' | 'FED' | 'ECB'>('ALL');

  const { data: allItems = [], isLoading, refetch } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const filteredMeetings = useMemo(() => {
    if (bankFilter === 'ALL') return PAST_MEETINGS;
    return PAST_MEETINGS.filter(m => m.bank === bankFilter);
  }, [bankFilter]);

  /** For each past meeting, extract items from policy texts in the cycle window */
  const meetingTopicData = useMemo(() => {
    return filteredMeetings.map(meeting => {
      // Get same-bank meetings sorted chronologically
      const sameBankAll = PAST_MEETINGS
        .filter(m => m.bank === meeting.bank)
        .sort((a, b) => a.date.localeCompare(b.date));
      const myIdx = sameBankAll.findIndex(m => m.id === meeting.id);
      const prevDate = myIdx > 0 ? sameBankAll[myIdx - 1].date : null;

      // Window: from previous meeting to this meeting
      const startDate = prevDate || '2000-01-01';
      const bankItems = allItems.filter(
        i => i.bank === meeting.bank
          && !i.is_statistical
          && i.item_date > startDate
          && i.item_date <= meeting.date
      );

      // Prioritise actual policy texts
      const policyItems = bankItems.filter(isPolicyText);
      // If we have policy items use those, otherwise fall back to all comms
      const itemsForHeatmap = policyItems.length > 0 ? policyItems : bankItems;

      const taggedCount = itemsForHeatmap.filter(i => (i as any).topics?.length > 0).length;

      return {
        ...meeting,
        items: itemsForHeatmap,
        totalComms: bankItems.length,
        policyTexts: policyItems.length,
        taggedCount,
      };
    });
  }, [filteredMeetings, allItems]);

  const runTopicAnalysis = async () => {
    setTagging(true);
    try {
      const { data, error } = await supabase.functions.invoke('topic-analysis', { body: {} });
      if (error) throw error;
      toast.success(`Tagged ${data?.tagged || 0} items with topics`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Topic analysis failed');
    } finally {
      setTagging(false);
    }
  };

  return (
    <div className="space-y-4 animate-slide-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">Topic Heatmaps</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['ALL', 'FED', 'ECB'] as const).map(b => (
              <Button
                key={b}
                variant={bankFilter === b ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2.5"
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

      <p className="text-xs text-muted-foreground">
        Topic tags derived from <strong>actual policy texts</strong> — press conference transcripts, meeting minutes, and official statements per meeting cycle.
        {isLoading && ' Loading…'}
      </p>

      <div className="space-y-4">
        {meetingTopicData.map(m => (
          <div key={m.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-surface flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-primary/10">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{m.label}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {m.policyTexts} policy texts · {m.totalComms} total comms · {m.taggedCount} tagged
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
    </div>
  );
};

export default TopicHeatmaps;
