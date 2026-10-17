import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCachedSentimentItems, recentHistoryStart, type SentimentItem } from '@/lib/api/sentiment';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import { TaxonomyMatrix } from '@/components/meetings/TaxonomyMatrix';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { CENTRAL_BANK_MEETINGS } from '@/data/meeting-schedule';
import { hasTaxonomyDimensions, statementItemsForMeeting, taxonomyCacheKey } from '../../supabase/functions/_shared/policy-taxonomy';

const todayISO = new Date().toISOString().slice(0, 10);
// The meeting pages cover the history the pages load (two years), not the full calendar back to 2015.
const MEETINGS = CENTRAL_BANK_MEETINGS.filter(m => m.date >= recentHistoryStart() && m.date < todayISO);

const PolicyTaxonomy = () => {
  const [classifying, setClassifying] = useState(false);
  const [bankFilter, setBankFilter] = useState<'ALL' | 'FED' | 'ECB'>('ALL');

  const { data: allItems = [], isLoading, refetch } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });
  const { data: taxonomyCache = [], refetch: refetchTaxonomy } = useQuery({
    queryKey: ['statement-taxonomy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('analysis_cache').select('data_hash,result').eq('analysis_type', 'policy-taxonomy-statement');
      if (error) throw error;
      return data || [];
    },
  });

  const filteredMeetings = useMemo(() => {
    const base = bankFilter === 'ALL' ? MEETINGS : MEETINGS.filter(m => m.bank === bankFilter);
    return base;
  }, [bankFilter]);

  const meetingData = useMemo(() => {
    return filteredMeetings.map(meeting => {
      const statements = statementItemsForMeeting(allItems, meeting, todayISO);
      const items = statements.map(item => {
        const cached = taxonomyCache.find(row => row.data_hash === taxonomyCacheKey(item));
        const result = cached?.result as { dimensions?: Record<string, string | null> } | undefined;
        return { ...item, policy_dimensions: result?.dimensions };
      });
      const classifiedCount = items.filter(i => hasTaxonomyDimensions(i.policy_dimensions)).length;
      return { ...meeting, items, classifiedCount };
    });
  }, [filteredMeetings, allItems, taxonomyCache]);

  const runTaxonomyAnalysis = async () => {
    setClassifying(true);
    try {
      const ids = meetingData.flatMap(m => m.items).filter(i => !hasTaxonomyDimensions(i.policy_dimensions)).map(i => (i as SentimentItem & { id: string }).id);
      if (!ids.length) { toast.info('All available meeting statements are classified'); return; }
      let classified = 0;
      for (let step = 0; step < ids.length; step++) {
        const { data, error } = await supabase.functions.invoke('policy-taxonomy', { body: { ids, resume: step === 0 } });
        if (error) {
          const response = (error as { context?: Response }).context;
          const detail = response ? await response.json().catch(() => null) : null;
          throw new Error(detail?.error || error.message);
        }
        if (data?.error || data?.unavailable) throw new Error(data.error || 'Statement analysis is unavailable');
        classified += data?.classified || 0;
        await refetchTaxonomy();
        if (!data?.remaining) break;
      }
      toast.success(`Classified ${classified} official meeting statements`);
      await refetch();
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
              Official meeting statements
              {isLoading ? ' — loading…' : ` — ${totalClassified}/${totalItems} classified`}
            </p>
          </div>
          <TooltipInfo content="Six policy dimensions from the official statement published after each completed meeting. Speeches, projections and later minutes are excluded." />
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
