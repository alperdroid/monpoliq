export interface OOSMetrics {
  rmse: number;
  r2_vs_naive: number;
  r2_level: number;
  n_oos: number;
}

export interface RegimeProbs {
  restrictive: number;
  zlb: number;
  gfc: number;
  pandemic: number;
  expansionary: number;
  env_bias: number;
}

export interface PolicyReactionResult {
  bank: string;
  actual_rate: number;
  implied_rate: number;
  gap: number;
  r2_insample: number;
  oos_metrics: OOSMetrics;
  model_name: string;
  n_features: number;
  feature_names: string[];
  regime: string;
  stress_score: number;
  regime_probabilities: RegimeProbs | null;
  variables: Record<string, number | null>;
  coefficients: Record<string, number>;
  contributions: Record<string, number>;
  sample_start: string;
  sample_end: string;
  sample_size: number;
}

export interface PolicyReactionResponse {
  fed: PolicyReactionResult;
  ecb: PolicyReactionResult;
  generated_at: string;
}

export async function fetchPolicyReaction(): Promise<PolicyReactionResponse> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `https://${projectId}.supabase.co/functions/v1/policy-reaction`;

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
    throw new Error(`Policy reaction fetch failed: ${err}`);
  }

  return resp.json();
}
