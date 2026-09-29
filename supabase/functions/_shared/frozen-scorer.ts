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
import DECISION from './frozen_decision_bundle.json' with { type: 'json' };
export interface Bundle {
  scorer_id: string; lexicon_id: string; bundle_sha: string; ngram_max: number;
  vocab: Record<string, number>; idf: number[]; coef: number[][]; intercept: number[];
  norm: { lexicon_mean: number; lexicon_sd: number; linear_mean: number; linear_sd: number;
          shrinkage_k: number; z_to_net: number; n_docs: number };
}
let B: Bundle = BUNDLE as unknown as Bundle;
export function setBundle(b: Bundle) { B = b; }   // tests only

export interface DecisionBundle {
  decision_id: string; bundle_sha: string; lexicon_mean: number; lexicon_sd: number; linear_mean: number; linear_sd: number;
  shrinkage_k: number; z_to_net: number; decision_window_sentences: number; action_base: { le25: number; le50: number; gt50: number };
}
let D: DecisionBundle = DECISION as unknown as DecisionBundle;
export function setDecisionBundle(d: DecisionBundle) { D = d; }   // tests only

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
  versions: { lexicon: string; linear: string; bundle_sha: string; decision?: string; decision_bundle_sha?: string };
  decision?: DecisionInfo;   // present for decision documents only
  scored: boolean;
}

export const DIM_VERSION = 'dims-v1.0';
const DIM_K = 3;
let DIM_SCALE = 0.257;   // frozen after calibration on 1,017 Fed speeches (p95 of |dimension| = 0.8)
export function _setDimScaleForCalibration(x: number) { DIM_SCALE = x; }

function scoreGeneral(text: string, neutralBand = 0.1): FrozenScore {
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


// ─────────────────────────────────────────────────────────────────────────────
// DECISION DOCUMENTS (decision-v1.0): FOMC statements, ECB "Monetary policy decisions".
//
// Short, formulaic texts where one sentence carries the decision and the rest is
// largely genre boilerplate. Scored as ACTION + WORDS (Gürkaynak, Sack & Swanson 2005):
//   action  read deterministically from the decision sentence: raise / cut / hold and size
//           → base A = ±0.6 (≤25bp), ±0.8 (≤50bp), ±1.0 (>50bp), 0 for a hold.
//           If the size is not stated (only the new range), 25bp is assumed.
//   words   all other relevant sentences, scored by the same lexicon + linear model but
//           normalised on the statement genre (frozen_decision_bundle.json) with shrinkage k=2.
//   score   net = clamp(A + W·(1 − |A|)): the decision sets the base, the words move the
//           score within the remaining room. Holds are scored by their words alone.
// Validated on 200 FOMC statements (1999-2024) and 266 ECB statements: decision direction
// read correctly 200/200 and 265/265; correlation with the actual rate move 0.74 / 0.75
// (general scorer: 0.42 / 0.36).
// ─────────────────────────────────────────────────────────────────────────────
export type DocClass = 'general' | 'decision';

export interface DecisionInfo {
  doc_class: 'decision';
  direction: -1 | 0 | 1;        // cut / hold / raise
  bp: number;                   // size in basis points (0 for a hold)
  size_stated: boolean;         // false → 25bp assumed
  sentence: string | null;      // the decision sentence, if one was found
  base: number;                 // A
  words_score: number;          // W
  words_z: number;
  words_n: number;
}

const FRAC: Record<string, number> = { '1/4': 25, 'one-quarter': 25, 'one quarter': 25, 'quarter': 25, '1/2': 50, 'one-half': 50,
  'half': 50, '3/4': 75, 'three-quarter': 75, 'three-quarters': 75, 'three quarters': 75 };
const D_OBJ = String.raw`(federal funds rate|target range|(?:three |our )?key (?:ecb )?interest rates|ecb interest rates|deposit facility|main refinancing|policy rates?|interest rates? on the (?:main|deposit|marginal))`;
const D_UPV = String.raw`(raise|raising|raised|increase|increasing|increased|lift|hike)`;
const D_DNV = String.raw`(lower|lowering|lowered|reduce|reducing|reduced|cut|cutting|decrease|decreased)`;
const D_HOLD = String.raw`(keep|keeping|maintain|maintaining|leave|leaving|hold|remain)\w*`;
const D_DECIDE = String.raw`(decided|decides|voted|agreed|today|will be (?:raised|lowered|increased|decreased|reduced))`;
const R = (src: string) => U(new RegExp(src));
const RX = {
  decide: R(D_DECIDE), obj: R(D_OBJ),
  notUp: R(String.raw`\b(not|no)\s+(to\s+)?` + D_UPV), notDn: R(String.raw`\b(not|no)\s+(to\s+)?` + D_DNV),
  up: R(D_UPV + String.raw`[^.;]{0,120}?` + D_OBJ), dn: R(D_DNV + String.raw`[^.;]{0,120}?` + D_OBJ),
  pasUp: R(D_OBJ + String.raw`[^.;]{0,80}?will be (raised|increased)`), pasDn: R(D_OBJ + String.raw`[^.;]{0,80}?will be (lowered|reduced|decreased|cut)`),
  hold1: R(D_HOLD + String.raw`[^.;]{0,120}?` + D_OBJ), hold2: R(D_OBJ + String.raw`[^.;]{0,60}?\b(unchanged|remain\w*)`),
  est: R(String.raw`establish(?:ed)? a target range[^.;]{0,60}?0 to 1/4`),
  bp: R(String.raw`(\d+(?:\.\d+)?)\s*basis\s*points?`),
  frac: R(String.raw`(1/4|1/2|3/4|one[- ]quarter|one[- ]half|three[- ]quarters?|half|quarter)\s*(?:of a\s*)?percentage\s*point`),
  pp: R(String.raw`(\d+(?:\.\d+)?)\s*percentage\s*points?`),
};

function bpOf(l: string): number | null {
  let m = l.match(RX.bp); if (m) return parseFloat(m[1]);
  m = l.match(RX.frac); if (m) return FRAC[m[1]] ?? FRAC[m[1].replace(/ /g, '-')] ?? 25;
  m = l.match(RX.pp); if (m) return parseFloat(m[1]) * 100;
  return null;
}

/** Reads the policy decision from the first sentences of a decision document. */
export function readDecision(sentences: string[]): { direction: -1 | 0 | 1; bp: number; sentence: string | null } {
  for (const s of sentences) {
    const l = s.toLowerCase();
    if (l.search(RX.decide) < 0 || l.search(RX.obj) < 0) continue;
    if (l.search(RX.notUp) >= 0 || l.search(RX.notDn) >= 0) continue;
    const up = [l.search(RX.up), l.search(RX.pasUp)].find(i => i >= 0) ?? -1;
    const dn = [l.search(RX.dn), l.search(RX.pasDn)].find(i => i >= 0) ?? -1;
    const ho = [l.search(RX.hold1), l.search(RX.hold2)].find(i => i >= 0) ?? -1;
    const cands: [number, -1 | 0 | 1][] = ([[up, 1], [dn, -1], [ho, 0]] as [number, -1 | 0 | 1][]).filter(([i]) => i >= 0);
    if (l.search(RX.est) >= 0) return { direction: -1, bp: 75, sentence: s };
    if (!cands.length) continue;
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const direction = cands[0][1];
    return { direction, bp: direction ? (bpOf(l) || 25) : 0, sentence: s };
  }
  return { direction: 0, bp: 0, sentence: null };   // no decision sentence: a hold ("will maintain the target range")
}

export function actionBase(direction: number, bp: number): number {
  if (!direction) return 0;
  return direction * (bp <= 25 ? D.action_base.le25 : bp <= 50 ? D.action_base.le50 : D.action_base.gt50);
}

export function scoreText(text: string, neutralBand = 0.1, docClass: DocClass = 'general'): FrozenScore {
  const g = scoreGeneral(text, neutralBand);
  if (docClass !== 'decision') return g;

  const all = splitSentences(text || '');
  const dec = readDecision(all.slice(0, D.decision_window_sentences));
  const words = relevantSentences(all).filter(s => dec.sentence === null || s !== dec.sentence);
  const n = words.length, k = D.shrinkage_k;
  let z = 0;
  if (n) {
    let lex = 0, lin = 0;
    for (const w of words) {
      const lab = lexiconLabel(w); lex += lab === 1 ? 1 : lab === 0 ? -1 : 0;
      const [pd, ph] = linearProba(w); lin += ph - pd;
    }
    const ls = (lex + k * D.lexicon_mean) / (n + k), ns = (lin + k * D.linear_mean) / (n + k);
    z = ((ls - D.lexicon_mean) / D.lexicon_sd + (ns - D.linear_mean) / D.linear_sd) / 2;
  }
  const W = Math.max(-1, Math.min(1, z / D.z_to_net));
  const A = actionBase(dec.direction, dec.bp);
  const net = Math.max(-1, Math.min(1, A + W * (1 - Math.abs(A))));
  const r3 = (x: number) => Math.round(x * 1000) / 1000;

  const dimensions = { ...g.dimensions, policy_stance: r3(Math.max(-1, Math.min(1, A + g.dimensions.policy_stance * (1 - Math.abs(A))))) };
  const dimension_evidence = { ...g.dimension_evidence, ...(A !== 0 && dec.sentence ? { policy_stance: dec.sentence.slice(0, 240) } : {}) };
  const decision: DecisionInfo = {
    doc_class: 'decision', direction: dec.direction, bp: dec.bp,
    size_stated: !!dec.sentence && /basis point|percentage point/i.test(dec.sentence),
    sentence: dec.sentence ? dec.sentence.slice(0, 300) : null,
    base: r3(A), words_score: r3(W), words_z: r3(z), words_n: n,
  };
  return {
    ...g,
    net_score: r3(net), label: net > neutralBand ? 'hawkish' : net < -neutralBand ? 'dovish' : 'neutral',
    z: r3(z), dimensions, dimension_evidence, decision,
    versions: { ...g.versions, decision: D.decision_id, decision_bundle_sha: D.bundle_sha },
    scored: g.scored || dec.direction !== 0,
  };
}
