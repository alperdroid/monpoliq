import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronDown, ExternalLink, FunctionSquare, Gauge, LineChart, Quote, Scale } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { documentTier, TIER_LABEL, ANCHOR_OMEGA } from '@/lib/scoring-weights';
import type { SentimentItem } from '@/lib/api/sentiment';
import { frozenOf, scoreKind } from '@/lib/scoring-provenance';
import { ScoreProvenanceBadges } from '@/components/analytics/ScoreProvenanceBadges';

const DIM_WEIGHTS = { inflation_persistence: 0.45, policy_stance: 0.40, growth_labor_drag: 0.15 } as const;
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

      <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
        <p className="text-[12px] font-semibold">How a communication is scored</p>
        <p className="text-[12px] text-muted-foreground leading-snug">
          Every text is split into sentences, and only sentences about policy, inflation, growth, labour
          markets, rates or risks are kept. Each sentence is scored by two fixed methods: a rulebook that looks
          for a topic word next to a direction word (&ldquo;inflation … rising&rdquo;, &ldquo;unemployment …
          falling&rdquo;, &ldquo;raise … rates&rdquo;, with negation handled), and a statistical model trained on
          2,326 FOMC sentences labelled by researchers (Shah, Paturi &amp; Chava, 2023). The document score is the
          share of hawkish minus dovish sentences, pulled toward neutral for short texts so a one-line quote cannot
          move the index like a full press conference, and placed on a fixed 1996&ndash;2024 historical scale. The
          same text always receives the same score, and every score records the exact version used.
        </p>
        <p className="text-[12px] font-semibold pt-1">How each dimension is computed</p>
        <p className="text-[12px] text-muted-foreground leading-snug">
          Sentences are assigned to inflation, policy stance or growth/labour by the rulebook&rsquo;s topic words.
          For each dimension, the sentences on that topic are averaged and scaled so that a strong, repeated
          message reaches about &plusmn;0.8. The quoted sentence under each dimension is the one that contributed
          most.
        </p>
        <p className="text-[12px] font-semibold pt-1">Exceptions</p>
        <p className="text-[12px] text-muted-foreground leading-snug">
          Summary of Economic Projections documents are tables of numbers, not prose: they are scored by comparing
          the new projections with the previous ones, with an AI model used to read the tables. Some member remarks
          are found by an AI search; their text is a summary, marked as such, and scored by the same fixed method.
        </p>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Validation: the index matches a published research measure (r &asymp; 0.85), gets the direction right at
          41 of 44 ECB rate changes since 1998, and the inflation dimension tracks actual CPI inflation.
        </p>
      </div>
    </div>
  );
}

function TechnicalCard({ t }: { t: Technical }) {
  const { item, dims, audit } = t;
  const tier = documentTier(item.source || '', item.title || '');
  const ev = audit?.evidence;
  const fz = frozenOf(item);
  const kind = scoreKind(item);

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">{item.item_date}</span>
            <span className="text-[11px] text-muted-foreground">{item.source}</span>
            <span className="text-[10px] text-muted-foreground">T{tier} · {TIER_LABEL[tier]}</span>
            <ScoreProvenanceBadges item={item} />
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
          No sub-dimensions on record for this item — only the headline score.
        </p>
      )}

      {item.word_count ? (
        <div className="text-[11px] text-muted-foreground">
          {item.word_count.toLocaleString()} words in source
        </div>
      ) : null}


      {kind === 'frozen' && fz && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Sentences scored: <span className="font-mono">{fz.n_sentences ?? '—'}</span></span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    Scorer agreement:{' '}
                    <span className="font-mono">{fz.scorer_agreement != null ? `${Math.round(fz.scorer_agreement * 100)}%` : '—'}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-[12px]">
                  Share of sentences where the rulebook and the statistical model agree on direction
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {fz.evidence?.hawkish?.[0] && (
            <p className="text-[11px] leading-snug">
              <span className="font-semibold text-signal-hawkish">Most hawkish sentence:</span>{' '}
              <span className="italic text-muted-foreground">&ldquo;{fz.evidence.hawkish[0].slice(0, 220)}&rdquo;</span>
            </p>
          )}
          {fz.evidence?.dovish?.[0] && (
            <p className="text-[11px] leading-snug">
              <span className="font-semibold text-signal-dovish">Most dovish sentence:</span>{' '}
              <span className="italic text-muted-foreground">&ldquo;{fz.evidence.dovish[0].slice(0, 220)}&rdquo;</span>
            </p>
          )}
          <p className="text-[10px] font-mono text-muted-foreground break-all">
            Scorer: {audit?.model} · {audit?.prompt_version}
          </p>
        </div>
      )}

      {kind !== 'frozen' && item.reasons?.length > 0 && (
        <p className="text-[12px] text-muted-foreground italic">
          {item.reasons[0].replace(/^ai:/, '')}
        </p>
      )}
    </div>
  );
}

/**
 * Technical transparency panel: explains the three sub-dimensions in plain
 * language, explains the fixed scoring method, and exposes
 * the numeric inputs behind every scored communication so any number on the
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
              Every communication is scored by a fixed, published method (a rulebook plus a statistical model
              trained on labelled FOMC sentences). The same text always gets the same score, and each score shows
              the sentences that drove it and the exact scorer version.
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
        −1 (clearly dovish) through 0 (not addressed) to +1 (clearly hawkish). The published score for each text
        is the document-level hawkish-minus-dovish measure; the weighted composite of the three is shown alongside.
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
          <div>1. sentence: rulebook label (+1 / 0 / −1) and model probabilities p_hawk, p_dove</div>
          <div>2. document z = ½·[(Σlabels + 8·μ_lex)/(n+8) − μ_lex]/σ_lex + ½·[(Σ(p_hawk−p_dove) + 8·μ_lin)/(n+8) − μ_lin]/σ_lin</div>
          <div>3. item score = clamp(z / 2.5, −1, +1); neutral inside ±0.10 · dimensions IP, PS, GL in [−1, +1]; composite = 0.45·IP + 0.40·PS + 0.15·GL (display)</div>
          <div>4. item weight = 2^(−age/half-life) × document tier (T1 1.0 / T2 0.7 / T3 0.4 / T4 0.1), any non-chair speaker capped at 10% of total weight</div>
          <div>5. narrative = α·text + (1−α)·statistics, α from channel freshness (0.35–0.85)</div>
          <div>6. published aggregate = {(1 - ANCHOR_OMEGA).toFixed(2)}·narrative + {ANCHOR_OMEGA.toFixed(2)}·realized-action anchor</div>
        </div>
      )}




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
