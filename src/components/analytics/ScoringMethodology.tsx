import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ExternalLink, FunctionSquare } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { documentTier, TIER_LABEL, ANCHOR_OMEGA } from '@/lib/scoring-weights';
import type { SentimentItem } from '@/lib/api/sentiment';

const DIM_WEIGHTS = { inflation_persistence: 0.45, policy_stance: 0.40, growth_labor_drag: 0.15 } as const;
const AI_HEADLINE_WEIGHT = 0.5;
const NEUTRAL_BAND = 0.10;

interface Audit {
  model?: string;
  prompt_version?: string;
  temperature?: number;
  ai_headline?: number;
  dimension_composite?: number;
  ai_headline_weight?: number;
  neutral_band?: number;
  input_chars?: number;
  published?: number;
}

interface Technical {
  item: SentimentItem;
  dims: { inflation_persistence: number; policy_stance: number; growth_labor_drag: number } | null;
  composite: number | null;
  audit: Audit | null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function technicalOf(item: SentimentItem): Technical {
  const pd = (item.policy_dimensions || {}) as Record<string, unknown>;
  const ip = num(pd.inflation_persistence);
  const ps = num(pd.policy_stance);
  const gl = num(pd.growth_labor_drag);
  const dims = ip !== null || ps !== null || gl !== null
    ? { inflation_persistence: ip ?? 0, policy_stance: ps ?? 0, growth_labor_drag: gl ?? 0 }
    : null;
  const composite = dims
    ? Math.round((dims.inflation_persistence * DIM_WEIGHTS.inflation_persistence +
      dims.policy_stance * DIM_WEIGHTS.policy_stance +
      dims.growth_labor_drag * DIM_WEIGHTS.growth_labor_drag) * 1000) / 1000
    : null;
  const audit = (pd.scoring_audit as Audit | undefined) ?? null;
  return { item, dims, composite, audit };
}

const sign = (v: number, d = 3) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

function Bar({ value }: { value: number }) {
  const pct = Math.min(50, Math.abs(value) * 50);
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
      <div
        className={cn('absolute top-0 h-full', value >= 0 ? 'bg-signal-hawkish' : 'bg-signal-dovish')}
        style={value >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
      />
    </div>
  );
}

function DimRow({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground">{label}</span>
          <span className="text-[11px] font-mono text-muted-foreground">× {weight.toFixed(2)}</span>
        </div>
        <Bar value={value} />
      </div>
      <span className={cn('text-[12px] font-mono font-semibold w-14 text-right',
        value > 0 ? 'text-signal-hawkish' : value < 0 ? 'text-signal-dovish' : 'text-signal-neutral')}>
        {sign(value, 2)}
      </span>
    </div>
  );
}

function TechnicalCard({ t }: { t: Technical }) {
  const { item, dims, composite, audit } = t;
  const tier = documentTier(item.source || '', item.title || '');
  const aiHeadline = audit?.ai_headline ?? null;
  const w = audit?.ai_headline_weight ?? AI_HEADLINE_WEIGHT;
  const band = audit?.neutral_band ?? NEUTRAL_BAND;

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">{item.item_date}</span>
            <span className="text-[11px] text-muted-foreground">{item.source}</span>
            <span className="text-[10px] text-muted-foreground">T{tier} · {TIER_LABEL[tier]}</span>
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
        </div>
        <span className={cn('text-[15px] font-mono font-bold shrink-0',
          item.net_score > 0 ? 'text-signal-hawkish' : item.net_score < 0 ? 'text-signal-dovish' : 'text-signal-neutral')}>
          {sign(item.net_score)}
        </span>
      </div>

      {dims ? (
        <div className="space-y-1.5">
          <DimRow label="Inflation persistence" value={dims.inflation_persistence} weight={DIM_WEIGHTS.inflation_persistence} />
          <DimRow label="Policy stance" value={dims.policy_stance} weight={DIM_WEIGHTS.policy_stance} />
          <DimRow label="Growth / labour resilience" value={dims.growth_labor_drag} weight={DIM_WEIGHTS.growth_labor_drag} />
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Scored before the sub-dimension layer — only the headline score is on record for this item.
        </p>
      )}

      <div className="rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
        {composite !== null && (
          <div>composite = 0.45·IP + 0.40·PS + 0.15·GL = <span className="font-semibold">{sign(composite)}</span></div>
        )}
        {aiHeadline !== null && (
          <div>model headline = <span className="font-semibold">{sign(aiHeadline)}</span></div>
        )}
        {aiHeadline !== null && composite !== null && (
          <div>
            published = {w.toFixed(2)}·{sign(aiHeadline)} + {(1 - w).toFixed(2)}·{sign(composite)}
            {' '}→ <span className="font-semibold">{sign(item.net_score)}</span> (neutral band ±{band.toFixed(2)})
          </div>
        )}
        <div className="text-muted-foreground">
          {audit?.model ? `model ${audit.model} · temp ${audit.temperature ?? 0} · prompt ${audit.prompt_version}` : 'model metadata recorded from the next scoring run'}
          {audit?.input_chars ? ` · ${audit.input_chars.toLocaleString()} chars analysed` : ''}
          {item.word_count ? ` · ${item.word_count.toLocaleString()} words in source` : ''}
        </div>
      </div>

      {item.reasons?.length > 0 && (
        <p className="text-[12px] text-muted-foreground italic">
          {item.reasons[0].replace(/^ai:/, '')}
        </p>
      )}
    </div>
  );
}

/**
 * Technical transparency panel: exposes the numeric inputs behind every
 * AI-scored communication and the fixed published formula that turns them into
 * the stored score, so any number on the dashboard can be recomputed by hand.
 */
export function ScoringMethodology({ allItems }: { allItems: SentimentItem[] }) {
  const [bank, setBank] = useState<'FED' | 'ECB'>('FED');

  const items = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 45);
    const cs = cutoff.toISOString().split('T')[0];
    return allItems
      .filter(i => i.bank === bank && !i.is_statistical && i.item_date >= cs && Math.abs(i.net_score) > 0.001)
      .sort((a, b) => Math.abs(b.net_score) - Math.abs(a.net_score))
      .slice(0, 6)
      .map(technicalOf);
  }, [allItems, bank]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 cursor-help">
                <FunctionSquare className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Scoring Inputs — How Each Text Score Is Computed</h3>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-[12px]">
              Every communication is read with deterministic decoding (temperature 0) and returns three
              sub-dimension scores plus a headline score. The published score is a fixed formula over those
              numbers — never the raw model opinion alone — so it is reproducible and auditable.
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

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 font-mono text-[12px] leading-relaxed space-y-0.5">
        <div>1. dimensions: inflation_persistence (IP), policy_stance (PS), growth_labour (GL) ∈ [−1, +1]</div>
        <div>2. composite = 0.45·IP + 0.40·PS + 0.15·GL</div>
        <div>3. item score = 0.50·model_headline + 0.50·composite, zeroed inside ±0.10</div>
        <div>4. item weight = 2^(−age/half-life) × document tier (T1 1.0 / T2 0.7 / T3 0.4 / T4 0.1), any non-chair speaker capped at 10% of total weight</div>
        <div>5. narrative = α·text + (1−α)·statistics, α from channel freshness (0.35–0.85)</div>
        <div>6. published aggregate = {(1 - ANCHOR_OMEGA).toFixed(2)}·narrative + {ANCHOR_OMEGA.toFixed(2)}·realized-action anchor</div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-4">No scored communications in the last 45 days.</p>
        ) : (
          items.map((t, i) => <TechnicalCard key={i} t={t} />)
        )}
      </div>
    </div>
  );
}
