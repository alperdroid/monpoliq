export interface PolicyReactionResult {
  bank: string;
  actual_rate: number;
  implied_rate_macro: number;
  implied_rate_combined: number;
  gap_macro: number;
  gap_combined: number;
  r2_macro: number;
  r2_combined: number;
  sample_start: string;
  sample_end: string;
  sample_size: number;
  latest_month: string;
  variables: {
    inflation_gap: number | null;
    unemployment_gap: number | null;
    y2y: number | null;
    slope: number | null;
    oil_log_change: number | null;
    credit_spread: number | null;
    vix: number | null;
    fci: number | null;
  };
  macro_coefficients: Record<string, number>;
  regime: string;
  stress_score: number;
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
