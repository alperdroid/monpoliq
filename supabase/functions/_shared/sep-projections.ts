// ─────────────────────────────────────────────────────────────────────────────
// FOMC Summary of Economic Projections (SEP), scored without an LLM.
//
// FRED republishes the SEP medians (and, before September 2015, only the central
// tendency midpoints) as annual series, and ALFRED keeps every vintage. A new
// vintage starts on each SEP release, so the projections published at a meeting
// are the values valid on that vintage's first day, and the previous SEP's are
// the values valid the day before. No table parsing and no Gemini.
//
// The score is the existing SEP delta formula (scoreSEPDelta), unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export interface SEPProjections {
  gdp_current: number | null;
  gdp_next: number | null;
  unemployment_current: number | null;
  unemployment_next: number | null;
  pce_current: number | null;
  pce_next: number | null;
  core_pce_current: number | null;
  core_pce_next: number | null;
  fed_funds_current: number | null;
  fed_funds_next: number | null;
  fed_funds_longer_run: number | null;
}

type Variable = 'gdp' | 'unemployment' | 'pce' | 'core_pce' | 'fed_funds' | 'fed_funds_lr';

/** FRED series per variable: the median first, the central tendency midpoint as the pre-2015 fallback. */
export const SEP_SERIES: Record<Variable, string[]> = {
  gdp: ['GDPC1MD', 'GDPC1CTM'],
  unemployment: ['UNRATEMD', 'UNRATECTM'],
  pce: ['PCECTPIMD', 'PCECTPICTM'],
  core_pce: ['JCXFEMD', 'JCXFECTM'],
  fed_funds: ['FEDTARMD', 'FEDTARCTM'],
  fed_funds_lr: ['FEDTARMDLR', 'FEDTARCTMLR'],
};

/** One ALFRED row (output_type=1): `value` for projection year `date`, valid from realtime_start to realtime_end. */
export interface VintageRow { date: string; value: number; realtime_start: string; realtime_end: string }

export function parseVintageRows(json: unknown): VintageRow[] {
  const obs = (json as { observations?: Record<string, string>[] })?.observations ?? [];
  const out: VintageRow[] = [];
  for (const o of obs) {
    const v = parseFloat(o.value);
    if (o.value === '.' || !Number.isFinite(v)) continue;
    out.push({ date: o.date, value: v, realtime_start: o.realtime_start, realtime_end: o.realtime_end });
  }
  return out;
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** First day of the vintage published for the SEP of `sepDate` (same day, or up to a week later), or null. */
export function releaseVintage(rows: VintageRow[], sepDate: string): string | null {
  const last = addDays(sepDate, 7);
  const starts = [...new Set(rows.map(r => r.realtime_start))].filter(s => s >= sepDate && s <= last).sort();
  return starts[0] ?? null;
}

/** Value for projection year `year` valid on `day`; for a longer-run series (`year` null) the latest observation. */
export function valueOn(rows: VintageRow[], day: string, year: number | null): number | null {
  const valid = rows.filter(r => r.realtime_start <= day && day <= r.realtime_end);
  if (year === null) {
    const latest = valid.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return latest ? latest.value : null;
  }
  const hit = valid.find(r => r.date.slice(0, 4) === String(year));
  return hit ? hit.value : null;
}

export interface SepComparison {
  current: SEPProjections;
  previous: SEPProjections;
  /** Series actually used per variable (median or central tendency midpoint). */
  series: Partial<Record<Variable, string>>;
}

const empty = (): SEPProjections => ({
  gdp_current: null, gdp_next: null, unemployment_current: null, unemployment_next: null,
  pce_current: null, pce_next: null, core_pce_current: null, core_pce_next: null,
  fed_funds_current: null, fed_funds_next: null, fed_funds_longer_run: null,
});

/**
 * Projections published at the SEP of `sepDate` and those of the SEP before it, from ALFRED rows
 * per series id. Each variable uses the first series that has a vintage for this release, so the
 * current and previous values always come from the same series. Null when nothing matched.
 */
export function compareSep(rowsBySeries: Record<string, VintageRow[]>, sepDate: string): SepComparison | null {
  const year = +sepDate.slice(0, 4);
  const current = empty(), previous = empty();
  const series: SepComparison['series'] = {};
  for (const [variable, ids] of Object.entries(SEP_SERIES) as [Variable, string[]][]) {
    for (const id of ids) {
      const rows = rowsBySeries[id];
      if (!rows?.length) continue;
      const day = releaseVintage(rows, sepDate);
      if (!day) continue;
      const before = addDays(day, -1);
      series[variable] = id;
      if (variable === 'fed_funds_lr') {
        current.fed_funds_longer_run = valueOn(rows, day, null);
        previous.fed_funds_longer_run = valueOn(rows, before, null);
      } else {
        const k = variable as Exclude<Variable, 'fed_funds_lr'>;
        current[`${k}_current`] = valueOn(rows, day, year);
        current[`${k}_next`] = valueOn(rows, day, year + 1);
        previous[`${k}_current`] = valueOn(rows, before, year);
        previous[`${k}_next`] = valueOn(rows, before, year + 1);
      }
      break;
    }
  }
  return Object.keys(series).length ? { current, previous, series } : null;
}

export function scoreSEPDelta(current: SEPProjections, previous: SEPProjections): { score: number; label: string; reasons: string[] } {
  const deltas: { name: string; delta: number; direction: string; weight: number }[] = [];
  if (current.gdp_current != null && previous.gdp_current != null) deltas.push({ name: 'GDP current yr', delta: current.gdp_current - previous.gdp_current, direction: 'hh', weight: 2 });
  if (current.gdp_next != null && previous.gdp_next != null) deltas.push({ name: 'GDP next yr', delta: current.gdp_next - previous.gdp_next, direction: 'hh', weight: 1.5 });
  if (current.unemployment_current != null && previous.unemployment_current != null) deltas.push({ name: 'UE current yr', delta: current.unemployment_current - previous.unemployment_current, direction: 'lh', weight: 2 });
  if (current.unemployment_next != null && previous.unemployment_next != null) deltas.push({ name: 'UE next yr', delta: current.unemployment_next - previous.unemployment_next, direction: 'lh', weight: 1.5 });
  if (current.pce_current != null && previous.pce_current != null) deltas.push({ name: 'PCE current yr', delta: current.pce_current - previous.pce_current, direction: 'hh', weight: 3 });
  if (current.pce_next != null && previous.pce_next != null) deltas.push({ name: 'PCE next yr', delta: current.pce_next - previous.pce_next, direction: 'hh', weight: 2 });
  if (current.core_pce_current != null && previous.core_pce_current != null) deltas.push({ name: 'Core PCE current yr', delta: current.core_pce_current - previous.core_pce_current, direction: 'hh', weight: 3.5 });
  if (current.core_pce_next != null && previous.core_pce_next != null) deltas.push({ name: 'Core PCE next yr', delta: current.core_pce_next - previous.core_pce_next, direction: 'hh', weight: 2.5 });
  if (current.fed_funds_current != null && previous.fed_funds_current != null) deltas.push({ name: 'FFR current yr', delta: current.fed_funds_current - previous.fed_funds_current, direction: 'hh', weight: 3 });
  if (current.fed_funds_next != null && previous.fed_funds_next != null) deltas.push({ name: 'FFR next yr', delta: current.fed_funds_next - previous.fed_funds_next, direction: 'hh', weight: 2.5 });
  if (current.fed_funds_longer_run != null && previous.fed_funds_longer_run != null) deltas.push({ name: 'FFR longer-run', delta: current.fed_funds_longer_run - previous.fed_funds_longer_run, direction: 'hh', weight: 2 });

  if (deltas.length === 0) return { score: 0, label: 'neutral', reasons: ['No comparable projections found'] };

  let weightedSum = 0, totalWeight = 0;
  const reasons: string[] = [];
  for (const d of deltas) {
    let rawSignal = d.delta / 0.3; // 0.3pp normalizer
    if (d.direction === 'lh') rawSignal = -rawSignal;
    rawSignal = Math.max(-1, Math.min(1, rawSignal));
    weightedSum += rawSignal * d.weight;
    totalWeight += d.weight;
    if (Math.abs(d.delta) >= 0.05) {
      const dir = (d.direction === 'hh' ? (d.delta > 0 ? '↑hawk' : '↓dove') : (d.delta > 0 ? '↓dove' : '↑hawk'));
      reasons.push(`${d.name}: ${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)}pp ${dir}`);
    }
  }
  const score = Math.round((weightedSum / totalWeight) * 1000) / 1000;
  const clampedScore = Math.max(-1, Math.min(1, score));
  const label = clampedScore > 0.05 ? 'hawkish' : clampedScore < -0.05 ? 'dovish' : 'neutral';
  if (reasons.length === 0) reasons.push('Minimal changes from previous SEP');
  return { score: clampedScore, label, reasons };
}
