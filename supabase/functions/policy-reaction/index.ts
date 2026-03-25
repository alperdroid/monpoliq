// Policy Reaction Function — Regime-Aware Econometric Policy Rate Models
// Uses pre-estimated coefficients from notebook; fetches latest macro data to compute implied rates.
// Fed: 18-feature AutoRegime ElasticNet-Ridge
// ECB: 14-feature p-value pruned structural break OLS

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Pre-estimated Coefficients ────────────────────────────────────────────────

const FED_COEFFICIENTS: Record<string, number> = {
  const: -0.265457,
  policy_rate_lag: 0.854363,
  inflation_gap: -0.003450,
  unemployment_gap: 0.056217,
  slope: -0.033699,
  r_neg_equity: 0.384390,
  vix: 0.017163,
  unemployment_gap_l1: -0.044029,
  vix_sq: -0.000455,
  unemployment_gap_l6: -0.013982,
  y2y_l1: 0.150443,
  credit_spread_l1: 0.064071,
  slope_l6: 0.012575,
  y2y_x_d_hy_q75: -0.068016,
  p_next_restrictive: -0.053076,
  p_next_expansionary: -0.089751,
  env_bias: 0.036675,
  infl_x_p_restrictive: 0.066622,
  unemp_x_p_expansionary: -0.015312,
};

const FED_R2 = 0.998174;
const FED_OOS = { rmse: 0.1055, r2_vs_naive: 0.6312, r2_level: 0.9971, n_oos: 234 };

const ECB_COEFFICIENTS: Record<string, number> = {
  const: 0,
  y2y: 0.474432,
  policy_rate_lag: 0.571832,
  inflation_gap_l1: 0.010221,
  fci_l1: -0.239780,
  slope_x_d_gfc: 0.111782,
  slope: -0.141431,
  y2y_l3: -0.169863,
  infl_gap_x_neg_rate: -0.001809,
  rate_change_l1: -0.214750,
  y2y_x_d_sov_crisis: -0.101180,
  hy_spread: 0.025882,
  slope_x_d_neg_rate: 0.104035,
  vix: -0.003046,
  slope_x_d_pre_gfc: 0.150675,
  fci_l3: 0.064801,
};

const ECB_R2 = 0.997112;
const ECB_OOS = { rmse: 0.0858, r2_vs_naive: 0.6016, r2_level: 0.9966, n_oos: 162 };

// ─── FRED Data Fetching ────────────────────────────────────────────────────────

async function fetchFredCSV(seriesId: string): Promise<Map<string, number>> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FRED ${seriesId}: ${resp.status}`);
  const text = await resp.text();
  const data = new Map<string, number>();
  for (const line of text.trim().split('\n').slice(1)) {
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const val = parseFloat(parts[1].trim());
    if (!isNaN(val) && parts[0].trim().length >= 7) data.set(parts[0].trim(), val);
  }
  return data;
}

function toMonthlyLast(data: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [date, val] of data) m.set(date.substring(0, 7), val);
  return m;
}

function toMonthlyMean(data: Map<string, number>): Map<string, number> {
  const b = new Map<string, { sum: number; count: number }>();
  for (const [date, val] of data) {
    const k = date.substring(0, 7);
    const e = b.get(k) || { sum: 0, count: 0 };
    e.sum += val; e.count++;
    b.set(k, e);
  }
  const m = new Map<string, number>();
  for (const [k, v] of b) m.set(k, v.sum / v.count);
  return m;
}

function genMonths(sy: number, sm: number, ey: number, em: number): string[] {
  const months: string[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

function ffill(data: Map<string, number>, months: string[]): Map<string, number> {
  const filled = new Map<string, number>();
  let last: number | null = null;
  for (const m of months) {
    if (data.has(m)) last = data.get(m)!;
    if (last !== null) filled.set(m, last);
  }
  return filled;
}

function gv(data: Map<string, number>, month: string): number | null {
  return data.has(month) ? data.get(month)! : null;
}

async function fetchYahooMonthly(symbol: string): Promise<Map<string, number>> {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(new Date('2000-01-01').getTime() / 1000);
  const resp = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${now}&interval=1mo`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!resp.ok) return new Map();
  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) return new Map();
  const ts: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
  const monthly = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(ts[i] * 1000);
    monthly.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, closes[i]!);
  }
  return monthly;
}

function quantile(arr: number[], q: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function rollingMean(data: Map<string, number>, months: string[], idx: number, window: number): number | null {
  let sum = 0, cnt = 0;
  for (let j = Math.max(0, idx - window); j <= idx; j++) {
    const v = gv(data, months[j]);
    if (v != null) { sum += v; cnt++; }
  }
  return cnt > 0 ? sum / cnt : null;
}

// ─── Logistic Regression (lightweight, single-pass for regime probs) ──────────

// Pre-computed regime probabilities from notebook (update periodically offline)
const FED_REGIME_PROBS: RegimeProbs = {
  restrictive: 0.1345, zlb: 0, gfc: 0.0014, pandemic: 0.011,
  expansionary: 0.011, env_bias: 0.1236,
};

const ECB_REGIME_PROBS: RegimeProbs = {
  restrictive: 0.0767, zlb: 0.0104, gfc: 0.0041, pandemic: 0.1223,
  expansionary: 0.1223, env_bias: -0.0456,
};

// ─── Data Row ──────────────────────────────────────────────────────────────────

interface DataRow {
  month: string;
  policy_rate: number;
  policy_rate_lag: number;
  inflation_gap: number;
  unemployment_gap: number;
  y2y: number;
  slope: number;
  oil_log_change: number;
  r_neg_equity: number;
  credit_spread: number;
  hy_spread: number;
  vix: number;
  fci: number;
  unemployment_gap_l1: number;
  unemployment_gap_l6: number;
  y2y_l1: number;
  y2y_l3: number;
  slope_l6: number;
  credit_spread_l1: number;
  fci_l1: number;
  fci_l3: number;
  vix_sq: number;
  rate_change_l1: number;
  inflation_gap_l1: number;
  stress_score: number;
}

function buildRows(
  months: string[],
  policyRate: Map<string, number>,
  inflationSeries: Map<string, number>,
  inflationIsYoY: boolean,
  unemployment: Map<string, number>,
  nrou: Map<string, number>,
  shortRate: Map<string, number>,
  longRate: Map<string, number>,
  oil: Map<string, number>,
  equity: Map<string, number>,
  creditSpread: Map<string, number>,
  hySpread: Map<string, number>,
  vix: Map<string, number>,
  fci: Map<string, number>,
): DataRow[] {
  interface Base {
    month: string; policy_rate: number; policy_rate_lag: number;
    inflation_gap: number; unemployment_gap: number; y2y: number;
    slope: number; oil_log_change: number; r_neg_equity: number;
    credit_spread: number; hy_spread: number; vix: number; fci: number;
  }

  const bases: (Base | null)[] = [];
  for (let i = 0; i < months.length; i++) {
    const m = months[i], mPrev = i > 0 ? months[i - 1] : null;
    const pr = gv(policyRate, m), prLag = mPrev ? gv(policyRate, mPrev) : null;
    const ur = gv(unemployment, m), y2 = gv(shortRate, m), y10 = gv(longRate, m);
    const oilCur = gv(oil, m), oilPrev = mPrev ? gv(oil, mPrev) : null;
    if (pr == null || prLag == null || ur == null || y2 == null || y10 == null || oilCur == null || oilPrev == null || oilPrev === 0) {
      bases.push(null); continue;
    }

    let inflGap: number;
    if (inflationIsYoY) {
      const v = gv(inflationSeries, m);
      if (v == null) { bases.push(null); continue; }
      inflGap = v - 2.0;
    } else {
      const m12 = i >= 12 ? months[i - 12] : null;
      if (!m12) { bases.push(null); continue; }
      const cur = gv(inflationSeries, m), prev12 = gv(inflationSeries, m12);
      if (cur == null || prev12 == null || prev12 === 0) { bases.push(null); continue; }
      inflGap = ((cur / prev12) - 1) * 100 - 2.0;
    }

    const nrouVal = gv(nrou, m);
    const nairu = nrouVal ?? rollingMean(unemployment, months, i, 120) ?? ur;
    const uGap = nairu - ur;
    let rNegEq = 0;
    const eqCur = equity.get(m), eqPrev = mPrev ? equity.get(mPrev) : undefined;
    if (eqCur != null && eqPrev != null && eqPrev > 0) rNegEq = Math.max(-(Math.log(eqCur) - Math.log(eqPrev)), 0);

    bases.push({
      month: m, policy_rate: pr, policy_rate_lag: prLag,
      inflation_gap: inflGap, unemployment_gap: uGap,
      y2y: y2, slope: y10 - y2, oil_log_change: Math.log(oilCur) - Math.log(oilPrev),
      r_neg_equity: rNegEq, credit_spread: gv(creditSpread, m) ?? 0,
      hy_spread: gv(hySpread, m) ?? 0, vix: gv(vix, m) ?? 20, fci: gv(fci, m) ?? 0,
    });
  }

  const rows: DataRow[] = [];
  for (let i = 0; i < months.length; i++) {
    const cur = bases[i];
    if (!cur) continue;
    const p1 = i >= 1 ? bases[i - 1] : null;
    const p2 = i >= 2 ? bases[i - 2] : null;
    const p3 = i >= 3 ? bases[i - 3] : null;
    const p6 = i >= 6 ? bases[i - 6] : null;
    if (!p1 || !p3 || !p6) continue;

    const stressComps = [cur.credit_spread, cur.hy_spread / 5, cur.vix / 20, cur.fci];
    rows.push({
      ...cur,
      unemployment_gap_l1: p1.unemployment_gap,
      unemployment_gap_l6: p6.unemployment_gap,
      y2y_l1: p1.y2y, y2y_l3: p3.y2y,
      slope_l6: p6.slope, credit_spread_l1: p1.credit_spread,
      fci_l1: p1.fci, fci_l3: p3.fci,
      vix_sq: cur.vix * cur.vix,
      rate_change_l1: p1.policy_rate - (p2 ? p2.policy_rate : p1.policy_rate),
      inflation_gap_l1: p1.inflation_gap,
      stress_score: stressComps.reduce((s, v) => s + v, 0) / stressComps.length,
    });
  }
  return rows;
}

// ─── Regime Classifier (single-pass, predict only last row) ───────────────────

interface RegimeProbs {
  restrictive: number; zlb: number; gfc: number; pandemic: number;
  expansionary: number; env_bias: number;
}


// ─── Compute Implied Rate ──────────────────────────────────────────────────────

function round2(v: number | null): number | null { return v != null ? Math.round(v * 100) / 100 : null; }
function round3(v: number | null): number | null { return v != null ? Math.round(v * 1000) / 1000 : null; }

interface ModelResult {
  bank: string;
  actual_rate: number;
  implied_rate: number;
  gap: number;
  r2_insample: number;
  oos_metrics: { rmse: number; r2_vs_naive: number; r2_level: number; n_oos: number };
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

function computeFedImplied(row: DataRow, hyQ75: number, rp: RegimeProbs): number {
  const dHy = row.hy_spread >= hyQ75 ? 1 : 0;
  const terms: [string, number][] = [
    ['const', 1],
    ['policy_rate_lag', row.policy_rate_lag],
    ['inflation_gap', row.inflation_gap],
    ['unemployment_gap', row.unemployment_gap],
    ['slope', row.slope],
    ['r_neg_equity', row.r_neg_equity],
    ['vix', row.vix],
    ['unemployment_gap_l1', row.unemployment_gap_l1],
    ['vix_sq', row.vix_sq],
    ['unemployment_gap_l6', row.unemployment_gap_l6],
    ['y2y_l1', row.y2y_l1],
    ['credit_spread_l1', row.credit_spread_l1],
    ['slope_l6', row.slope_l6],
    ['y2y_x_d_hy_q75', row.y2y * dHy],
    ['p_next_restrictive', rp.restrictive],
    ['p_next_expansionary', rp.expansionary],
    ['env_bias', rp.env_bias],
    ['infl_x_p_restrictive', row.inflation_gap * rp.restrictive],
    ['unemp_x_p_expansionary', row.unemployment_gap * rp.expansionary],
  ];
  return terms.reduce((sum, [name, x]) => sum + (FED_COEFFICIENTS[name] ?? 0) * x, 0);
}

function computeECBImplied(row: DataRow): number {
  const dNeg = row.policy_rate_lag <= 0 ? 1 : 0;
  const dGFC = (row.month >= '2008-09' && row.month <= '2010-06') ? 1 : 0;
  const dSov = (row.month >= '2010-04' && row.month <= '2012-09') ? 1 : 0;
  const dPreGFC = row.month < '2008-09' ? 1 : 0;

  const terms: [string, number][] = [
    ['const', 1],
    ['y2y', row.y2y],
    ['policy_rate_lag', row.policy_rate_lag],
    ['inflation_gap_l1', row.inflation_gap_l1],
    ['fci_l1', row.fci_l1],
    ['slope_x_d_gfc', row.slope * dGFC],
    ['slope', row.slope],
    ['y2y_l3', row.y2y_l3],
    ['infl_gap_x_neg_rate', row.inflation_gap * dNeg],
    ['rate_change_l1', row.rate_change_l1],
    ['y2y_x_d_sov_crisis', row.y2y * dSov],
    ['hy_spread', row.hy_spread],
    ['slope_x_d_neg_rate', row.slope * dNeg],
    ['vix', row.vix],
    ['slope_x_d_pre_gfc', row.slope * dPreGFC],
    ['fci_l3', row.fci_l3],
  ];
  return terms.reduce((sum, [name, x]) => sum + (ECB_COEFFICIENTS[name] ?? 0) * x, 0);
}

// ─── Run Fed Model ─────────────────────────────────────────────────────────────

async function runFedModel(months: string[]): Promise<ModelResult> {
  console.log('Fetching Fed data...');
  const [fedfunds, pcepilfe, unrate, nrou, dgs2, dgs10, oil, baa10y, hy, vixcls, nfci] = await Promise.all([
    fetchFredCSV('FEDFUNDS').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('PCEPILFE').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('UNRATE').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('NROU').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('DGS2').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('DGS10').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('DCOILBRENTEU').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('BAA10Y').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('BAMLH0A0HYM2').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('VIXCLS').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('NFCI').then(d => toMonthlyMean(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
  ]);

  let equity: Map<string, number>;
  try { equity = await fetchYahooMonthly('^GSPC'); } catch { equity = new Map(); }

  const rows = buildRows(months, fedfunds, pcepilfe, false, unrate, nrou, dgs2, dgs10, oil, equity, baa10y, hy, vixcls, nfci);
  console.log(`Fed: ${rows.length} rows`);
  if (rows.length < 50) throw new Error('Insufficient Fed data');

  const hyVals = rows.map(r => r.hy_spread).filter(v => v > 0);
  const hyQ75 = hyVals.length > 0 ? quantile(hyVals, 0.75) : 6;

  const regimeProbs = FED_REGIME_PROBS;
  const lastRow = rows[rows.length - 1];
  console.log('Fed regime probs (hardcoded):', regimeProbs);
  const implied = computeFedImplied(lastRow, hyQ75, regimeProbs);

  const allStress = rows.map(r => r.stress_score).sort((a, b) => a - b);
  const q20 = allStress[Math.floor(allStress.length * 0.2)];
  const q80 = allStress[Math.floor(allStress.length * 0.8)];
  const regime = lastRow.stress_score <= q20 ? 'Benign' : lastRow.stress_score >= q80 ? 'Stress' : 'Neutral';

  const featureNames = Object.keys(FED_COEFFICIENTS).filter(k => k !== 'const');

  // Compute contributions (coeff * x) for each term
  const dHyContrib = lastRow.hy_spread >= hyQ75 ? 1 : 0;
  const fedTerms: [string, number][] = [
    ['policy_rate_lag', lastRow.policy_rate_lag],
    ['inflation_gap', lastRow.inflation_gap],
    ['unemployment_gap', lastRow.unemployment_gap],
    ['slope', lastRow.slope],
    ['r_neg_equity', lastRow.r_neg_equity],
    ['vix', lastRow.vix],
    ['unemployment_gap_l1', lastRow.unemployment_gap_l1],
    ['vix_sq', lastRow.vix_sq],
    ['unemployment_gap_l6', lastRow.unemployment_gap_l6],
    ['y2y_l1', lastRow.y2y_l1],
    ['credit_spread_l1', lastRow.credit_spread_l1],
    ['slope_l6', lastRow.slope_l6],
    ['y2y_x_d_hy_q75', lastRow.y2y * dHyContrib],
    ['p_next_restrictive', regimeProbs.restrictive],
    ['p_next_expansionary', regimeProbs.expansionary],
    ['env_bias', regimeProbs.env_bias],
    ['infl_x_p_restrictive', lastRow.inflation_gap * regimeProbs.restrictive],
    ['unemp_x_p_expansionary', lastRow.unemployment_gap * regimeProbs.expansionary],
  ];
  const contributions: Record<string, number> = {};
  for (const [name, x] of fedTerms) {
    contributions[name] = Math.round((FED_COEFFICIENTS[name] ?? 0) * x * 1000000) / 1000000;
  }

  return {
    bank: 'FED',
    actual_rate: lastRow.policy_rate,
    implied_rate: Math.round(implied * 1000) / 1000,
    gap: Math.round((implied - lastRow.policy_rate) * 1000) / 1000,
    r2_insample: FED_R2,
    oos_metrics: FED_OOS,
    model_name: 'AutoRegime ElasticNet-Ridge (α=0.0001)',
    n_features: featureNames.length,
    feature_names: featureNames,
    regime,
    stress_score: Math.round(lastRow.stress_score * 1000) / 1000,
    regime_probabilities: regimeProbs,
    variables: {
      inflation_gap: round2(lastRow.inflation_gap),
      unemployment_gap: round2(lastRow.unemployment_gap),
      y2y: round2(lastRow.y2y), slope: round2(lastRow.slope),
      oil_log_change: round3(lastRow.oil_log_change), r_neg_equity: round3(lastRow.r_neg_equity),
      vix: round2(lastRow.vix), credit_spread: round2(lastRow.credit_spread),
      fci: round3(lastRow.fci), hy_spread: round2(lastRow.hy_spread),
    },
    coefficients: FED_COEFFICIENTS,
    contributions,
    sample_start: rows[0].month, sample_end: lastRow.month, sample_size: rows.length,
  };
}

// ─── Run ECB Model ─────────────────────────────────────────────────────────────

async function fetchEurostatHICP(): Promise<Map<string, number>> {
  // Try Eurostat JSON API for latest HICP annual rate of change (prc_hicp_manr, CP00, EA)
  try {
    const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=EA&coicop=CP00&unit=RCH_A&sinceTimePeriod=2000M01';
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('Eurostat API failed:', resp.status);
      return new Map();
    }
    const json = await resp.json();
    // Eurostat JSON format: dimension time with indices, values as flat object
    const timeDim = json?.dimension?.time?.category?.index;
    const values = json?.value;
    if (!timeDim || !values) return new Map();
    
    const result = new Map<string, number>();
    for (const [period, idx] of Object.entries(timeDim)) {
      const val = values[String(idx)];
      if (val != null) {
        // Convert "2025M01" to "2025-01"
        const month = period.replace('M', '-');
        result.set(month, val as number);
      }
    }
    console.log(`Eurostat HICP: ${result.size} months, latest entries:`,
      [...result.entries()].slice(-3).map(([k, v]) => `${k}=${v}`).join(', '));
    return result;
  } catch (err) {
    console.warn('Eurostat HICP fetch error:', err);
    return new Map();
  }
}

async function runECBModel(months: string[]): Promise<ModelResult> {
  console.log('Fetching ECB data...');
  
  // Try Eurostat first for timely HICP YoY rate, fall back to FRED index
  const eurostatHICP = await fetchEurostatHICP();
  const useEurostat = eurostatHICP.size > 100;
  console.log(`Using ${useEurostat ? 'Eurostat HICP YoY rate' : 'FRED HICP index'} for inflation`);
  
  const [ecbdfr, hicpFred, urate, de10y, de3m, oil, baa10y, hy, vixcls, nfci] = await Promise.all([
    fetchFredCSV('ECBDFR').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    useEurostat ? Promise.resolve(new Map<string, number>()) : fetchFredCSV('CP0000EZ19M086NEST').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('LRHUTTTTEZM156S').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('IRLTLT01DEM156N').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('IR3TIB01DEM156N').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('DCOILBRENTEU').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    // Euro credit spread (BAMLC0A0CMEY) — used as credit_spread input
    fetchFredCSV('BAMLC0A0CMEY').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    // European HY spread (BAMLHE00EHYIEY)
    fetchFredCSV('BAMLHE00EHYIEY').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('VIXCLS').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('NFCI').then(d => toMonthlyMean(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
  ]);

  let equity: Map<string, number>;
  try { equity = await fetchYahooMonthly('^STOXX50E'); } catch { equity = new Map(); }

  // Use Eurostat YoY rate (inflationIsYoY=true) or FRED index (inflationIsYoY=false)
  const hicp = useEurostat ? ffill(eurostatHICP, months) : hicpFred;
  const rows = buildRows(months, ecbdfr, hicp, useEurostat, urate, new Map(), de3m, de10y, oil, equity, baa10y, hy, vixcls, nfci);
  console.log(`ECB: ${rows.length} rows`);
  if (rows.length < 50) throw new Error('Insufficient ECB data');

  const regimeProbs = ECB_REGIME_PROBS;

  const lastRow = rows[rows.length - 1];
  const implied = computeECBImplied(lastRow);

  const allStress = rows.map(r => r.stress_score).sort((a, b) => a - b);
  const q20 = allStress[Math.floor(allStress.length * 0.2)];
  const q80 = allStress[Math.floor(allStress.length * 0.8)];
  const regime = lastRow.stress_score <= q20 ? 'Benign' : lastRow.stress_score >= q80 ? 'Stress' : 'Neutral';

  const featureNames = Object.keys(ECB_COEFFICIENTS).filter(k => k !== 'const');

  // Compute contributions
  const dNegC = lastRow.policy_rate_lag <= 0 ? 1 : 0;
  const dGFCC = (lastRow.month >= '2008-09' && lastRow.month <= '2010-06') ? 1 : 0;
  const dSovC = (lastRow.month >= '2010-04' && lastRow.month <= '2012-09') ? 1 : 0;
  const dPreGFCC = lastRow.month < '2008-09' ? 1 : 0;
  const ecbTerms: [string, number][] = [
    ['y2y', lastRow.y2y],
    ['policy_rate_lag', lastRow.policy_rate_lag],
    ['inflation_gap_l1', lastRow.inflation_gap_l1],
    ['fci_l1', lastRow.fci_l1],
    ['slope_x_d_gfc', lastRow.slope * dGFCC],
    ['slope', lastRow.slope],
    ['y2y_l3', lastRow.y2y_l3],
    ['infl_gap_x_neg_rate', lastRow.inflation_gap * dNegC],
    ['rate_change_l1', lastRow.rate_change_l1],
    ['y2y_x_d_sov_crisis', lastRow.y2y * dSovC],
    ['hy_spread', lastRow.hy_spread],
    ['slope_x_d_neg_rate', lastRow.slope * dNegC],
    ['vix', lastRow.vix],
    ['slope_x_d_pre_gfc', lastRow.slope * dPreGFCC],
    ['fci_l3', lastRow.fci_l3],
  ];
  const contributions: Record<string, number> = {};
  for (const [name, x] of ecbTerms) {
    contributions[name] = Math.round((ECB_COEFFICIENTS[name] ?? 0) * x * 1000000) / 1000000;
  }

  return {
    bank: 'ECB',
    actual_rate: lastRow.policy_rate,
    implied_rate: Math.round(implied * 1000) / 1000,
    gap: Math.round((implied - lastRow.policy_rate) * 1000) / 1000,
    r2_insample: ECB_R2,
    oos_metrics: ECB_OOS,
    model_name: 'P-Value Pruned OLS (threshold=0.10, BAMLC0A0CMEY)',
    n_features: featureNames.length,
    feature_names: featureNames,
    regime,
    stress_score: Math.round(lastRow.stress_score * 1000) / 1000,
    regime_probabilities: regimeProbs,
    variables: {
      inflation_gap: round2(lastRow.inflation_gap),
      unemployment_gap: round2(lastRow.unemployment_gap),
      y2y: round2(lastRow.y2y), slope: round2(lastRow.slope),
      oil_log_change: round3(lastRow.oil_log_change), r_neg_equity: round3(lastRow.r_neg_equity),
      vix: round2(lastRow.vix), credit_spread: round2(lastRow.credit_spread),
      fci: round3(lastRow.fci), hy_spread: round2(lastRow.hy_spread),
    },
    coefficients: ECB_COEFFICIENTS,
    contributions,
    sample_start: rows[0].month, sample_end: lastRow.month, sample_size: rows.length,
  };
}

// ─── Caching ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CACHE_TTL_HOURS = 12;

async function getCached(): Promise<{ fed: ModelResult; ecb: ModelResult; generated_at: string } | null> {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/analysis_cache?analysis_type=eq.policy_reaction_v12&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows?.length) return null;
    const age = (Date.now() - new Date(rows[0].created_at).getTime()) / (1000 * 60 * 60);
    if (age > CACHE_TTL_HOURS) return null;
    return rows[0].result as { fed: ModelResult; ecb: ModelResult; generated_at: string };
  } catch { return null; }
}

async function setCache(result: { fed: ModelResult; ecb: ModelResult; generated_at: string }) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/analysis_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        analysis_type: 'policy_reaction_v12',
        bank: 'ALL',
        data_hash: new Date().toISOString().substring(0, 10),
        result,
      }),
    });
  } catch (err) { console.warn('Cache write failed:', err); }
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const cached = await getCached();
    if (cached) {
      console.log('Returning cached policy reaction v7');
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const months = genMonths(2000, 1, now.getFullYear(), now.getMonth() + 1);

    // Run sequentially to stay within CPU limits
    const fed = await runFedModel(months);
    const ecb = await runECBModel(months);

    const result = { fed, ecb, generated_at: new Date().toISOString() };
    await setCache(result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Policy reaction error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
