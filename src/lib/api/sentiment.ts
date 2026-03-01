import { supabase } from '@/integrations/supabase/client';

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
  days: number = 60,
  _fetchText: boolean = false,
): Promise<SentimentResponse> {
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

/**
 * Fetch the latest cached sentiment items from the database.
 */
export async function getCachedSentimentItems(bank?: 'FED' | 'ECB'): Promise<SentimentItem[]> {
  let query = supabase
    .from('sentiment_items')
    .select('*')
    .order('item_date', { ascending: false });

  if (bank) query = query.eq('bank', bank);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as unknown as SentimentItem[];
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
