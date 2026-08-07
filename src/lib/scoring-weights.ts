// Client mirror of supabase/functions/_shared/scoring-weights.ts — keep in sync.
// Layer 3 normalization: dynamic time-decay × contextual document tier ×
// statistical reliability weight.

import { CENTRAL_BANK_MEETINGS } from '@/data/meeting-schedule';

export interface WeightableItem {
  bank: string;
  source: string;
  item_date: string;
  title: string;
  is_statistical: boolean;
  net_score: number;
  label?: string;
  stat_weight?: number;
}

const DAY = 86400000;
const daysBetween = (a: Date, b: Date) => (a.getTime() - b.getTime()) / DAY;

/** Half-life shortens near a decision and resets right after one. */
export function dynamicHalfLife(bank: string, now: Date = new Date()): number {
  const dates = CENTRAL_BANK_MEETINGS
    .filter(m => m.bank === bank.toUpperCase())
    .map(m => new Date(m.date + 'T00:00:00Z'));

  if (!dates.length) return 21;
  let toNext = Infinity;
  let sinceLast = Infinity;
  for (const d of dates) {
    const delta = daysBetween(d, now);
    if (delta >= 0) toNext = Math.min(toNext, delta);
    else sinceLast = Math.min(sinceLast, -delta);
  }
  if (toNext <= 5) return 7;
  if (toNext <= 14) return 10;
  if (sinceLast <= 5) return 8;
  return 21;
}

export function decayWeight(itemDate: string, halfLifeDays: number, now: Date = new Date()): number {
  const age = Math.max(0, daysBetween(now, new Date(itemDate + 'T00:00:00Z')));
  return Math.max(0.01, Math.pow(0.5, age / halfLifeDays));
}

export type Tier = 1 | 2 | 3 | 4;

export const TIER_LABEL: Record<Tier, string> = {
  1: 'Binding policy signal',
  2: 'Deliberation record',
  3: 'Individual commentary',
  4: 'Operational / non-monetary',
};

const TIER_MULTIPLIER: Record<Tier, number> = { 1: 1.0, 2: 0.7, 3: 0.4, 4: 0.1 };

const TIER_1 = /monetary policy (statement|decision)|policy decision|fomc statement|press conf|rate decision|combined monetary policy|introductory statement|summary of economic projections|fomc sep/i;
const TIER_2 = /minutes|account|testimony|semiannual|monetary policy report/i;
const TIER_3 = /speech|remarks|keynote|lecture|interview|media|blog|podcast|panel|op-?ed/i;
const TIER_4 = /digital euro|payment|target2|t2s|banknote|supervis|ssm|resolution|balance sheet|financial stability review|annual report|appointment|obituar|award|conference announcement|call for papers|vacanc/i;

export function documentTier(source: string, title: string): Tier {
  const t = `${source} ${title}`;
  if (TIER_4.test(t)) return 4;
  if (TIER_1.test(t)) return 1;
  if (TIER_2.test(t)) return 2;
  if (TIER_3.test(t)) return 3;
  return 3;
}

export function tierMultiplier(source: string, title: string): number {
  return TIER_MULTIPLIER[documentTier(source, title)];
}

export function itemWeight(it: WeightableItem, halfLifeDays: number, now: Date = new Date()): number {
  const decay = decayWeight(it.item_date, halfLifeDays, now);
  if (it.is_statistical) {
    const w = it.stat_weight && it.stat_weight > 0 ? Math.min(3, it.stat_weight) / 2 : 0.5;
    return decay * w;
  }
  return decay * tierMultiplier(it.source || '', it.title || '');
}

export function sentimentLabel(avg: number): string {
  if (avg <= -0.5) return 'STRONGLY DOVISH';
  if (avg < -0.1) return 'DOVISH';
  if (avg >= 0.5) return 'STRONGLY HAWKISH';
  if (avg > 0.1) return 'HAWKISH';
  return 'NEUTRAL';
}

export interface Aggregate {
  avg: number;
  n: number;
  dist: Record<string, number>;
  sentiment: string;
  half_life_days: number;
}

const CHAIR_NAMES = /powell|lagarde|chair|president|jefferson|de guindos/i;

function speakerOf(title: string): string | null {
  const t = (title || '').trim();
  const colon = t.indexOf(':');
  if (colon > 1 && colon < 60) {
    const head = t.slice(0, colon);
    if (/\b(the|and|for|report|statement|minutes|account|update|review)\b/i.test(head)) return null;
    const first = head.split(/,|&| and /i)[0].trim();
    if (first.length >= 3 && first.length <= 40) return first.toLowerCase().replace(/\s+/g, ' ');
  }
  const m = t.match(/^([\p{L}][\p{L}.'-]+),\s/u);
  if (m) return m[1].toLowerCase();
  return null;
}

/** No single non-chair speaker may exceed 10% of the aggregate's total weight. */
export const MAX_SPEAKER_SHARE = 0.10;

export function capSpeakerWeights(items: WeightableItem[], weights: number[]): number[] {
  const w = [...weights];
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    if (it.is_statistical) return;
    const sp = speakerOf(it.title);
    if (!sp || CHAIR_NAMES.test(sp)) return;
    if (!groups.has(sp)) groups.set(sp, []);
    groups.get(sp)!.push(i);
  });
  if (!groups.size) return w;
  for (let pass = 0; pass < 5; pass++) {
    const total = w.reduce((s, v) => s + v, 0);
    if (total <= 0) break;
    let changed = false;
    for (const idxs of groups.values()) {
      const sum = idxs.reduce((s, i) => s + w[i], 0);
      const cap = MAX_SPEAKER_SHARE * total;
      if (sum > cap + 1e-9) {
        const f = cap / sum;
        for (const i of idxs) w[i] *= f;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return w;
}

export function weightedAggregate(sub: WeightableItem[], bank?: string, now: Date = new Date()): Aggregate {
  const scored = sub.filter(i => Math.abs(i.net_score) > 0.001);
  const inferredBank = bank || scored[0]?.bank || 'FED';
  const halfLife = dynamicHalfLife(inferredBank, now);
  if (!scored.length) return { avg: 0, n: 0, dist: {}, sentiment: 'NEUTRAL', half_life_days: halfLife };
  const weights = capSpeakerWeights(scored, scored.map(it => itemWeight(it, halfLife, now)));
  let num = 0;
  let den = 0;
  const dist: Record<string, number> = {};
  scored.forEach((it, i) => {
    const w = weights[i];
    num += it.net_score * w;
    den += w;
    const lb = it.label || (it.net_score > 0.1 ? 'hawkish' : it.net_score < -0.1 ? 'dovish' : 'neutral');
    dist[lb] = (dist[lb] || 0) + 1;
  });
  const avg = den > 0 ? Math.round((num / den) * 1000) / 1000 : 0;
  return { avg, n: scored.length, dist, sentiment: sentimentLabel(avg), half_life_days: halfLife };
}

// ── Layer 4: Aggregate = α·S_text + (1−α)·S_stats (mirrors the edge function) ──
/** Decision date of the bank's most recent policy meeting, or null. */
export function lastMeetingDate(bank: string, now: Date = new Date()): string | null {
  const past = CENTRAL_BANK_MEETINGS
    .filter(m => m.bank === bank.toUpperCase() && m.date <= now.toISOString().split('T')[0])
    .map(m => m.date)
    .sort();
  return past.length ? past[past.length - 1] : null;
}

/**
 * Communication window for a bank: the rolling N days, PLUS every Tier-1
 * binding policy document published on or after the last decision. A rolling
 * window alone can drop the standing policy signal (e.g. a hike two months ago)
 * while keeping weeks of speeches, which mis-times the stance.
 */
export function commsWindow<T extends WeightableItem>(
  items: T[],
  bank: string,
  days: number,
  now: Date = new Date(),
): T[] {
  const cutoff = new Date(now.getTime() - days * DAY).toISOString().split('T')[0];
  const lastMeeting = lastMeetingDate(bank, now);
  return items.filter(i => {
    if (i.bank !== bank.toUpperCase() || i.is_statistical) return false;
    if (i.item_date >= cutoff) return true;
    return !!lastMeeting && documentTier(i.source || '', i.title || '') === 1 && i.item_date >= lastMeeting;
  });
}

// ── Realized-action anchor: the stance implied by what the bank actually DID ──
// A 25bp move maps to ±0.35 on the stance scale, recency-weighted over the
// trailing 180 days (120d half-life) and clamped to ±0.70. This keeps a bank
// that hiked from ranking below a bank that merely held, regardless of how much
// chatter each produced inside the rolling communication window.
export const ANCHOR_OMEGA = 0.35;

/** Published anchor parameters — shown in the UI so the number is reproducible. */
export const ANCHOR_PARAMS = {
  window_days: 180,
  half_life_days: 120,
  score_per_25bp: 0.45,
  clamp: 0.7,
  omega: ANCHOR_OMEGA,
  formula: 'anchor = clamp(Σ (bps/25 × 0.45 × 0.5^(age/120)), ±0.70)',
  calendar: 'src/data/meeting-schedule.ts (verified decision dates)',
} as const;

/** One realized decision and exactly what it contributed to the anchor. */
export interface AnchorAction {
  date: string;
  bps: number;
  age_days: number;
  decay: number;
  contribution: number;
}

export interface PolicyAnchor {
  score: number;
  net_bps: number;
  last: { date: string; bps: number } | null;
  /** Provenance: the decisions used, their weights, and the parameters applied. */
  provenance: {
    params: typeof ANCHOR_PARAMS;
    actions: AnchorAction[];
    raw: number;
    clamped: boolean;
    computed_at: string;
  };
}

export function policyActionAnchor(bank: string, now: Date = new Date()): PolicyAnchor {
  const actions = CENTRAL_BANK_MEETINGS
    .filter(m => m.bank === bank.toUpperCase() && typeof m.bps === 'number')
    .map(m => ({ date: m.date, bps: m.bps as number }));
  let num = 0;
  let netBps = 0;
  let last: { date: string; bps: number } | null = null;
  const used: AnchorAction[] = [];
  for (const a of actions) {
    const age = daysBetween(now, new Date(a.date + 'T00:00:00Z'));
    if (age < 0 || age > ANCHOR_PARAMS.window_days) continue;
    if (!last || a.date > last.date) last = a;
    const decay = Math.pow(0.5, age / ANCHOR_PARAMS.half_life_days);
    const contribution = (a.bps / 25) * ANCHOR_PARAMS.score_per_25bp * decay;
    num += contribution;
    netBps += a.bps;
    used.push({
      date: a.date,
      bps: a.bps,
      age_days: Math.round(age),
      decay: Math.round(decay * 1000) / 1000,
      contribution: Math.round(contribution * 1000) / 1000,
    });
  }
  const clampedScore = Math.max(-ANCHOR_PARAMS.clamp, Math.min(ANCHOR_PARAMS.clamp, num));
  return {
    score: Math.round(clampedScore * 1000) / 1000,
    net_bps: netBps,
    last,
    provenance: {
      params: ANCHOR_PARAMS,
      actions: used.sort((x, y) => (x.date < y.date ? 1 : -1)),
      raw: Math.round(num * 1000) / 1000,
      clamped: Math.abs(num) > ANCHOR_PARAMS.clamp,
      computed_at: new Date().toISOString(),
    },
  };
}


export interface BlendResult extends Aggregate {

  alpha: number;
  text: { avg: number; n: number };
  stats: { avg: number; n: number };
  /** Weight of the realized-action anchor in the headline score. */
  omega: number;
  anchor: PolicyAnchor;
  /** Pure text+stats narrative score, before the realized-action anchor. */
  narrative: number;
  /** How the headline was assembled, for the provenance panel. */
  provenance: {
    formula: string;
    alpha: number;
    omega: number;
    comms_avg: number;
    comms_n: number;
    stats_avg: number;
    stats_n: number;
    narrative: number;
    anchor_score: number;
    half_life_days: number;
    computed_at: string;
  };

}

function freshestAge(items: WeightableItem[], now: Date): number {
  let best = Infinity;
  for (const i of items) {
    const age = Math.max(0, daysBetween(now, new Date(i.item_date + 'T00:00:00Z')));
    if (age < best) best = age;
  }
  return best;
}

export function dynamicAlpha(
  textItems: WeightableItem[],
  statItems: WeightableItem[],
  bank?: string,
  now: Date = new Date(),
): number {
  if (!textItems.length) return 0;
  if (!statItems.length) return 1;
  const gap = Math.max(-14, Math.min(14, freshestAge(statItems, now) - freshestAge(textItems, now)));
  let alpha = 0.6 + (gap / 14) * 0.2;
  if (bank && dynamicHalfLife(bank, now) <= 10) alpha += 0.05;
  return Math.round(Math.max(0.35, Math.min(0.85, alpha)) * 100) / 100;
}

export function blendedAggregate(all: WeightableItem[], bank?: string, now: Date = new Date()): BlendResult {
  const textItems = all.filter(i => !i.is_statistical);
  const statItems = all.filter(i => i.is_statistical);
  const t = weightedAggregate(textItems, bank, now);
  const s = weightedAggregate(statItems, bank, now);
  const alpha = dynamicAlpha(
    textItems.filter(i => Math.abs(i.net_score) > 0.001),
    statItems.filter(i => Math.abs(i.net_score) > 0.001),
    bank,
    now,
  );
  const narrative = Math.round((alpha * t.avg + (1 - alpha) * s.avg) * 1000) / 1000;
  const anchor = policyActionAnchor(bank || 'FED', now);
  const omega = ANCHOR_OMEGA;
  const avg = Math.round(((1 - omega) * narrative + omega * anchor.score) * 1000) / 1000;
  const dist: Record<string, number> = { ...t.dist };
  for (const [k, v] of Object.entries(s.dist)) dist[k] = (dist[k] || 0) + v;
  return {
    avg, n: t.n + s.n, dist, sentiment: sentimentLabel(avg), half_life_days: t.half_life_days,
    alpha, omega, anchor, narrative,
    text: { avg: t.avg, n: t.n }, stats: { avg: s.avg, n: s.n },
    provenance: {
      formula: 'headline = (1-ω)·[α·comms + (1-α)·stats] + ω·anchor',
      alpha, omega,
      comms_avg: t.avg, comms_n: t.n,
      stats_avg: s.avg, stats_n: s.n,
      narrative,
      anchor_score: anchor.score,
      half_life_days: t.half_life_days,
      computed_at: new Date().toISOString(),
    },
  };

}
