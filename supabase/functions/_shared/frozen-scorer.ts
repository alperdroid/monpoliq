// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 (frozen) — deterministic hawk/dove scoring for every communication.
//
// Replaces the numeric part of scoreWithAI(). Same input (title, text), same
// output scale (net_score in [-1, 1]), so Layer 1 (relevance filter) and Layer 3
// (speaker calibration, document tiers, decay, 10% speaker cap, policy anchor)
// keep working unchanged.
//
//   text ─► sentences ─► policy-relevant sentences ─► two scorers per sentence
//        ─► document measure (with shrinkage for short texts)
//        ─► z-score on frozen 1996-2024 scale ─► net_score
//
// Scorers
//   lexicon  rule-based hawk/dove co-occurrence rules (Apel & Blix Grimaldi style)
//   linear   TF-IDF(1-3 grams) + logistic regression trained on 2,326 hand-labelled
//            FOMC sentences (Shah, Paturi & Chava, ACL 2023). Weights frozen in
//            frozen_scorer_bundle.json; bundle_sha is stored with every score.
//
// Same text in → same number out, forever. Change a scorer = new bundle_sha =
// rescore the whole history.
// ─────────────────────────────────────────────────────────────────────────────

import BUNDLE from './frozen_scorer_bundle.json' with { type: 'json' };
export interface Bundle {
  scorer_id: string; lexicon_id: string; bundle_sha: string; ngram_max: number;
  vocab: Record<string, number>; idf: number[]; coef: number[][]; intercept: number[];
  norm: { lexicon_mean: number; lexicon_sd: number; linear_mean: number; linear_sd: number;
          shrinkage_k: number; z_to_net: number; n_docs: number };
}
let B: Bundle = BUNDLE as unknown as Bundle;
export function setBundle(b: Bundle) { B = b; }   // tests only

// Python's re treats \b and \w as Unicode-aware; JavaScript's are ASCII-only even with
// the u flag. U() rewrites a pattern to Python semantics so both runtimes split words
// identically (matters for mojibake like "economyâ€”something" in scraped pages).
const W = '[\\p{L}\\p{N}_]';
const B_ = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
function U(rx: RegExp): RegExp {
  return new RegExp(rx.source.replace(/\\b/g, B_).replace(/\\w/g, W), rx.flags.includes('u') ? rx.flags : rx.flags + 'u');
}

// ── sentence handling (mirrors pipeline/score_docs.py) ──────────────────────
const RELEVANT = U(/\b(inflation|prices?|growth|employment|unemployment|labou?r|rates?|policy|accommodat\w*|tighten\w*|easing|outlook|activity|demand|wages?|expectations?|balance sheet|asset purchases?|target range|federal funds|deposit facility|economy|economic|risks?)\b/i);

export function splitSentences(text: string): string[] {
  const t = text.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
  return t.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).filter(Boolean).length >= 6);
}
export const relevantSentences = (s: string[]) => s.filter(x => RELEVANT.test(x));

// ── lexicon scorer (port of scorers/lexicon.py, lexicon-v1.0) ───────────────
const TARGETS: [string, RegExp, number][] = [
  ['inflation', U(/\b(inflation(?:ary)?|prices?|price stability|cpi|pce|core inflation|deflation|disinflation)\b/g), +1],
  ['growth', U(/\b(growth|activity|output|demand|spending|gdp|expansion|economy|recovery|consumption|investment)\b/g), +1],
  ['labor', U(/\b(employment|jobs?|labou?r market|payrolls?|hiring)\b/g), +1],
  ['unemp', U(/\b(unemployment|slack|joblessness)\b/g), -1],
  ['rate', U(/(?<!unemployment )(?<!participation )\b(federal funds rate|policy rates?|interest rates?|target range|deposit facility rate|key (?:ecb )?interest rates|rates?)\b/g), +1],
  ['accom', U(/\b(accommodat\w+|stimulus|easing|easy|loose)\b/g), -1],
  ['tight', U(/\b(tighten\w*|restrictive|tightness|restraint)\b/g), +1],
];
const UP = U(/\b(rise|rises|risen|rising|rose|increas\w+|higher?|elevat\w+|strong\w*|robust|solid|firm\w*|pick\w* up|accelerat\w+|upward|upside|expand\w*|improv\w+|boost\w*|pressures?|persist\w*|above|exceed\w*|overheat\w*|tight\w*)\b/g);
const DOWN = U(/\b(fall\w*|fell|declin\w+|lower\w*|decreas\w+|weak\w*|soft\w*|slow\w*|moderat\w+|subdued|eas\w+|downward|downside|contract\w*|deteriorat\w+|below|shortfall|sluggish|cool\w*|drag|recession\w*|slack)\b/g);
const NEG = U(/\b(not|no|neither|nor|without|less|little|hardly|barely|fail\w*|unlikely|no longer)\b/g);
const PHRASES: [RegExp, number, number][] = [
  [U(/\b(raise|raising|raised|hike|hiking|hiked|increase|increasing|lift(?:ing|ed)?)\b[^.]{0,40}\b(rates?|target range|federal funds)/g), 2, 0],
  [U(/\b(cut|cutting|lower|lowering|lowered|reduce|reducing|reduced|ease|easing)\b[^.]{0,40}\b(rates?|target range|federal funds|deposit facility)/g), 0, 2],
  [U(/\b(further|additional|continued|ongoing)\s+(firming|tightening|increases? in the target range|policy firming|rate increases?)/g), 2, 0],
  [U(/\b(further|additional|continued|ongoing)\s+(easing|accommodation|rate cuts?|reductions? in the target range)/g), 0, 2],
  [U(/\b(remove|removing|removal of|reduce|reducing|scaling back|withdraw\w*)\s+(policy\s+)?accommodation/g), 2, 0],
  [U(/\b(maintain|provide|providing|add|additional|substantial|ample|considerable)\s+(policy\s+)?accommodation/g), 0, 2],
  [U(/\bbalance sheet (?:reduction|runoff|normalization)|\breduce (?:its|the) (?:securities )?holdings|\bquantitative tightening/g), 2, 0],
  [U(/\basset purchases?|\bquantitative easing|\bexpand (?:its|the) balance sheet|\breinvest\w*/g), 0, 2],
  [U(/\bupside risks? to inflation|\binflation(?:ary)? (?:pressures?|risks?) (?:have )?(?:increased|risen|remain\w* elevated)/g), 2, 0],
  [U(/\bdownside risks? to (?:growth|activity|the outlook|the economy)|\brisks? (?:to the outlook )?(?:are |remain )?(?:tilted |skewed )?to the downside/g), 0, 2],
  [U(/\b(maintain\w*|remain\w*|keep\w*|retain\w*)\b[^.]{0,40}\baccommodative/g), 0, 2],
  [U(/\bpatien(?:t|ce)|\bwait(?:ing)? (?:for|to see)|\bgradual/g), 0, 1],
  [U(/\bvigilan(?:t|ce)|\bresolute|\bwhatever it takes to (?:restore|bring)|\bfirmly committed to (?:returning|bringing) inflation/g), 1, 0],
];
const starts = (rx: RegExp, s: string) => [...s.matchAll(rx)].map(m => m.index!);

// Sub-dimensions shown in the UI (same names and sign convention as the old Gemini rubric:
// positive = hawkish). Each lexicon rule belongs to exactly one dimension.
export type Dim = 'inflation_persistence' | 'policy_stance' | 'growth_labor_drag';
export const DIMS: Dim[] = ['inflation_persistence', 'policy_stance', 'growth_labor_drag'];
const TARGET_DIM: Record<string, Dim> = {
  inflation: 'inflation_persistence', growth: 'growth_labor_drag', labor: 'growth_labor_drag', unemp: 'growth_labor_drag',
  rate: 'policy_stance', accom: 'policy_stance', tight: 'policy_stance',
};
const PHRASE_DIM: Dim[] = ['policy_stance', 'policy_stance', 'policy_stance', 'policy_stance', 'policy_stance', 'policy_stance',
  'policy_stance', 'policy_stance', 'inflation_persistence', 'growth_labor_drag', 'policy_stance', 'policy_stance', 'inflation_persistence'];

/** Hawk/dove points split by dimension, plus which dimensions the sentence talks about. */
export function lexiconByDim(sentence: string, window = 6) {
  const s = sentence.toLowerCase();
  const pts: Record<Dim, [number, number]> = { inflation_persistence: [0, 0], policy_stance: [0, 0], growth_labor_drag: [0, 0] };
  const topics = new Set<Dim>();
  PHRASES.forEach(([rx, h, d], i) => {
    const n = [...s.matchAll(rx)].length;
    if (n) { const dm = PHRASE_DIM[i]; pts[dm][0] += h * n; pts[dm][1] += d * n; topics.add(dm); }
  });
  const tokStarts = [...s.matchAll(/[a-z][a-z'-]*/g)].map(m => m.index!);
  const idx = (c: number) => { const i = tokStarts.findIndex(st => st >= c); return i === -1 ? tokStarts.length - 1 : i; };
  const dirs: [number, number][] = [...starts(UP, s).map(c => [idx(c), +1] as [number, number]),
                                    ...starts(DOWN, s).map(c => [idx(c), -1] as [number, number])];
  const negs = starts(NEG, s).map(idx);
  for (const [name, rx, sign] of TARGETS) {
    const dm = TARGET_DIM[name];
    for (const c of starts(rx, s)) {
      topics.add(dm);
      const ti = idx(c);
      for (const [di, dsign] of dirs) {
        if (Math.abs(di - ti) <= window && di !== ti) {
          const flipped = negs.some(n => di - n > 0 && di - n <= 3);
          (sign * dsign * (flipped ? -1 : 1) > 0) ? pts[dm][0]++ : pts[dm][1]++;
        }
      }
    }
  }
  return { pts, topics };
}

export function lexiconPoints(sentence: string, window = 6): [number, number] {
  const { pts } = lexiconByDim(sentence, window);
  return DIMS.reduce<[number, number]>((a, d) => [a[0] + pts[d][0], a[1] + pts[d][1]], [0, 0]);
}
export function lexiconLabel(s: string): 0 | 1 | 2 {         // 0 dove, 1 hawk, 2 neutral
  const [h, d] = lexiconPoints(s); return h > d ? 1 : d > h ? 0 : 2;
}

// ── linear scorer (TF-IDF + multinomial logistic regression) ────────────────
function tokens(s: string): string[] {
  const low = s.toLowerCase();                                                // sklearn: lowercase first,
  const t = /^[\x00-\x7f]*$/.test(low) ? low : low.normalize('NFKD').replace(/\p{M}/gu, ''); // then strip_accents='unicode'
  return (t.match(/[\p{L}\p{N}_]+/gu) || []).filter(w => w.length >= 2);     // token_pattern \b\w\w+\b
}
export function linearProba(sentence: string): [number, number, number] {   // [p_dove, p_hawk, p_neutral]
  const tk = tokens(sentence);
  const counts = new Map<number, number>();
  for (let n = 1; n <= B.ngram_max; n++) {
    for (let i = 0; i + n <= tk.length; i++) {
      const j = B.vocab[tk.slice(i, i + n).join(' ')];
      if (j !== undefined) counts.set(j, (counts.get(j) || 0) + 1);
    }
  }
  let norm = 0; const feats: [number, number][] = [];
  for (const [j, c] of counts) { const v = (1 + Math.log(c)) * B.idf[j]; feats.push([j, v]); norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  const z = B.intercept.map((b, k) => b + feats.reduce((a, [j, v]) => a + B.coef[k][j] * v / norm, 0));
  const mx = Math.max(...z); const e = z.map(x => Math.exp(x - mx)); const S = e.reduce((a, b) => a + b, 0);
  return [e[0] / S, e[1] / S, e[2] / S];
}

// ── document scoring ─────────────────────────────────────────────────────────
export interface SentenceScore { text: string; lexicon: 0 | 1 | 2; p_dove: number; p_hawk: number; p_neutral: number;
  dimLean: Partial<Record<Dim, number>> }   // per-dimension lexicon lean (-1/0/+1) for dimensions the sentence covers
export interface FrozenScore {
  net_score: number;              // [-1, 1], drop-in for the current net_score
  label: 'hawkish' | 'dovish' | 'neutral';
  z: number;                      // ensemble z on the frozen historical scale
  lexicon_measure: number; linear_soft_measure: number;   // raw, unshrunk
  n_sentences: number;            // policy-relevant sentences scored
  scorer_agreement: number;       // share of sentences where both scorers agree on direction
  evidence: { hawkish: string[]; dovish: string[] };      // top sentences driving the score
  dimensions: Record<Dim, number>;                        // [-1, 1], + = hawkish; deterministic
  dimension_evidence: Partial<Record<Dim, string>>;       // strongest sentence behind each dimension
  dimension_n: Record<Dim, number>;                       // sentences covering each dimension
  versions: { lexicon: string; linear: string; bundle_sha: string };
  scored: boolean;
}

export const DIM_VERSION = 'dims-v1.0';
const DIM_K = 3;
let DIM_SCALE = 0.257;   // frozen after calibration on 1,017 Fed speeches (p95 of |dimension| = 0.8)
export function _setDimScaleForCalibration(x: number) { DIM_SCALE = x; }

export function scoreText(text: string, neutralBand = 0.1): FrozenScore {
  const sents = relevantSentences(splitSentences(text || ''));
  const versions = { lexicon: B.lexicon_id, linear: B.scorer_id, bundle_sha: B.bundle_sha };
  const zeroDims = { inflation_persistence: 0, policy_stance: 0, growth_labor_drag: 0 };
  const empty = { net_score: 0, label: 'neutral' as const, z: 0, lexicon_measure: 0, linear_soft_measure: 0,
                  n_sentences: 0, scorer_agreement: 0, evidence: { hawkish: [], dovish: [] },
                  dimensions: { ...zeroDims }, dimension_evidence: {}, dimension_n: { ...zeroDims }, versions, scored: false };
  if (sents.length === 0) return empty;

  const rows: SentenceScore[] = sents.map(t => {
    const [pd, ph, pn] = linearProba(t);
    const { pts, topics } = lexiconByDim(t);
    const tot = DIMS.reduce((a, d) => a + pts[d][0] - pts[d][1], 0);
    const dimLean: Partial<Record<Dim, number>> = {};
    for (const d of topics) dimLean[d] = Math.sign(pts[d][0] - pts[d][1]);
    return { text: t, lexicon: (tot > 0 ? 1 : tot < 0 ? 0 : 2) as 0 | 1 | 2, p_dove: pd, p_hawk: ph, p_neutral: pn, dimLean };
  });
  const n = rows.length, N = B.norm, k = N.shrinkage_k;
  const lexSum = rows.reduce((a, r) => a + (r.lexicon === 1 ? 1 : r.lexicon === 0 ? -1 : 0), 0);
  const linSum = rows.reduce((a, r) => a + (r.p_hawk - r.p_dove), 0);
  // Shrinkage: a 2-sentence media quote cannot swing the index like a 150-sentence
  // press conference. Short texts are pulled toward the historical mean.
  const lexShrunk = (lexSum + k * N.lexicon_mean) / (n + k);
  const linShrunk = (linSum + k * N.linear_mean) / (n + k);
  const z = ((lexShrunk - N.lexicon_mean) / N.lexicon_sd + (linShrunk - N.linear_mean) / N.linear_sd) / 2;
  const net = Math.max(-1, Math.min(1, z / N.z_to_net));

  const dir = (r: SentenceScore) => r.p_hawk > Math.max(r.p_dove, r.p_neutral) ? 1 : r.p_dove > Math.max(r.p_hawk, r.p_neutral) ? 0 : 2;
  const agree = rows.filter(r => dir(r) === r.lexicon).length / n;
  const byLean = [...rows].sort((a, b) => (b.p_hawk - b.p_dove) - (a.p_hawk - a.p_dove));
  const evidence = {
    hawkish: byLean.filter(r => r.p_hawk - r.p_dove > 0.2).slice(0, 3).map(r => r.text),
    dovish: byLean.reverse().filter(r => r.p_dove - r.p_hawk > 0.2).slice(0, 3).map(r => r.text),
  };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;

  // Dimensions: average over the sentences that talk about each topic of
  // ½·(lexicon lean for that topic) + ½·(linear hawk−dove probability), shrunk toward 0
  // for thin evidence (DIM_K pseudo-sentences), scaled once on the 1996-2022 Fed speech corpus.
  const dimensions = { inflation_persistence: 0, policy_stance: 0, growth_labor_drag: 0 } as Record<Dim, number>;
  const dimension_n = { inflation_persistence: 0, policy_stance: 0, growth_labor_drag: 0 } as Record<Dim, number>;
  const dimension_evidence: Partial<Record<Dim, string>> = {};
  for (const d of DIMS) {
    const cov = rows.filter(r => r.dimLean[d] !== undefined).map(r => ({ r, v: 0.5 * r.dimLean[d]! + 0.5 * (r.p_hawk - r.p_dove) }));
    dimension_n[d] = cov.length;
    if (!cov.length) continue;
    const raw = cov.reduce((a, c) => a + c.v, 0) / (cov.length + DIM_K);
    dimensions[d] = r3(Math.max(-1, Math.min(1, raw / DIM_SCALE)));
    const best = cov.filter(c => Math.sign(c.v) === Math.sign(raw)).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    if (best && Math.abs(best.v) > 0.2) dimension_evidence[d] = best.r.text.slice(0, 240);
  }
  return {
    net_score: r3(net), label: net > neutralBand ? 'hawkish' : net < -neutralBand ? 'dovish' : 'neutral',
    z: r3(z), lexicon_measure: r3(lexSum / n), linear_soft_measure: r3(linSum / n),
    n_sentences: n, scorer_agreement: r3(agree), evidence, dimensions, dimension_evidence, dimension_n, versions, scored: true,
  };
}
