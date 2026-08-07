import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink, Mic, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { dynamicHalfLife, itemWeight, capSpeakerWeights, documentTier, TIER_LABEL, type WeightableItem } from '@/lib/scoring-weights';
import type { SentimentItem } from '@/lib/api/sentiment';

/** Pull the speaker out of a title: "Cook, Economic Outlook" / "Frank Elderson: Europe's …" */
export function speakerFromTitle(title: string): string | null {
  const t = (title || '').trim();
  const m = t.match(/^([\p{L}][\p{L}\s.'’-]{1,40}?)\s*[:,]\s/u);
  if (!m) return null;
  const head = m[1].trim();
  if (/\b(the|and|for|report|statement|minutes|account|update|review|federal|euro)\b/i.test(head)) return null;
  return head;
}

interface Contribution {
  item: SentimentItem;
  weight: number;
  contribution: number; // signed points of the final score
  share: number; // 0..1 share of total absolute influence
}

function contributions(items: SentimentItem[], bank: string, now: Date): Contribution[] {
  const scored = items.filter(i => Math.abs(i.net_score) > 0.001);
  if (!scored.length) return [];
  const halfLife = dynamicHalfLife(bank, now);
  const raw = scored.map(item => itemWeight(item as unknown as WeightableItem, halfLife, now));
  const capped = capSpeakerWeights(scored as unknown as WeightableItem[], raw);
  const weighted = scored.map((item, i) => ({
    item, weight: capped[i], contribution: item.net_score * capped[i], share: 0,
  }));
  const den = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  const absTotal = weighted.reduce((s, w) => s + Math.abs(w.contribution), 0) || 1;
  return weighted
    .map(w => ({
      ...w,
      contribution: Math.round((w.contribution / den) * 1000) / 1000,
      share: Math.abs(w.contribution) / absTotal,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function windowItems(items: SentimentItem[], bank: string, days: number, statistical: boolean) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cs = cutoff.toISOString().split('T')[0];
  return items.filter(i => i.bank === bank && i.is_statistical === statistical && i.item_date >= cs);
}

function Row({ c, kind }: { c: Contribution; kind: 'comm' | 'stat' }) {
  const it = c.item;
  const speaker = kind === 'comm' ? speakerFromTitle(it.title) : null;
  const tier = documentTier(it.source || '', it.title || '');
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold">
            {kind === 'comm' ? (speaker || it.source) : (it.stat_metric || it.source)}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">{it.item_date}</span>
          {kind === 'stat' && it.stat_value !== null && (
            <span className="text-[11px] font-mono text-muted-foreground">= {Number(it.stat_value).toFixed(2)}</span>
          )}
          {it.url && (
            <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground truncate">{it.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full', c.contribution > 0 ? 'bg-signal-hawkish' : c.contribution < 0 ? 'bg-signal-dovish' : 'bg-signal-neutral')}
              style={{ width: `${Math.min(100, c.share * 100).toFixed(1)}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono w-10 text-right">{(c.share * 100).toFixed(0)}%</span>
        </div>
      </div>
      <div className="text-right shrink-0 w-24">
        <p className={cn('text-[13px] font-mono font-bold',
          c.contribution > 0 ? 'text-signal-hawkish' : c.contribution < 0 ? 'text-signal-dovish' : 'text-signal-neutral')}>
          {c.contribution > 0 ? '+' : ''}{c.contribution.toFixed(3)}
        </p>
        <p className="text-[10px] text-muted-foreground font-mono">
          raw {it.net_score > 0 ? '+' : ''}{it.net_score.toFixed(2)} · w {c.weight.toFixed(2)}
        </p>
        {kind === 'comm' && <p className="text-[9px] text-muted-foreground truncate">T{tier} {TIER_LABEL[tier]}</p>}
      </div>
    </div>
  );
}

export function ScoreAttribution({ allItems }: { allItems: SentimentItem[] }) {
  const [bank, setBank] = useState<'FED' | 'ECB'>('FED');
  const now = useMemo(() => new Date(), []);

  const commContribs = useMemo(
    () => contributions(windowItems(allItems, bank, 45, false), bank, now),
    [allItems, bank, now],
  );
  const statContribs = useMemo(
    () => contributions(windowItems(allItems, bank, 60, true), bank, now),
    [allItems, bank, now],
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <h3 className="text-sm font-semibold cursor-help">Score Attribution — What Moved the Score</h3>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-[12px]">
              Each item's contribution = its score × its weight (time decay × document tier or statistical
              reliability), divided by the sum of all weights. Contributions add up to the published score,
              so you can verify exactly which speaker or release drove it.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex gap-1.5">
          {(['FED', 'ECB'] as const).map(b => (
            <Button key={b} size="sm" variant={bank === b ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setBank(b)}>
              {b}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Mic className="w-3.5 h-3.5 text-primary" />
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Top speaker contributions (45d)
            </p>
          </div>
          {commContribs.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-4">No scored communications in this window.</p>
          ) : (
            commContribs.slice(0, 6).map((c, i) => <Row key={i} c={c} kind="comm" />)
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Database className="w-3.5 h-3.5 text-chart-3" />
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Top statistical contributions (60d)
            </p>
          </div>
          {statContribs.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-4">No scored statistical releases in this window.</p>
          ) : (
            statContribs.slice(0, 6).map((c, i) => <Row key={i} c={c} kind="stat" />)
          )}
        </div>
      </div>
    </div>
  );
}
