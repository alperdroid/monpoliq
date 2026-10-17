// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: every communication is scored by the frozen scorer, and only by it.
//
// The frozen scorer (frozen-scorer.ts + its bundles) is deterministic: the same
// text always gets the same score. No LLM sets, adjusts or blends a score. The
// SCORER_MODE secret (ai | shadow | frozen | frozen-only) is retired: whatever it
// says, scoring runs as 'frozen-only'.
//
// Nothing downstream changes: the result keeps the AIScore shape, so relevance
// filtering (Layer 1) and speaker calibration / tiers / decay / speaker cap /
// policy anchor (Layer 3) apply exactly as before, to every communication.
// ─────────────────────────────────────────────────────────────────────────────
import { scoreText, DIM_VERSION, type DocClass, type FrozenScore } from './frozen-scorer.ts';

export type ScorerMode = 'frozen-only';

/** Always 'frozen-only'. The SCORER_MODE secret no longer switches scoring to Gemini. */
export function scorerMode(): ScorerMode {
  return 'frozen-only';
}

/** Minimal shape shared with sentiment-analysis/index.ts AIScore. */
export interface ScoreLike {
  score: number;
  label: string;
  reasoning: string;
  dimensions?: Record<string, number>;
  audit?: Record<string, unknown>;
}

function frozenAudit(f: FrozenScore) {
  return {
    net_score: f.net_score, z: f.z, label: f.label,
    lexicon_measure: f.lexicon_measure, linear_soft_measure: f.linear_soft_measure,
    n_sentences: f.n_sentences, scorer_agreement: f.scorer_agreement,
    evidence: f.evidence, dimensions: f.dimensions, dimension_n: f.dimension_n,
    ...(f.decision ? { decision: f.decision } : {}),
    versions: { ...f.versions, dimensions: DIM_VERSION },
  };
}

/** Audit block in the shape the Evidence Ledger / Scoring Methodology UI already reads. */
function uiAudit(f: FrozenScore, mode: ScorerMode) {
  const w = { inflation_persistence: 0.45, policy_stance: 0.40, growth_labor_drag: 0.15 };
  const composite = Math.round((f.dimensions.inflation_persistence * w.inflation_persistence +
    f.dimensions.policy_stance * w.policy_stance + f.dimensions.growth_labor_drag * w.growth_labor_drag) * 1000) / 1000;
  return {
    model: 'frozen lexicon + linear ensemble (no LLM)',
    prompt_version: `${f.versions.linear} | ${f.versions.lexicon} | ${DIM_VERSION} | bundle ${f.versions.bundle_sha}`
      + (f.versions.decision ? ` | ${f.versions.decision} ${f.versions.decision_bundle_sha}` : ''),
    temperature: 0,
    dimension_composite: composite,
    published: f.net_score,
    evidence: f.dimension_evidence,
    mode,
    frozen: frozenAudit(f),
  };
}

function evidenceText(f: FrozenScore): string {
  const h = f.evidence.hawkish[0], d = f.evidence.dovish[0];
  const parts: string[] = [];
  if (f.decision) {
    const dc = f.decision;
    const act = dc.direction > 0 ? `raise ${dc.bp}bp` : dc.direction < 0 ? `cut ${dc.bp}bp` : 'hold';
    parts.push(`decision: ${act}${dc.direction && !dc.size_stated ? ' (size not stated, 25bp assumed)' : ''} → base ${dc.base}; words ${dc.words_score} over ${dc.words_n} sentences`);
  } else {
    parts.push(`frozen z=${f.z} over ${f.n_sentences} policy sentences`);
  }
  if (h) parts.push(`most hawkish: "${h.slice(0, 180)}"`);
  if (d) parts.push(`most dovish: "${d.slice(0, 180)}"`);
  return parts.join(' | ');
}

/** Scores a document with the frozen scorer. A document with no policy sentences stays unscored (0). */
export function scoreCombined(text: string, docClass: DocClass = 'general'): ScoreLike {
  const mode = scorerMode();
  const f = scoreText(text, 0.1, docClass);
  if (!f.scored) return { score: 0, label: 'neutral', reasoning: 'not scored — no policy-relevant sentences', audit: { frozen: frozenAudit(f) } };
  return { score: f.net_score, label: f.label, reasoning: evidenceText(f), dimensions: f.dimensions, audit: uiAudit(f, mode) };
}
