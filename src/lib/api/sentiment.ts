import { supabase } from '@/integrations/supabase/client';
import { dynamicHalfLife, itemWeight, type WeightableItem } from '@/lib/scoring-weights';


export interface SentimentItem {
  bank: string;
  source: string;
  item_date: string;
  title: string;
  url: string;
  is_statistical: boolean;
  hawk_pts: number;
  dove_pts: number;
  net_score: number;
  label: string;
  word_count: number;
  reasons: string[];
  stat_metric: string | null;
  stat_value: number | null;
  stat_weight: number;
  topics?: string[];
  policy_dimensions?: Record<string, string | null>;
}

export interface ScoreAggregate {
  avg: number;
  n: number;
  dist: Record<string, number>;
  sentiment: string;
}

export interface BankSentimentResult {
  items: SentimentItem[];
  score_1: ScoreAggregate;
  score_2: ScoreAggregate;
}

export interface SentimentResponse {
  fed?: BankSentimentResult;
  ecb?: BankSentimentResult;
}

export interface CachedSentimentScore {
  id: string;
  bank: string;
  score_1_avg: number;
  score_1_count: number;
  score_1_label: string;
  score_1_dist: Record<string, number>;
  score_2_avg: number;
  score_2_count: number;
  score_2_label: string;
  score_2_dist: Record<string, number>;
  fetched_at: string;
}

/**
 * Trigger a fresh sentiment analysis run via the edge function.
 * This fetches live data from FRED, ECB RSS, Fed RSS, Eurostat.
 */
export async function runSentimentAnalysis(
  bank: 'FED' | 'ECB' | 'both' = 'both',
  days: number = 365,
  _fetchText: boolean = false,
): Promise<SentimentResponse> {
  // Scraping + scoring both banks in one call exceeds the function's CPU budget
  // (WORKER_RESOURCE_LIMIT). Run one bank per call so each stays within limits.
  if (bank === 'both') {
    const out: SentimentResponse = {};
    const errors: string[] = [];
    for (const b of ['FED', 'ECB'] as const) {
      try {
        const r = await runSentimentAnalysis(b, days);
        if (r.fed) out.fed = r.fed;
        if (r.ecb) out.ecb = r.ecb;
      } catch (e) {
        errors.push(`${b}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length === 2) throw new Error(`Analysis failed — ${errors.join(' | ')}`);
    return out;
  }

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/sentiment-analysis`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bank, days }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Analysis failed: ${err}`);
  }
  return resp.json();
}

/** Pages load this much history; the full archive (back to 2015) is read only for the index history export. */
export const RECENT_HISTORY_DAYS = 730;

/** First date (YYYY-MM-DD) of the history the pages load. */
export function recentHistoryStart(now = new Date()): string {
  return new Date(now.getTime() - RECENT_HISTORY_DAYS * 86400000).toISOString().split('T')[0];
}

/** Every row of a query, newest first: PostgREST caps a response at 1000 rows. */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/**
 * Fetch the cached sentiment items from the database: the last RECENT_HISTORY_DAYS by default
 * (statistical backfill included), or everything with `sinceDays = null`.
 */
export async function getCachedSentimentItems(bank?: 'FED' | 'ECB', sinceDays: number | null = RECENT_HISTORY_DAYS): Promise<SentimentItem[]> {
  const since = sinceDays === null ? null : new Date(Date.now() - sinceDays * 86400000).toISOString().split('T')[0];
  return allPages<SentimentItem>((from, to) => {
    let query = supabase
      .from('sentiment_items')
      .select('*')
      .order('item_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
    if (bank) query = query.eq('bank', bank);
    if (since) query = query.gte('item_date', since);
    return query;
  });
}

/** Columns the monthly index needs (scoring-weights WeightableItem), for every scored item back to 2015. */
export type IndexHistoryItem = Pick<SentimentItem, 'bank' | 'source' | 'title' | 'item_date' | 'net_score' | 'is_statistical' | 'label' | 'stat_weight'>;

export async function getIndexHistoryItems(): Promise<IndexHistoryItem[]> {
  return allPages<IndexHistoryItem>((from, to) => supabase
    .from('sentiment_items')
    .select('bank,source,title,item_date,net_score,is_statistical,label,stat_weight')
    .neq('net_score', 0)
    .order('item_date', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));
}


/**
 * Fetch the latest cached dual scores from the database.
 */
export async function getCachedSentimentScores(): Promise<CachedSentimentScore[]> {
  const { data, error } = await supabase
    .from('sentiment_scores')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(2);

  if (error) throw new Error(error.message);
  return (data || []) as unknown as CachedSentimentScore[];
}

/**
 * Fetch only statistical items (FRED data, Eurostat, minutes).
 */
export async function getStatisticalItems(bank?: 'FED' | 'ECB'): Promise<SentimentItem[]> {
  let query = supabase
    .from('sentiment_items')
    .select('*')
    .eq('is_statistical', true)
    .order('item_date', { ascending: false });

  if (bank) query = query.eq('bank', bank);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as unknown as SentimentItem[];
}

/**
 * Fetch only communication items (speeches, press releases, blog).
 */
export async function getCommunicationItems(bank?: 'FED' | 'ECB'): Promise<SentimentItem[]> {
  let query = supabase
    .from('sentiment_items')
    .select('*')
    .eq('is_statistical', false)
    .order('item_date', { ascending: false });

  if (bank) query = query.eq('bank', bank);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as unknown as SentimentItem[];
}

// ─────────────────────────────────────────────────────────────
// Weighted aggregation (Layer 3 normalization):
//   dynamic time-decay half-life × contextual document tier ×
//   statistical reliability weight
// Mirrors the edge-function aggregation so UI values match the
// stored scores. See src/lib/scoring-weights.ts.
// ─────────────────────────────────────────────────────────────
export function weightedAvgScore(
  items: SentimentItem[],
  opts: { halfLifeDays?: number; now?: Date; bank?: string } = {},
): { avg: number; n: number; halfLifeDays: number } | null {
  const now = opts.now ?? new Date();
  const bank = opts.bank ?? items[0]?.bank ?? 'FED';
  const halfLife = opts.halfLifeDays ?? dynamicHalfLife(bank, now);
  const scored = items.filter(i => Math.abs(i.net_score) > 0.001);
  if (!scored.length) return null;
  let num = 0, den = 0;
  for (const it of scored) {
    const w = itemWeight(it as unknown as WeightableItem, halfLife, now);
    num += it.net_score * w;
    den += w;
  }
  if (den === 0) return null;
  return { avg: Math.round((num / den) * 1000) / 1000, n: scored.length, halfLifeDays: halfLife };
}

