import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { TaxonomyMatrix } from '@/components/meetings/TaxonomyMatrix';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { CENTRAL_BANK_MEETINGS } from '@/data/meeting-schedule';

const todayISO = new Date().toISOString().slice(0, 10);
const MEETINGS = CENTRAL_BANK_MEETINGS.filter(m => m.date < todayISO);

const POLICY_SOURCES = [
  'fomc press conference', 'fomc minutes', 'fomc statement', 'fomc sep',
  'fomc press conf', 'fomc summary of economic projections',
  'ecb press conference', 'ecb monetary policy statement', 'ecb monetary policy accounts',
  'fed press conference', 'fed minutes', 'fed statement',
  'press conf', 'minutes', 'statement', 'monetary policy', 'fed monetary',
  'meeting of', 'accounts of', 'account —',
  'summary of economic projections',
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
    const base = bankFilter === 'ALL' ? MEETINGS : MEETINGS.filter(m => m.bank === bankFilter);
    return base;
  }, [bankFilter]);

  const meetingData = useMemo(() => {
    return filteredMeetings.map(meeting => {
      const sameBankAll = MEETINGS.filter(m => m.bank === meeting.bank).sort((a, b) => a.date.localeCompare(b.date));
      const myIdx = sameBankAll.findIndex(m => m.id === meeting.id);
      const prevDate = myIdx > 0 ? sameBankAll[myIdx - 1].date : null;
      const startDate = prevDate || '2000-01-01';
      const nextDate = myIdx < sameBankAll.length - 1 ? sameBankAll[myIdx + 1].date : '2099-12-31';

      const bankItems = allItems.filter(
        i => i.bank === meeting.bank && !i.is_statistical && i.item_date > startDate && i.item_date < nextDate,
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
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Policy Taxonomy</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Orthogonal policy dimensions — which narrative dominates each meeting cycle
              {isLoading ? ' — loading…' : ` — ${totalClassified}/${totalItems} classified`}
            </p>
          </div>
          <TooltipInfo content="Machine learning classification of policy communications into 6 dimensional categories: reaction function, forward guidance, risk balance, terminal rate view, time horizon, and balance sheet approach." />
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
