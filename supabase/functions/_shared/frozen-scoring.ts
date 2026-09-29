// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 switch: combines the frozen scorer with the existing Gemini scorer.
//
// SCORER_MODE (Supabase secret / env var)
//   ai           today's behaviour: Gemini sets net_score. Frozen not run.
//   shadow       Gemini sets net_score; frozen score is computed and stored in
//                policy_dimensions.scoring_audit.frozen for side-by-side comparison.
//                ← start here for 2-4 weeks, then compare on the methodology page.
//   frozen       frozen scorer sets net_score; Gemini still runs for the three
//                sub-dimensions, the narrative reasoning, and as a third opinion.
//   frozen-only  frozen scorer only; no Gemini call for SCORING. (Gemini may still be used
//                elsewhere for scraping, and SEP projections keep their Gemini path.)
//
// Nothing downstream changes: the result keeps the AIScore shape, so relevance
// filtering (Layer 1) and speaker calibration / tiers / decay / speaker cap /
// policy anchor (Layer 3) apply exactly as before, to every communication.
// ─────────────────────────────────────────────────────────────────────────────
import { scoreText, DIM_VERSION, type DocClass, type FrozenScore } from './frozen-scorer.ts';

export type ScorerMode = 'ai' | 'shadow' | 'frozen' | 'frozen-only';

export function scorerMode(): ScorerMode {
  const m = (globalThis as any).Deno?.env.get('SCORER_MODE') ?? 'shadow';
  return (['ai', 'shadow', 'frozen', 'frozen-only'].includes(m) ? m : 'shadow') as ScorerMode;
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

/**
 * Wraps the existing Gemini scorer. `gemini` is the original scoreWithAI
 * (renamed scoreWithGemini) bound to its arguments.
 */
export async function scoreCombined(
  text: string,
  gemini: () => Promise<ScoreLike>,
  mode: ScorerMode = scorerMode(),
  docClass: DocClass = 'general',
): Promise<ScoreLike> {
  if (mode === 'ai') return gemini();

  const f = scoreText(text, 0.1, docClass);
  if (mode === 'frozen-only') {
    if (!f.scored) return { score: 0, label: 'neutral', reasoning: 'not scored — no policy-relevant sentences', audit: { frozen: frozenAudit(f) } };
    return { score: f.net_score, label: f.label, reasoning: evidenceText(f), dimensions: f.dimensions, audit: uiAudit(f, mode) };
  }

  let ai: ScoreLike;
  try { ai = await gemini(); } catch { ai = { score: 0, label: 'neutral', reasoning: 'ai error' }; }

  const disagree = f.scored && Math.abs(ai.score) > 0.2 && Math.abs(f.net_score) > 0.2 &&
                   Math.sign(ai.score) !== Math.sign(f.net_score);
  const audit = { ...(ai.audit || {}), mode, frozen: frozenAudit(f), ai_score: ai.score, ai_label: ai.label, disagreement: disagree };

  if (mode === 'shadow' || !f.scored) {
    return { ...ai, audit };
  }
  // mode === 'frozen'
  return {
    score: f.net_score,
    label: f.label,
    reasoning: evidenceText(f) + (ai.reasoning ? ` || ai: ${ai.reasoning}` : ''),
    dimensions: ai.dimensions,          // sub-dimensions still come from Gemini
    audit,
  };
}
