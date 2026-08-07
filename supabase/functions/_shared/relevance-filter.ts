// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Input ingestion & filtering (noise reduction)
// Routes each raw document through a cheap deterministic relevance classifier
// before it ever reaches the expensive semantic scoring pass. Administrative and
// operational material is tagged, scored 0 and kept for the audit trail, but it
// never consumes an AI call and never moves the aggregate.
// ─────────────────────────────────────────────────────────────────────────────

export interface Classifiable {
  title: string;
  source?: string;
  text?: string;
}

export type RelevanceClass =
  | 'policy'          // monetary policy substance → full NLP pipeline
  | 'macro-adjacent'  // financial stability / research with policy read-through
  | 'operational';    // administrative noise → dropped from scoring

export interface RelevanceVerdict {
  relevance: RelevanceClass;
  score: boolean; // whether to run full sentiment analysis
  reason: string;
}

// Hard operational / administrative markers — never monetary policy signals.
const OPERATIONAL = [
  /digital euro|digital dollar|central bank digital/i,
  /payment(s)? system|target2|t2s|tips|instant payment|sepa|fedwire|fednow|check clearing/i,
  /banknote|coin|counterfeit|currency circulation|cash cycle/i,
  /supervis|ssm |single supervisory|prudential|resolution (board|planning)|stress test methodolog/i,
  /appoint|nominat|resign|retire|obituar|in memoriam|award|prize|honou?r/i,
  /call for papers|conference (announcement|programme)|vacanc|recruitment|internship/i,
  /working paper series|occasional paper|technical note|methodolog(y|ical) (note|change)/i,
  /website|newsletter|podcast episode announcement|social media/i,
  /enforcement action|consent order|civil money penalty|banking application/i,
  /financial literacy|school competition|museum|open day|anniversar/i,
  /statistical (release calendar|revision policy)|data dictionary|reporting requirement/i,
];

// Policy substance markers — these always get the full pipeline.
const POLICY = [
  /monetary policy|policy (stance|decision|statement|rate)|interest rate|rate (cut|hike|path|decision)/i,
  /inflation|disinflation|price stability|hicp|cpi|pce|wage growth/i,
  /fomc|governing council|deposit facility|federal funds|refinancing operation/i,
  /minutes|account of the monetary policy|press conference|projections|forecast/i,
  /forward guidance|restrictive|accommodative|neutral rate|r-?star|data-?dependent/i,
  /labour market|labor market|unemployment|recession|growth outlook|output gap/i,
  /quantitative (easing|tightening)|asset purchase|app |pepp|balance sheet reduction/i,
];

// Between the two: economics-adjacent content that can carry a read-through.
const MACRO_ADJACENT = [
  /financial stability|credit|bank lending|housing market|fiscal|debt|tariff|trade|energy pric/i,
  /productivity|competitiveness|euro area economy|us economy|global outlook|geopolitic/i,
];

export function classifyRelevance(doc: Classifiable): RelevanceVerdict {
  const hay = `${doc.title || ''} ${doc.source || ''}`;
  const body = (doc.text || '').slice(0, 4000);
  const full = `${hay} ${body}`;

  const policyHit = POLICY.find(r => r.test(hay)) || POLICY.find(r => r.test(full));
  const opHit = OPERATIONAL.find(r => r.test(hay));

  // Operational wording in the headline wins unless the body is clearly about policy.
  if (opHit && !POLICY.some(r => r.test(hay))) {
    return { relevance: 'operational', score: false, reason: `layer1:operational (${opHit.source.slice(0, 28)})` };
  }
  if (policyHit) {
    return { relevance: 'policy', score: true, reason: 'layer1:policy' };
  }
  if (MACRO_ADJACENT.some(r => r.test(full))) {
    return { relevance: 'macro-adjacent', score: true, reason: 'layer1:macro-adjacent' };
  }
  // Unclassifiable and no policy vocabulary anywhere → treat as noise.
  return { relevance: 'operational', score: false, reason: 'layer1:no-policy-content' };
}

/** Split a raw batch into the documents worth scoring and the noise to shelve. */
export function partitionForScoring<T extends Classifiable>(docs: T[]): {
  scorable: { doc: T; verdict: RelevanceVerdict }[];
  noise: { doc: T; verdict: RelevanceVerdict }[];
} {
  const scorable: { doc: T; verdict: RelevanceVerdict }[] = [];
  const noise: { doc: T; verdict: RelevanceVerdict }[] = [];
  for (const doc of docs) {
    const verdict = classifyRelevance(doc);
    (verdict.score ? scorable : noise).push({ doc, verdict });
  }
  return { scorable, noise };
}
