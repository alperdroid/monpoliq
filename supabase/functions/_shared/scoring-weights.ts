// ─────────────────────────────────────────────────────────────────────────────
// Layer 3 normalization weights: dynamic time-decay + contextual hierarchy
// Shared by sentiment-analysis and any other function that aggregates scores.
// Mirrored on the client in src/lib/scoring-weights.ts — keep both in sync.
// ─────────────────────────────────────────────────────────────────────────────

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

// Verified policy meeting calendar (decision dates) — mirrors src/data/meeting-schedule.ts
export const MEETINGS_2026: Record<string, string[]> = {
  FED: ['2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'],
  ECB: ['2025-12-18', '2026-02-05', '2026-03-19', '2026-04-30', '2026-06-11', '2026-07-23', '2026-09-10', '2026-10-29', '2026-12-17'],
};

/**
 * Realized policy actions in basis points (+ hike / − cut / 0 hold).
 * Mirrors the `bps` field in src/data/meeting-schedule.ts.
 */
export const POLICY_ACTIONS: Record<string, { date: string; bps: number }[]> = {
  FED: [
    { date: '2025-06-18', bps: -25 }, { date: '2025-07-30', bps: -25 },
    { date: '2025-09-17', bps: -25 }, { date: '2025-10-29', bps: 0 },
    { date: '2025-12-10', bps: -25 }, { date: '2026-01-28', bps: 0 },
    { date: '2026-03-18', bps: 0 }, { date: '2026-04-29', bps: 0 },
    { date: '2026-06-17', bps: 0 }, { date: '2026-07-29', bps: 0 },
  ],
  ECB: [
    { date: '2025-03-06', bps: -25 }, { date: '2025-04-17', bps: -25 },
    { date: '2025-06-05', bps: -25 }, { date: '2025-07-24', bps: 0 },
    { date: '2025-09-11', bps: 0 }, { date: '2025-10-30', bps: 0 },
    { date: '2025-12-18', bps: 0 }, { date: '2026-02-05', bps: 0 },
    { date: '2026-03-19', bps: 0 }, { date: '2026-04-30', bps: 0 },
    { date: '2026-06-11', bps: 25 }, { date: '2026-07-23', bps: 0 },
  ],
};

/** Weight of the realized-action anchor inside the headline aggregate. */
export const ANCHOR_OMEGA = 0.35;

/** Published anchor parameters — mirrored in src/lib/scoring-weights.ts. */
export const ANCHOR_PARAMS = {
  window_days: 180,
  half_life_days: 120,
  score_per_25bp: 0.45,
  clamp: 0.7,
  omega: ANCHOR_OMEGA,
  formula: 'anchor = clamp(Σ (bps/25 × 0.45 × 0.5^(age/120)), ±0.70)',
  calendar: '_shared/scoring-weights.ts POLICY_ACTIONS (verified decision dates)',
} as const;

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
  provenance: {
    params: typeof ANCHOR_PARAMS;
    actions: AnchorAction[];
    raw: number;
    clamped: boolean;
    computed_at: string;
  };
}

/**
 * Realized-action anchor: the stance implied by what the bank actually DID,
 * recency-weighted over the trailing 180 days (120d half-life). A 25bp move
 * maps to ±0.45 per 25bp before decay; the anchor is clamped to ±0.70. Each
 * contributing decision is returned so the number can be re-derived by hand.
 */
export function policyActionAnchor(bank: string, now: Date = new Date()): PolicyAnchor {
  const actions = POLICY_ACTIONS[bank.toUpperCase()] || [];
  let num = 0;
  let netBps = 0;
  let last: { date: string; bps: number } | null = null;
  const used: AnchorAction[] = [];
  for (const a of actions) {
    const age = (now.getTime() - new Date(a.date + 'T00:00:00Z').getTime()) / 86400000;
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
  const score = Math.round(Math.max(-ANCHOR_PARAMS.clamp, Math.min(ANCHOR_PARAMS.clamp, num)) * 1000) / 1000;
  return {
    score,
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




const DAY = 86400000;

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / DAY;
}

/**
 * Dynamic half-life: the market's memory shortens as a decision approaches and
 * resets immediately after one, because pre-meeting guidance supersedes older talk.
 *   - within 5 days of the next meeting      →  7d half-life (very reactive)
 *   - within 14 days of the next meeting     → 10d
 *   - within 5 days after the last meeting   →  8d (fresh regime)
 *   - otherwise                              → 21d (baseline)
 */
export function dynamicHalfLife(bank: string, now: Date = new Date()): number {
  const dates = (MEETINGS_2026[bank.toUpperCase()] || []).map(d => new Date(d + 'T00:00:00Z'));
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

/** Exponential decay weight: 0.5 ** (age / halfLife), floored so old items never vanish entirely. */
export function decayWeight(itemDate: string, halfLifeDays: number, now: Date = new Date()): number {
  const age = Math.max(0, daysBetween(now, new Date(itemDate + 'T00:00:00Z')));
  return Math.max(0.01, Math.pow(0.5, age / halfLifeDays));
}

export type Tier = 1 | 2 | 3 | 4;

const TIER_MULTIPLIER: Record<Tier, number> = {
  1: 1.0,  // binding policy signal
  2: 0.7,  // deliberation record / sworn testimony
  3: 0.4,  // individual commentary
  4: 0.1,  // operational, administrative, non-monetary
};

const TIER_1 = /monetary policy (statement|decision)|policy decision|fomc statement|press conf|rate decision|combined monetary policy|introductory statement|summary of economic projections|fomc sep/i;
const TIER_2 = /minutes|account|testimony|semiannual|monetary policy report/i;
const TIER_3 = /speech|remarks|keynote|lecture|interview|media|blog|podcast|panel|op-?ed/i;
const TIER_4 = /digital euro|payment|target2|t2s|banknote|supervis|ssm|resolution|balance sheet|financial stability review|annual report|appointment|obituar|award|conference announcement|call for papers|vacanc/i;

/** Contextual hierarchy: what kind of document is this, and how binding is it? */
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

/** Full Layer-3 weight for one item. */
export function itemWeight(it: WeightableItem, halfLifeDays: number, now: Date = new Date()): number {
  const decay = decayWeight(it.item_date, halfLifeDays, now);
  if (it.is_statistical) {
    // Statistical items carry their own reliability weight (1–3 in the metric table).
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
  tier_mix?: Record<string, number>;
}

/** Chairs/Presidents speak for the committee, so they are exempt from the cap. */
const CHAIR_NAMES = /powell|lagarde|chair|president|jefferson|de guindos/i;

/** Pull the speaker out of a communication title ("Nagel: Act now …"). */
function speakerOf(title: string): string | null {
  const t = (title || '').trim();
  const colon = t.indexOf(':');
  if (colon > 1 && colon < 60) {
    const head = t.slice(0, colon);
    if (/\b(the|and|for|report|statement|minutes|account|update|review)\b/i.test(head)) return null;
    const first = head.split(/,|&| and /i)[0].trim();
    if (first.length >= 3 && first.length <= 40) return first.toLowerCase().replace(/\s+/g, ' ');
  }
  const m = t.match(/^([\p{L}][\p{L}.'-]+),\s/u); // "Cook, Outlook for …"
  if (m) return m[1].toLowerCase();
  return null;
}

/**
 * Concentration cap: no single (non-chair) speaker may contribute more than
 * MAX_SPEAKER_SHARE of the total weight of the aggregate. Excess weight is
 * scaled down proportionally across that speaker's items.
 */
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

/**
 * Weighted aggregate: exponential time-decay × contextual tier × statistical
 * reliability, with a 10% per-speaker concentration cap.
 */
export function weightedAggregate(sub: WeightableItem[], bank?: string, now: Date = new Date()): Aggregate {
  const scored = sub.filter(i => Math.abs(i.net_score) > 0.001);
  const inferredBank = bank || scored[0]?.bank || 'FED';
  const halfLife = dynamicHalfLife(inferredBank, now);
  if (!scored.length) {
    return { avg: 0, n: 0, dist: {}, sentiment: 'NEUTRAL', half_life_days: halfLife };
  }
  const weights = capSpeakerWeights(scored, scored.map(it => itemWeight(it, halfLife, now)));
  let num = 0;
  let den = 0;
  const dist: Record<string, number> = {};
  const tierMix: Record<string, number> = {};
  scored.forEach((it, i) => {
    const w = weights[i];
    num += it.net_score * w;
    den += w;
    const lb = it.label || (it.net_score > 0.1 ? 'hawkish' : it.net_score < -0.1 ? 'dovish' : 'neutral');
    dist[lb] = (dist[lb] || 0) + 1;
    if (!it.is_statistical) {
      const tier = 'T' + documentTier(it.source || '', it.title || '');
      tierMix[tier] = (tierMix[tier] || 0) + 1;
    }
  });
  const avg = den > 0 ? Math.round((num / den) * 1000) / 1000 : 0;
  return { avg, n: scored.length, dist, sentiment: sentimentLabel(avg), half_life_days: halfLife, tier_mix: tierMix };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — Aggregate scoring & market alignment
//   Aggregate = α · S_text + (1 − α) · S_stats
// α is dynamic: it rises when communication is fresh (post-meeting guidance,
// pre-meeting signalling) and falls when the newest input is a macro release.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlendResult extends Aggregate {
  alpha: number;
  text: { avg: number; n: number };
  stats: { avg: number; n: number };
  omega: number;
  anchor: { score: number; net_bps: number; last: { date: string; bps: number } | null };
  narrative: number;
}


function freshestAge(items: WeightableItem[], now: Date): number {
  let best = Infinity;
  for (const i of items) {
    const age = Math.max(0, daysBetween(now, new Date(i.item_date + 'T00:00:00Z')));
    if (age < best) best = age;
  }
  return best;
}

/**
 * Dynamic α from relative freshness of the two channels.
 * Base 0.6 on text, shifted up to ±0.2 toward whichever channel spoke last,
 * and pushed toward text inside two weeks of a decision (guidance dominates).
 */
export function dynamicAlpha(
  textItems: WeightableItem[],
  statItems: WeightableItem[],
  bank?: string,
  now: Date = new Date(),
): number {
  if (!textItems.length) return 0;
  if (!statItems.length) return 1;
  const tAge = freshestAge(textItems, now);
  const sAge = freshestAge(statItems, now);
  let alpha = 0.6;
  const gap = Math.max(-14, Math.min(14, sAge - tAge)); // >0 → text is fresher
  alpha += (gap / 14) * 0.2;
  if (bank && dynamicHalfLife(bank, now) <= 10) alpha += 0.05; // meeting imminent
  return Math.round(Math.max(0.35, Math.min(0.85, alpha)) * 100) / 100;
}

/** Layer-4 blended aggregate across the NLP and quantitative channels. */
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
    avg,
    n: t.n + s.n,
    dist,
    sentiment: sentimentLabel(avg),
    half_life_days: t.half_life_days,
    tier_mix: t.tier_mix,
    alpha,
    omega,
    anchor,
    narrative,
    text: { avg: t.avg, n: t.n },

    stats: { avg: s.avg, n: s.n },
  };
}
