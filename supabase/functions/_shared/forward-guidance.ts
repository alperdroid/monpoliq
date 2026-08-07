// ── Forward-guidance detector ───────────────────────────────────────────────
// A directional policy stance may only be published when the text contains
// EXPLICIT forward-looking policy language. Announcing an unchanged rate,
// describing the current level, or reviewing past decisions is a continuation,
// not guidance, and stays clamped by the hold guard.
//
// A sentence counts as forward guidance when it combines
//   (a) a policy object   — rates, target range, policy, purchases, stance …
//   (b) a future marker   — will / expect / anticipate / at coming meetings …
// or it matches one of the canonical guidance formulas (e.g. "higher for
// longer", "for an extended period", "sufficiently restrictive").
// Backward-looking sentences ("we decided today", "since our last meeting")
// are rejected even when they contain both.

export type GuidanceDirection = 'hawkish' | 'dovish' | 'ambiguous';

export interface GuidanceCue {
  phrase: string;
  direction: GuidanceDirection;
  sentence: string;
}

export interface GuidanceResult {
  found: boolean;
  direction: GuidanceDirection;
  /** 0 = none, 0.5 = conditional/hedged, 1 = unconditional commitment. */
  strength: number;
  cues: GuidanceCue[];
}

const POLICY_OBJECT =
  /\b(rates?|target range|federal funds|policy rate|monetary policy|policy stance|deposit facility|accommodation|tightening|easing|restriction|restrictive|asset purchases|balance sheet|reinvest\w*)\b/i;

const FUTURE_MARKER =
  /\b(will|won'?t|shall|would|going to|expect\w*|anticipat\w*|intend\w*|project\w*|foresee|likely|prepared to|stand ready|ready to|remain\w*|continue\w*|keep\w*|maintain until|until|coming (?:meetings?|months?|quarters?)|next (?:meeting|move|steps?)|ahead|going forward|in the (?:near|medium) term|over the (?:coming|next)|further|additional|no (?:rush|hurry))\b/i;

const BACKWARD_ONLY =
  /\b(today (?:we|the committee|our committee)|decided today|at (?:today'?s|this) meeting we|since (?:our|the) last meeting|in the inter-?meeting period|last month|previously (?:decided|voted)|in (?:january|february|march|april|may|june|july|august|september|october|november|december) we)\b/i;

/** Canonical guidance formulas that qualify on their own. */
const FORMULAS: Array<[RegExp, GuidanceDirection]> = [
  [/\bhigher for longer\b/i, 'hawkish'],
  [/\bfor (?:an )?extended period\b/i, 'hawkish'],
  [/\bfor some time\b/i, 'hawkish'],
  [/\bsufficiently restrictive\b/i, 'hawkish'],
  [/\bkeep(?:ing)? (?:rates|policy)[^.]{0,40}restrictive\b/i, 'hawkish'],
  [/\bmore work to do\b/i, 'hawkish'],
  [/\bfurther (?:policy )?(?:tightening|firming|hikes?|increases?)\b/i, 'hawkish'],
  [/\bnot (?:close to|near) (?:cutting|easing|rate cuts)\b/i, 'hawkish'],
  [/\bno (?:rush|hurry) to (?:cut|ease|lower)\b/i, 'hawkish'],
  [/\bnot yet (?:done|finished)\b/i, 'hawkish'],
  [/\broom to (?:raise|hike|tighten)\b/i, 'hawkish'],
  [/\bwill (?:need to|have to) (?:raise|hike|tighten|go higher)\b/i, 'hawkish'],
  [/\b(?:further|additional) (?:easing|cuts?|reductions?)\b/i, 'dovish'],
  [/\broom to (?:cut|ease|lower)\b/i, 'dovish'],
  [/\bprepared to (?:cut|ease|lower|act)\b/i, 'dovish'],
  [/\bwill (?:need to|have to) (?:cut|ease|lower)\b/i, 'dovish'],
  [/\beasing cycle\b/i, 'dovish'],
  [/\bpolicy (?:is|becoming) (?:less|no longer) restrictive\b/i, 'dovish'],
  [/\bcloser to (?:neutral|the neutral rate)\b/i, 'dovish'],
  [/\bnot (?:close to|near) (?:raising|hiking|tightening)\b/i, 'dovish'],
  [/\bpause before (?:raising|hiking|tightening)\b/i, 'dovish'],
];

const HAWK_CUE =
  /\b(rais\w+|hike\w*|increase\w*|tighten\w*|firm\w*|higher|restrictive|above (?:neutral|target)|persistent inflation|guard against|vigilant)\b/i;
const DOVE_CUE =
  /\b(cut\w*|lower\w*|reduc\w*|ease\w*|easing|accommodat\w*|loosen\w*|support (?:growth|demand|the economy)|downside risks?|patient)\b/i;

const CONDITIONAL = /\b(if|should|were|depend\w*|data-?dependent|meeting by meeting|conditional|absent|provided that|as long as)\b/i;

function splitSentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15);
}

function directionOf(sentence: string): GuidanceDirection {
  const h = HAWK_CUE.test(sentence);
  const d = DOVE_CUE.test(sentence);
  if (h && !d) return 'hawkish';
  if (d && !h) return 'dovish';
  return 'ambiguous';
}

/**
 * Detect explicit forward-policy guidance in a passage.
 * `text` should be the quote plus, ideally, its surrounding context.
 */
export function detectForwardGuidance(text: string): GuidanceResult {
  const cues: GuidanceCue[] = [];
  let strength = 0;

  for (const sentence of splitSentences(text)) {
    if (BACKWARD_ONLY.test(sentence) && !FORMULAS.some(([re]) => re.test(sentence))) continue;

    let matched: { phrase: string; direction: GuidanceDirection } | null = null;

    for (const [re, dir] of FORMULAS) {
      const m = re.exec(sentence);
      if (m) { matched = { phrase: m[0], direction: dir }; break; }
    }

    if (!matched && POLICY_OBJECT.test(sentence) && FUTURE_MARKER.test(sentence)) {
      const dir = directionOf(sentence);
      if (dir !== 'ambiguous') {
        const m = FUTURE_MARKER.exec(sentence);
        matched = { phrase: m ? m[0] : 'forward-looking policy language', direction: dir };
      }
    }

    if (matched) {
      cues.push({ ...matched, sentence: sentence.slice(0, 220) });
      strength = Math.max(strength, CONDITIONAL.test(sentence) ? 0.5 : 1);
    }
  }

  if (!cues.length) return { found: false, direction: 'ambiguous', strength: 0, cues: [] };

  const hawk = cues.filter(c => c.direction === 'hawkish').length;
  const dove = cues.filter(c => c.direction === 'dovish').length;
  const direction: GuidanceDirection = hawk > dove ? 'hawkish' : dove > hawk ? 'dovish' : 'ambiguous';
  return { found: true, direction, strength, cues: cues.slice(0, 4) };
}
