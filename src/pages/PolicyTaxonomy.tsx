import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { TaxonomyMatrix } from '@/components/meetings/TaxonomyMatrix';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';

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
  'press conf', 'minutes', 'statement', 'monetary policy', 'fed monetary',
];

function isPolicyText(item: SentimentItem): boolean {
  const src = (item.source || '').toLowerCase();
  const title = (item.title || '').toLowerCase();
  return POLICY_SOURCES.some(ps => src.includes(ps) || title.includes(ps));
}

const PolicyTaxonomy = () => {
  const [classifying, setClassifying] = useState(false);
  const [bankFilter, setBankFilter] = useState<'ALL' | 'FED' | 'ECB'>('ALL');

  const { data: allItems = [], isLoading, refetch } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const filteredMeetings = useMemo(() => {
    const base = bankFilter === 'ALL' ? PAST_MEETINGS : PAST_MEETINGS.filter(m => m.bank === bankFilter);
    return base;
  }, [bankFilter]);

  const meetingData = useMemo(() => {
    return filteredMeetings.map(meeting => {
      const sameBankAll = PAST_MEETINGS.filter(m => m.bank === meeting.bank).sort((a, b) => a.date.localeCompare(b.date));
      const myIdx = sameBankAll.findIndex(m => m.id === meeting.id);
      const prevDate = myIdx > 0 ? sameBankAll[myIdx - 1].date : null;
      const startDate = prevDate || '2000-01-01';

      const bankItems = allItems.filter(
        i => i.bank === meeting.bank && !i.is_statistical && i.item_date > startDate && i.item_date <= meeting.date,
      );
      const policyItems = bankItems.filter(isPolicyText);
      const itemsForAnalysis = policyItems.length > 0 ? policyItems : bankItems;
      const classifiedCount = itemsForAnalysis.filter(i => (i as any).policy_dimensions != null).length;

      return { ...meeting, items: itemsForAnalysis, totalComms: bankItems.length, policyTexts: policyItems.length, classifiedCount };
    });
  }, [filteredMeetings, allItems]);

  const runTaxonomyAnalysis = async () => {
    setClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('policy-taxonomy', { body: {} });
      if (error) throw error;
      toast.success(`Classified ${data?.classified || 0} items (${data?.processed || 0} processed)`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Taxonomy analysis failed');
    } finally {
      setClassifying(false);
    }
  };

  const totalClassified = meetingData.reduce((s, m) => s + m.classifiedCount, 0);
  const totalItems = meetingData.reduce((s, m) => s + m.items.length, 0);

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Policy Taxonomy</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Orthogonal policy dimensions — which narrative dominates each meeting cycle
            {isLoading ? ' — loading…' : ` — ${totalClassified}/${totalItems} classified`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 rounded-lg border border-border p-0.5 bg-muted/30">
            {(['ALL', 'FED', 'ECB'] as const).map(b => (
              <Button key={b} variant={bankFilter === b ? 'default' : 'ghost'} size="sm" className="h-6 text-[10px] px-2.5 rounded-md" onClick={() => setBankFilter(b)}>
                {b}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={runTaxonomyAnalysis} disabled={classifying} className="gap-1.5 text-xs h-7">
            {classifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
            {classifying ? 'Classifying…' : 'Run Taxonomy Analysis'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <TaxonomyMatrix meetings={meetingData as any} />
      </div>
    </div>
  );
};

export default PolicyTaxonomy;
