import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple OLS regression using normal equations: β = (X'X)^(-1) X'y
function olsRegression(X: number[][], y: number[]): { coefficients: number[]; rSquared: number; residuals: number[] } {
  const n = X.length;
  const k = X[0].length;

  // X'X
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      for (let r = 0; r < n; r++) {
        XtX[i][j] += X[r][i] * X[r][j];
      }
    }
  }

  // X'y
  const Xty: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let r = 0; r < n; r++) {
      Xty[i] += X[r][i] * y[r];
    }
  }

  // Invert XtX (simple Gauss-Jordan for small matrices)
  const aug: number[][] = XtX.map((row, i) => [...row, ...Array(k).fill(0).map((_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < k; col++) {
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error("Singular matrix");
    for (let j = 0; j < 2 * k; j++) aug[col][j] /= pivot;
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * k; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  const inv = aug.map(row => row.slice(k));

  // β = inv * Xty
  const coefficients: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      coefficients[i] += inv[i][j] * Xty[j];
    }
  }

  // Predictions & R²
  const yHat = X.map(row => row.reduce((s, x, j) => s + x * coefficients[j], 0));
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = residuals.reduce((s, v) => s + v ** 2, 0);
  const rSquared = 1 - ssRes / ssTot;

  return { coefficients, rSquared, residuals };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const fredKey = Deno.env.get("FRED_API_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { bank = "FED" } = await req.json().catch(() => ({ bank: "FED" }));

    // Check cache (12h TTL)
    const cacheType = `taylor-rule-${bank}`;
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("*")
      .eq("analysis_type", cacheType)
      .eq("bank", bank)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 12 * 60 * 60 * 1000) {
        return new Response(JSON.stringify(cached.result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Fetch historical macro data from FRED (and Eurostat for ECB unemployment)
    const fredSeries = bank === "FED"
      ? { rate: "FEDFUNDS", inflation: "CPIAUCSL", unemployment: "UNRATE" }
      : { rate: "ECBDFR", inflation: "CP0000EZ19M086NEST", unemployment: null }; // ECB unemployment from Eurostat

    const startDate = "2000-01-01";

    async function fetchFred(seriesId: string): Promise<{ date: string; value: number }[]> {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredKey}&file_type=json&observation_start=${startDate}&frequency=m`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`FRED ${seriesId} failed: ${resp.status}`);
      const data = await resp.json();
      return (data.observations || [])
        .filter((o: any) => o.value !== ".")
        .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }));
    }

    // Fetch Eurozone unemployment from Eurostat (EA20) since FRED series discontinued
    async function fetchEurostatUnemployment(): Promise<{ date: string; value: number }[]> {
      const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EA20&s_adj=SA&sex=T&age=TOTAL&unit=PC_ACT&lastTimePeriod=360`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Eurostat unemployment failed: ${resp.status}`);
      const data = await resp.json();
      const values = data.value || {};
      const times = data.dimension?.time?.category?.index || {};
      const results: { date: string; value: number }[] = [];
      for (const [period, idx] of Object.entries(times)) {
        const val = values[String(idx)];
        if (val != null) {
          // Convert "2024-01" to "2024-01-01"
          results.push({ date: `${period}-01`, value: val as number });
        }
      }
      return results.sort((a, b) => a.date.localeCompare(b.date));
    }

    const [rateData, inflationData, unemploymentData] = await Promise.all([
      fetchFred(fredSeries.rate),
      fetchFred(fredSeries.inflation),
      fredSeries.unemployment ? fetchFred(fredSeries.unemployment) : fetchEurostatUnemployment(),
    ]);

    // Align data by date (month)
    const dateToMonth = (d: string) => d.slice(0, 7);
    const rateMap = new Map(rateData.map(d => [dateToMonth(d.date), d.value]));
    const inflMap = new Map(inflationData.map(d => [dateToMonth(d.date), d.value]));
    const unempMap = new Map(unemploymentData.map(d => [dateToMonth(d.date), d.value]));

    // For inflation, compute YoY change if raw CPI
    const inflMonths = [...inflMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const inflYoY = new Map<string, number>();
    for (let i = 12; i < inflMonths.length; i++) {
      const [month, val] = inflMonths[i];
      const prevVal = inflMonths[i - 12][1];
      if (prevVal > 0) {
        inflYoY.set(month, ((val - prevVal) / prevVal) * 100);
      }
    }

    // Use YoY inflation if it looks like an index, otherwise raw
    const useYoY = inflationData.length > 0 && inflationData[0].value > 50; // CPI index > 50
    const finalInflMap = useYoY ? inflYoY : inflMap;

    // Target values
    const inflTarget = bank === "FED" ? 2.0 : 2.0;
    const unempTarget = bank === "FED" ? 4.4 : 6.1; // NAIRU estimates

    // Build aligned dataset
    const allMonths = [...rateMap.keys()].filter(m => finalInflMap.has(m) && unempMap.has(m)).sort();
    const timeSeries: { date: string; rate: number; inflation: number; unemployment: number; inflationGap: number; outputGap: number }[] = [];

    for (const month of allMonths) {
      const rate = rateMap.get(month)!;
      const infl = finalInflMap.get(month)!;
      const unemp = unempMap.get(month)!;
      timeSeries.push({
        date: month,
        rate,
        inflation: infl,
        unemployment: unemp,
        inflationGap: infl - inflTarget,
        outputGap: -(unemp - unempTarget), // Okun's law proxy
      });
    }

    if (timeSeries.length < 24) {
      throw new Error("Insufficient data for regression");
    }

    // Two-regime Taylor Rule: separate ZLB (rate < 0.5%) from normal periods
    const zlbThreshold = 0.5;
    const normalObs = timeSeries.filter(d => d.rate >= zlbThreshold);
    const zlbObs = timeSeries.filter(d => d.rate < zlbThreshold);

    // Estimate coefficients from normal regime only (avoids ZLB censoring bias)
    const Xnormal = normalObs.map(d => [1, d.inflationGap, d.outputGap]);
    const yNormal = normalObs.map(d => d.rate);

    let normalCoeffs: { coefficients: number[]; rSquared: number };
    let zlbCoeffs: { coefficients: number[]; rSquared: number } | null = null;

    if (normalObs.length < 12) {
      // Fallback: use all data if not enough normal observations
      const Xall = timeSeries.map(d => [1, d.inflationGap, d.outputGap]);
      const yAll = timeSeries.map(d => d.rate);
      normalCoeffs = olsRegression(Xall, yAll);
    } else {
      normalCoeffs = olsRegression(Xnormal, yNormal);
    }

    // Estimate ZLB regime if enough observations
    if (zlbObs.length >= 12) {
      const Xzlb = zlbObs.map(d => [1, d.inflationGap, d.outputGap]);
      const yZlb = zlbObs.map(d => d.rate);
      zlbCoeffs = olsRegression(Xzlb, yZlb);
    }

    // For implied rate: use normal-regime coefficients (uncensored reaction function)
    const nc = normalCoeffs.coefficients;

    const resultTimeSeries = timeSeries.map(d => {
      const isZlb = d.rate < zlbThreshold;
      const implied = nc[0] + nc[1] * d.inflationGap + nc[2] * d.outputGap;
      return {
        date: d.date,
        actual_rate: d.rate,
        implied_rate: Math.round(implied * 1000) / 1000,
        inflation: d.inflation,
        unemployment: d.unemployment,
        regime: isZlb ? "ZLB" : "normal",
      };
    });

    // Display from 2021
    const displaySeries = resultTimeSeries.filter(d => d.date >= "2021-01");

    const latestImplied = displaySeries[displaySeries.length - 1]?.implied_rate ?? 0;
    const latestActual = displaySeries[displaySeries.length - 1]?.actual_rate ?? 0;

    const result = {
      bank,
      regime_model: "two-regime",
      normal_regime: {
        coefficients: {
          intercept: Math.round(nc[0] * 10000) / 10000,
          inflation_gap: Math.round(nc[1] * 10000) / 10000,
          output_gap: Math.round(nc[2] * 10000) / 10000,
        },
        r_squared: Math.round(normalCoeffs.rSquared * 10000) / 10000,
        sample_size: normalObs.length,
      },
      zlb_regime: zlbCoeffs ? {
        coefficients: {
          intercept: Math.round(zlbCoeffs.coefficients[0] * 10000) / 10000,
          inflation_gap: Math.round(zlbCoeffs.coefficients[1] * 10000) / 10000,
          output_gap: Math.round(zlbCoeffs.coefficients[2] * 10000) / 10000,
        },
        r_squared: Math.round(zlbCoeffs.rSquared * 10000) / 10000,
        sample_size: zlbObs.length,
      } : null,
      // Keep legacy fields for backward compatibility
      coefficients: {
        intercept: Math.round(nc[0] * 10000) / 10000,
        inflation_gap: Math.round(nc[1] * 10000) / 10000,
        output_gap: Math.round(nc[2] * 10000) / 10000,
      },
      r_squared: Math.round(normalCoeffs.rSquared * 10000) / 10000,
      sample_size: timeSeries.length,
      sample_start: timeSeries[0].date,
      sample_end: timeSeries[timeSeries.length - 1].date,
      time_series: displaySeries,
      latest_gap: Math.round((latestImplied - latestActual) * 1000) / 1000,
      latest_implied: latestImplied,
      latest_actual: latestActual,
      generated_at: new Date().toISOString(),
    };

    // Cache
    await sb.from("analysis_cache").upsert({
      analysis_type: cacheType,
      bank,
      data_hash: `${bank}-taylor-${timeSeries.length}`,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" }).select();

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("taylor-rule error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
