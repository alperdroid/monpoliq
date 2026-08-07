import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronDown, ExternalLink, FunctionSquare, Gauge, LineChart, Quote, Scale } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { documentTier, TIER_LABEL, ANCHOR_OMEGA, blendedAggregate, type WeightableItem } from '@/lib/scoring-weights';
import type { SentimentItem } from '@/lib/api/sentiment';

const DIM_WEIGHTS = { inflation_persistence: 0.45, policy_stance: 0.40, growth_labor_drag: 0.15 } as const;
const AI_HEADLINE_WEIGHT = 0.5;
const NEUTRAL_BAND = 0.10;

/** Plain-language definition of each sub-dimension, shown to the reader. */
const DIMENSIONS = [
  {
    key: 'inflation_persistence' as const,
    icon: LineChart,
    label: 'Inflation persistence',
    short: 'IP',
    weight: DIM_WEIGHTS.inflation_persistence,
    question: 'Where does the text put price pressure?',
    hawk: 'inflation above target, broadening, expectations drifting up',
    dove: 'disinflation on track, pressure fading, expectations anchored',
  },
  {
    key: 'policy_stance' as const,
    icon: Scale,
    label: 'Policy stance',
    short: 'PS',
    weight: DIM_WEIGHTS.policy_stance,
    question: 'How restrictive is policy said to be, or need to be?',
    hawk: 'keep restrictive, higher-for-longer, hike, resist cutting',
    dove: 'easing bias, cut delivered or signalled, policy seen as too tight',
  },
  {
    key: 'growth_labor_drag' as const,
    icon: Gauge,
    label: 'Growth & labour',
    short: 'GL',
    weight: DIM_WEIGHTS.growth_labor_drag,
    question: 'How strong are demand and the labour market described as?',
    hawk: 'economy resilient, labour market tight, demand robust',
    dove: 'growth slowing, unemployment rising, downside risk emphasised',
  },
];

/** The fixed ladder the model must pick from — no free-hand numbers. */
const ANCHORS = [
  { v: '0.0', text: 'not addressed, or genuinely two-sided' },
  { v: '±0.2', text: 'mentioned once, hedged or conditional' },
  { v: '±0.5', text: 'stated as the speaker’s current assessment' },
  { v: '±0.8', text: 'the dominant concern — repeated or quantified' },
  { v: '±1.0', text: 'the binding reason for the decision itself' },
];

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
  evidence?: Partial<Record<'inflation_persistence' | 'policy_stance' | 'growth_labor_drag', string>>;
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

function DimRow({ label, value, weight, evidence }: { label: string; value: number; weight: number; evidence?: string }) {
  return (
    <div className="space-y-0.5">
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
      {evidence && (
        <p className="flex gap-1 text-[11px] leading-snug text-muted-foreground pl-0.5">
          <Quote className="w-2.5 h-2.5 mt-1 shrink-0" />
          <span className="italic">“{evidence}”</span>
        </p>
      )}
    </div>
  );
}

/** Reader-facing explainer: what the three dimensions are and how they get a number. */
function DimensionGuide() {
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-3 gap-2">
        {DIMENSIONS.map(d => (
          <div key={d.key} className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <d.icon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[13px] font-semibold">{d.label}</span>
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                {Math.round(d.weight * 100)}% of composite
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-snug">{d.question}</p>
            <div className="space-y-1 pt-0.5">
              <p className="text-[11px] leading-snug">
                <span className="font-semibold text-signal-hawkish">Positive → hawkish:</span>{' '}
                <span className="text-muted-foreground">{d.hawk}</span>
              </p>
              <p className="text-[11px] leading-snug">
                <span className="font-semibold text-signal-dovish">Negative → dovish:</span>{' '}
                <span className="text-muted-foreground">{d.dove}</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-[12px] font-semibold mb-2">
          How strong is the signal? Every dimension uses the same fixed ladder
        </p>
        <div className="space-y-1">
          {ANCHORS.map(a => (
            <div key={a.v} className="flex items-baseline gap-2">
              <span className="w-11 shrink-0 text-right font-mono text-[12px] font-semibold">{a.v}</span>
              <span className="text-[12px] text-muted-foreground leading-snug">{a.text}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          The reader is told which rung was picked and the sentence it was picked from, so a score can be
          challenged on the evidence rather than taken on trust.
        </p>
      </div>
    </div>
  );
}

function TechnicalCard({ t }: { t: Technical }) {
  const { item, dims, audit } = t;
  const tier = documentTier(item.source || '', item.title || '');
  const ev = audit?.evidence;


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
        <div className="space-y-2">
          <DimRow label="Inflation persistence" value={dims.inflation_persistence} weight={DIM_WEIGHTS.inflation_persistence} evidence={ev?.inflation_persistence} />
          <DimRow label="Policy stance" value={dims.policy_stance} weight={DIM_WEIGHTS.policy_stance} evidence={ev?.policy_stance} />
          <DimRow label="Growth / labour resilience" value={dims.growth_labor_drag} weight={DIM_WEIGHTS.growth_labor_drag} evidence={ev?.growth_labor_drag} />
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Scored before the sub-dimension layer — only the headline score is on record for this item.
        </p>
      )}

      {item.word_count ? (
        <div className="text-[11px] text-muted-foreground">
          {item.word_count.toLocaleString()} words in source
        </div>
      ) : null}


      {item.reasons?.length > 0 && (
        <p className="text-[12px] text-muted-foreground italic">
          {item.reasons[0].replace(/^ai:/, '')}
        </p>
      )}
    </div>
  );
}

/**
 * Headline-level provenance: the exact α/ω used, the two channel averages, and
 * every realized decision that fed the action anchor with its decay weight, so
 * the published aggregate can be re-derived line by line.
 */
function AggregateProvenance({ allItems, bank }: { allItems: SentimentItem[]; bank: 'FED' | 'ECB' }) {
  const blend = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cs = cutoff.toISOString().split('T')[0];
    const rows = allItems.filter(i => i.bank === bank && i.item_date >= cs);
    return blendedAggregate(rows as unknown as WeightableItem[], bank);
  }, [allItems, bank]);

  const p = blend.provenance;
  const ap = blend.anchor.provenance;
  const s = (v: number, d = 3) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {bank} headline provenance — inputs, weights and decisions used
      </p>
      <div className="font-mono text-[11px] leading-relaxed space-y-0.5">
        <div>{p.formula}</div>
        <div>
          comms {s(p.comms_avg)} (n={p.comms_n}, half-life {p.half_life_days}d) · stats {s(p.stats_avg)} (n={p.stats_n})
        </div>
        <div>α = {p.alpha.toFixed(2)} → narrative {s(p.narrative)} · ω = {p.omega.toFixed(2)} · anchor {s(p.anchor_score)}</div>
        <div className="font-semibold">published headline = {s(blend.avg)}</div>
      </div>
      <div className="space-y-0.5">
        <p className="text-[11px] font-semibold text-muted-foreground">Realized-action anchor</p>
        <p className="font-mono text-[10px] text-muted-foreground">{ap.params.formula}</p>
        {ap.actions.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No rate decision in the trailing {ap.params.window_days} days.</p>
        ) : (
          <div className="font-mono text-[10px] text-muted-foreground space-y-0.5">
            {ap.actions.map(a => (
              <div key={a.date}>
                {a.date} · {a.bps > 0 ? '+' : ''}{a.bps}bp · age {a.age_days}d · decay {a.decay.toFixed(3)} → {s(a.contribution)}
              </div>
            ))}
            <div>
              Σ = {s(ap.raw)}{ap.clamped ? ` → clamped to ±${ap.params.clamp}` : ''} · calendar: {ap.params.calendar}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Technical transparency panel: explains the three sub-dimensions in plain
 * language, publishes the fixed anchor ladder used to score them, and exposes
 * the numeric inputs behind every AI-scored communication so any number on the
 * dashboard can be recomputed by hand.
 */
export function ScoringMethodology({ allItems }: { allItems: SentimentItem[] }) {
  const [bank, setBank] = useState<'FED' | 'ECB'>('FED');
  const [showFormula, setShowFormula] = useState(false);

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
              Every communication is read with deterministic decoding (temperature 0) and rated on three
              defined dimensions using a fixed anchor ladder, each backed by a quote from the text. The
              published score is a fixed formula over those numbers — never the raw model opinion alone.
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

      <p className="text-[12px] text-muted-foreground leading-snug">
        Each communication is read for three things: <span className="font-semibold text-foreground">inflation
        persistence</span>, <span className="font-semibold text-foreground">policy stance</span> and{' '}
        <span className="font-semibold text-foreground">growth &amp; labour</span>. Each gets a score from
        −1 (clearly dovish) through 0 (not addressed) to +1 (clearly hawkish), and the three are combined
        with fixed weights.
      </p>

      <DimensionGuide />

      <button
        type="button"
        onClick={() => setShowFormula(v => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showFormula && 'rotate-180')} />
        {showFormula ? 'Hide the full formula' : 'Show the full formula, step by step'}
      </button>

      {showFormula && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 font-mono text-[12px] leading-relaxed space-y-0.5">
          <div>1. dimensions: IP, PS, GL scored on the anchor ladder above, each in [−1, +1]</div>
          <div>2. composite = 0.45·IP + 0.40·PS + 0.15·GL</div>
          <div>3. item score = blend of the overall read and the weighted composite, zeroed inside ±0.10</div>
          <div>4. item weight = 2^(−age/half-life) × document tier (T1 1.0 / T2 0.7 / T3 0.4 / T4 0.1), any non-chair speaker capped at 10% of total weight</div>
          <div>5. narrative = α·text + (1−α)·statistics, α from channel freshness (0.35–0.85)</div>
          <div>6. published aggregate = {(1 - ANCHOR_OMEGA).toFixed(2)}·narrative + {ANCHOR_OMEGA.toFixed(2)}·realized-action anchor</div>
        </div>
      )}

      <AggregateProvenance allItems={allItems} bank={bank} />


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
