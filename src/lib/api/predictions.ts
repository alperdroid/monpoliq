import type { PredictionOutput, CurrencyPrediction } from '@/types/central-bank';

export interface TreasuryPrediction {
  instrument: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  yield_bias: 'higher' | 'lower' | 'stable';
  signal_strength: number;
  confidence: number;
}

export interface AIPredictionResponse {
  fed: {
    next_decision: 'hike' | 'hold' | 'cut';
    hike_probability: number;
    hold_probability: number;
    cut_probability: number;
    confidence: number;
    reasoning: string;
  };
  ecb: {
    next_decision: 'hike' | 'hold' | 'cut';
    hike_probability: number;
    hold_probability: number;
    cut_probability: number;
    confidence: number;
    reasoning: string;
  };
  eurusd: {
    direction: 'bullish' | 'bearish' | 'neutral';
    signal_strength: number;
    confidence: number;
    reasoning: string;
  };
  us10y: {
    direction: 'bullish' | 'bearish' | 'neutral';
    yield_bias: 'higher' | 'lower' | 'stable';
    signal_strength: number;
    confidence: number;
    reasoning: string;
  };
  generated_at: string;
  data_summary: {
    fed_comms_count: number;
    ecb_comms_count: number;
    fed_stats_count: number;
    ecb_stats_count: number;
    fed_30d_avg: number | null;
    ecb_30d_avg: number | null;
  };
}

export async function fetchAIPredictions(): Promise<AIPredictionResponse> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/monetary-intelligence`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Prediction failed: ${err}`);
  }

  return resp.json();
}

/** Convert AI response to the existing PredictionOutput type */
export function toPredictionOutput(
  ai: AIPredictionResponse['fed'] | AIPredictionResponse['ecb'],
  bank: 'FED' | 'ECB',
): PredictionOutput {
  return {
    bank,
    next_decision: ai.next_decision,
    hike_probability: ai.hike_probability,
    hold_probability: ai.hold_probability,
    cut_probability: ai.cut_probability,
    confidence: ai.confidence,
    model_label: 'AI Monetary Intelligence',
  };
}

/** Convert AI response to CurrencyPrediction */
export function toCurrencyPrediction(ai: AIPredictionResponse['eurusd']): CurrencyPrediction {
  return {
    pair: 'EUR/USD',
    direction: ai.direction,
    signal_strength: ai.signal_strength,
    confidence: ai.confidence,
  };
}

/** Convert AI response to TreasuryPrediction */
export function toTreasuryPrediction(ai: AIPredictionResponse['us10y']): TreasuryPrediction {
  return {
    instrument: 'US 10Y Treasury',
    direction: ai.direction,
    yield_bias: ai.yield_bias,
    signal_strength: ai.signal_strength,
    confidence: ai.confidence,
  };
}
