import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, ExternalLink, FileSearch, Quote } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { documentTier, TIER_LABEL } from '@/lib/scoring-weights';
import type { SentimentItem } from '@/lib/api/sentiment';

const DIMS = [
  { key: 'inflation_persistence', label: 'Inflation persistence', weight: 0.45 },
  { key: 'policy_stance', label: 'Policy stance', weight: 0.40 },
  { key: 'growth_labor_drag', label: 'Growth & labour', weight: 0.15 },
] as const;

type DimKey = typeof DIMS[number]['key'];

interface EvidenceRef {
  page?: number;
  line?: number;
  char_start?: number;
  context?: string;
  pages?: number;
}

/** Full provenance chain written alongside every score by the scoring run. */
interface Provenance {
  text_sha256?: string;
  text_chars?: number;
  extractor?: string;
  extractor_version?: string;
  parser_settings?: { page_sep?: string; prose_stream_min_words?: number };
  prose_gate_min_words?: number;
  sampling?: { budget?: number; begin?: number; middle?: number; end?: number; sampled?: boolean; sent_chars?: number };
  source_url?: string;
  http_status?: number;
  content_type?: string;
  fetched_at?: string;
  run_id?: string;
  run_mode?: string;
  attempt?: number;
  scored_at?: string;
}

interface Audit {
  evidence?: Partial<Record<DimKey, string>>;
  evidence_refs?: Partial<Record<DimKey, EvidenceRef>>;
  extraction?: { pages?: number; words?: number; doc_chars?: number; sampled?: boolean };
  provenance?: Provenance;
  input_chars?: number;
  stance_adjustments?: { raw_policy_stance?: number; applied?: string[] };
  model?: string;
  prompt_version?: string;
}

const ProvRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex gap-1.5">
    <dt className="shrink-0 opacity-70">{k}:</dt>
    <dd className="break-all">{v}</dd>
  </div>
);


interface Row {
  item: SentimentItem;
  audit: Audit | null;
  snippets: { key: DimKey; label: string; weight: number; value: number; quote: string; ref: EvidenceRef | null }[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sign = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

function rowOf(item: SentimentItem): Row {
  const pd = (item.policy_dimensions || {}) as Record<string, unknown>;
  const audit = (pd.scoring_audit as Audit | undefined) ?? null;
  const snippets = DIMS.map(d => ({
    key: d.key,
    label: d.label,
    weight: d.weight,
    value: num(pd[d.key]),
    quote: (audit?.evidence?.[d.key] || '').trim(),
    ref: (audit?.evidence_refs?.[d.key] as EvidenceRef | undefined) ?? null,
  })).filter(s => s.quote.length > 0);
  return { item, audit, snippets };
}

/** Highlight the quoted words inside the surrounding sentence pulled from the source. */
function Context({ context, quote }: { context: string; quote: string }) {
  const idx = context.toLowerCase().indexOf(quote.toLowerCase().slice(0, 40));
  if (idx < 0) return <span className="text-muted-foreground">{context}</span>;
  const end = Math.min(context.length, idx + Math.max(quote.length, 40));
  return (
    <span className="text-muted-foreground">
      {context.slice(0, idx)}
      <mark className="bg-primary/15 text-foreground rounded px-0.5">{context.slice(idx, end)}</mark>
      {context.slice(end)}
    </span>
  );
}

// `ref` is reserved by React on components, so the location is passed as `loc`.
function RefBadge({ loc: r }: { loc: EvidenceRef | null }) {

  if (!r?.page) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        location not resolved
      </span>
    );
  }
  return (
    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
      p.{r.page}{r.pages ? `/${r.pages}` : ''} · line {r.line}
      {typeof r.char_start === 'number' ? ` · char ${r.char_start.toLocaleString()}` : ''}
    </span>
  );
}

function EvidenceRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const { item, audit, snippets } = row;
  const tier = documentTier(item.source || '', item.title || '');
  const ex = audit?.extraction;
  const pv = audit?.provenance;


  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">{item.item_date}</span>
            <span className="text-[11px] text-muted-foreground">{item.source}</span>
            <span className="text-[10px] text-muted-foreground">T{tier} · {TIER_LABEL[tier]}</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {snippets.length} snippet{snippets.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
        </div>
        <span className={cn('text-[14px] font-mono font-bold shrink-0',
          item.net_score > 0 ? 'text-signal-hawkish' : item.net_score < 0 ? 'text-signal-dovish' : 'text-signal-neutral')}>
          {sign(item.net_score)}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {ex?.pages ? <span>{ex.pages.toLocaleString()} page{ex.pages === 1 ? '' : 's'} extracted</span> : null}
            {ex?.words ? <span>{ex.words.toLocaleString()} words</span> : null}
            {audit?.input_chars ? <span>{audit.input_chars.toLocaleString()} chars analysed</span> : null}
            {ex?.sampled ? <span className="text-signal-neutral">document sampled (opening · middle · close)</span> : null}
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary">
                open source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {snippets.map(s => (
            <div key={s.key} className="rounded-md border border-border/70 bg-card p-2.5 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold">{s.label}</span>
                <RefBadge loc={s.ref} />
                <span className="ml-auto flex items-baseline gap-1.5">
                  <span className={cn('font-mono text-[12px] font-semibold',
                    s.value > 0 ? 'text-signal-hawkish' : s.value < 0 ? 'text-signal-dovish' : 'text-signal-neutral')}>
                    {sign(s.value)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">× {s.weight.toFixed(2)}</span>
                </span>
              </div>
              <p className="flex gap-1.5 text-[12px] leading-snug">
                <Quote className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                <span className="italic">“{s.quote}”</span>
              </p>
              {s.ref?.context && s.ref.context !== s.quote && (
                <p className="text-[11px] leading-snug border-l-2 border-border pl-2">
                  <Context context={s.ref.context} quote={s.quote} />
                </p>
              )}
            </div>
          ))}

          {audit?.stance_adjustments?.applied?.length ? (
            <div className="rounded-md border border-border/70 bg-muted/40 p-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Policy-stance adjustments applied
              </p>
              <p className="text-[11px] text-muted-foreground">
                raw reading {audit.stance_adjustments.raw_policy_stance?.toFixed(2)} → published{' '}
                {dims?.policy_stance?.toFixed(2)}
              </p>
              <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
                {audit.stance_adjustments.applied.map(a => <li key={a}>{a}</li>)}
              </ul>
            </div>
          ) : null}

          {(audit?.prompt_version || pv) && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Provenance — this score's exact inputs
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                {audit?.prompt_version && <ProvRow k="scoring rubric" v={`${audit.prompt_version}`} />}
                {pv?.text_sha256 && <ProvRow k="text version (sha256)" v={pv.text_sha256} />}
                {pv?.extractor_version && <ProvRow k="reader" v={`${pv.extractor ?? '?'} · ${pv.extractor_version}`} />}
                {pv?.parser_settings && (
                  <ProvRow
                    k="parser settings"
                    v={`page_sep ${pv.parser_settings.page_sep} · prose ≥${pv.parser_settings.prose_stream_min_words}w · gate ≥${pv.prose_gate_min_words ?? '?'}w`}
                  />
                )}
                {pv?.sampling && (
                  <ProvRow
                    k="sampling"
                    v={pv.sampling.sampled
                      ? `${pv.sampling.sent_chars?.toLocaleString()} / ${pv.text_chars?.toLocaleString()} chars (${pv.sampling.begin}+${pv.sampling.middle}+${pv.sampling.end})`
                      : `full text · ${pv.text_chars?.toLocaleString()} chars`}
                  />
                )}
                {pv?.http_status ? <ProvRow k="fetch" v={`HTTP ${pv.http_status} · ${pv.content_type ?? '—'}`} /> : null}
                {pv?.run_id && <ProvRow k="run" v={`${pv.run_mode ?? 'run'} · ${pv.run_id.slice(0, 8)} · attempt ${pv.attempt ?? 1}`} />}
                {pv?.scored_at && <ProvRow k="scored at" v={new Date(pv.scored_at).toISOString().replace('T', ' ').slice(0, 16) + 'Z'} />}
              </dl>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

/**
 * Evidence ledger: for every scored communication, the exact snippets pulled
 * out of the source document, each cited back to the page and line it was read
 * from, so a published score can be checked against the primary text.
 */
export function EvidenceLedger({ allItems }: { allItems: SentimentItem[] }) {
  const [bank, setBank] = useState<'FED' | 'ECB'>('FED');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems
      .filter(i => i.bank === bank && !i.is_statistical)
      .map(rowOf)
      .filter(r => r.snippets.length > 0)
      .filter(r => !q || r.item.title.toLowerCase().includes(q) ||
        r.snippets.some(s => s.quote.toLowerCase().includes(q)))
      .sort((a, b) => (a.item.item_date < b.item.item_date ? 1 : -1));
  }, [allItems, bank, query]);

  const visible = showAll ? rows : rows.slice(0, 8);
  const located = rows.reduce((n, r) => n + r.snippets.filter(s => s.ref?.page).length, 0);
  const total = rows.reduce((n, r) => n + r.snippets.length, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 cursor-help">
                <FileSearch className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Evidence Ledger — Snippets & Source References</h3>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-[12px]">
              Each dimension score must be justified by a verbatim snippet from the document. The snippet is
              matched back into the extracted text, so the page and line it came from are published alongside
              it. Nothing is scored on text that cannot be quoted.
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

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a document title or a quoted phrase…"
          className="h-8 max-w-xs text-[12px]"
        />
        <span className="text-[11px] text-muted-foreground">
          {total.toLocaleString()} snippet{total === 1 ? '' : 's'} across {rows.length.toLocaleString()} document
          {rows.length === 1 ? '' : 's'} · {located.toLocaleString()} with a resolved page/line reference
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No quoted evidence on record for {bank} yet — snippets appear here after the next scoring run.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map(r => <EvidenceRow key={`${r.item.source}|${r.item.title}|${r.item.item_date}`} row={r} />)}
        </div>
      )}

      {rows.length > visible.length && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll(true)}>
          Show all {rows.length} documents
        </Button>
      )}
    </div>
  );
}
