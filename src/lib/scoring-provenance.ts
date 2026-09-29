import type { SentimentItem } from '@/lib/api/sentiment';

/** The frozen scorer's own record, written by supabase/functions/_shared/frozen-scoring.ts. */
export interface FrozenAudit {
  net_score?: number;
  z?: number;
  label?: string;
  lexicon_measure?: number;
  linear_soft_measure?: number;
  n_sentences?: number;
  scorer_agreement?: number;
  evidence?: { hawkish?: string[]; dovish?: string[] };
  versions?: { lexicon?: string; linear?: string; bundle_sha?: string; dimensions?: string; decision?: string; decision_bundle_sha?: string };
  decision?: {
    doc_class: 'decision'; direction: -1 | 0 | 1; bp: number; size_stated: boolean;
    sentence: string | null; base: number; words_score: number; words_z: number; words_n: number;
  };
}

export type ScoreKind = 'frozen' | 'sep' | 'legacy';
export type TextKind = 'bis' | 'ai_verified' | 'ai_discovered' | 'primary';

export const FROZEN_MODEL = 'frozen lexicon + linear ensemble (no LLM)';

type AuditRecord = { model?: string; frozen?: FrozenAudit } & Record<string, unknown>;

function auditOf(item: SentimentItem): AuditRecord | null {
  const pd = (item.policy_dimensions || {}) as unknown as Record<string, unknown>;
  return (pd.scoring_audit as AuditRecord | undefined) ?? null;
}

export function isSepItem(item: SentimentItem): boolean {
  return /fomc sep|summary of economic projections/i.test(`${item.source || ''} ${item.title || ''}`);
}

/** How the published score was produced. */
export function scoreKind(item: SentimentItem): ScoreKind {
  if (isSepItem(item)) return 'sep';
  const a = auditOf(item);
  return a?.model === FROZEN_MODEL ? 'frozen' : 'legacy';
}

/** Where the scored text came from. */
export function textKind(item: SentimentItem): TextKind {
  if (item.source === 'Member Speech (BIS)') return 'bis';
  // Verified only when the backend confirmed it against a published article or speech; a URL alone
  // proves nothing (older rows kept URLs the AI search suggested without checking them).
  if (item.source === 'GC Member Remark' || item.source === 'Fed Official Remark') {
    const res = (item.policy_dimensions as unknown as Record<string, { verified?: boolean } | undefined> | undefined)?.source_resolution;
    return res?.verified === true && item.url ? 'ai_verified' : 'ai_discovered';
  }
  return 'primary';
}

export function frozenOf(item: SentimentItem): FrozenAudit | null {
  return auditOf(item)?.frozen ?? null;
}
