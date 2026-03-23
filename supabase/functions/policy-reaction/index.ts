// Policy Reaction Function — Empirical Policy Rate Calculator
// Implements two-step residual Taylor Rule models for Fed and ECB
// Fetches real macro data from FRED, computes OLS regressions, returns implied policy rates

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Linear Algebra helpers ────────────────────────────────────────────────────

function transpose(m: number[][]): number[][] {
  const rows = m.length, cols = m[0].length;
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) result[j][i] = m[i][j];
  return result;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length, cols = b[0].length, inner = b.length;
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < inner; k++)
        result[i][j] += a[i][k] * b[k][j];
  return result;
}

function matVecMul(m: number[][], v: number[]): number[] {
  return m.map(row => row.reduce((s, val, j) => s + val * v[j], 0));
}

/** Gauss-Jordan matrix inversion for small matrices */
function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented: number[][] = matrix.map((row, i) => {
    const id = new Array(n).fill(0);
    id[i] = 1;
    return [...row, ...id];
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) maxRow = row;
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error('Matrix is singular');

    for (let j = 0; j < 2 * n; j++) augmented[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = 0; j < 2 * n; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  return augmented.map(row => row.slice(n));
}

/** OLS: β = (X'X)^{-1} X'y */
function olsFit(X: number[][], y: number[]): { beta: number[]; fitted: number[]; residuals: number[]; r2: number } {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = invertMatrix(XtX);
  const Xty = matVecMul(Xt, y);
  const beta = matVecMul(XtXinv, Xty);
  const fitted = matVecMul(X, beta);
  const residuals = y.map((yi, i) => yi - fitted[i]);
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = residuals.reduce((s, v) => s + v ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { beta, fitted, residuals, r2 };
}

// ─── FRED Data Fetching ────────────────────────────────────────────────────────

async function fetchFredCSV(seriesId: string): Promise<Map<string, number>> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FRED fetch failed for ${seriesId}: ${resp.status}`);
  const text = await resp.text();
  const lines = text.trim().split('\n');
  const data = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const val = parseFloat(parts[1].trim());
    if (!isNaN(val) && date.length >= 7) {
      data.set(date, val);
    }
  }
  return data;
}

/** Convert daily/irregular FRED data to monthly (last value per month) */
function toMonthlyLast(data: Map<string, number>): Map<string, number> {
  const monthly = new Map<string, number>();
  for (const [date, val] of data) {
    const month = date.substring(0, 7); // "YYYY-MM"
    monthly.set(month, val); // later dates overwrite = last value
  }
  return monthly;
}

/** Convert daily/irregular FRED data to monthly (mean per month) */
function toMonthlyMean(data: Map<string, number>): Map<string, number> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const [date, val] of data) {
    const month = date.substring(0, 7);
    const b = buckets.get(month) || { sum: 0, count: 0 };
    b.sum += val;
    b.count++;
    buckets.set(month, b);
  }
  const monthly = new Map<string, number>();
  for (const [month, b] of buckets) {
    monthly.set(month, b.sum / b.count);
  }
  return monthly;
}

/** Generate monthly keys from start to end (inclusive) */
function generateMonthlyIndex(startYear: number, startMonth: number, endYear: number, endMonth: number): string[] {
  const months: string[] = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/** Forward-fill a series across months */
function forwardFill(data: Map<string, number>, months: string[]): Map<string, number> {
  const filled = new Map<string, number>();
  let lastVal: number | null = null;
  for (const m of months) {
    if (data.has(m)) lastVal = data.get(m)!;
    if (lastVal !== null) filled.set(m, lastVal);
  }
  return filled;
}

/** Get value for a month, or null */
function getVal(data: Map<string, number>, month: string): number | null {
  return data.has(month) ? data.get(month)! : null;
}

// ─── Equity data from Yahoo Finance ────────────────────────────────────────────

async function fetchYahooMonthly(symbol: string): Promise<Map<string, number>> {
  // Use Yahoo Finance v8 chart API
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(new Date('2000-01-01').getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${now}&interval=1mo`;
  
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  if (!resp.ok) {
    console.warn(`Yahoo fetch failed for ${symbol}: ${resp.status}`);
    return new Map();
  }
  
  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) return new Map();
  
  const timestamps: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
  
  const monthly = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.set(key, closes[i]!);
  }
  return monthly;
}

// ─── Model Building ────────────────────────────────────────────────────────────

interface ModelResult {
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

interface DataRow {
  month: string;
  policy_rate: number;
  policy_rate_lag: number;
  inflation_gap: number;
  unemployment_gap: number;
  unemployment_gap_l3: number;
  y2y: number;
  slope: number;
  oil_log_change: number;
  r_neg_equity: number;
  credit_spread: number | null;
  hy_spread: number | null;
  vix: number | null;
  fci: number | null;
  fci_l1: number | null;
}

async function buildFedModel(months: string[]): Promise<ModelResult> {
  console.log('Fetching Fed FRED data...');
  
  const [fedfunds, pcepilfe, unrate, nrou, dgs2, dgs10, oil, baa10y, hy, vixcls, nfci] = await Promise.all([
    fetchFredCSV('FEDFUNDS').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('PCEPILFE').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('UNRATE').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('NROU').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('DGS2').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('DGS10').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('DCOILBRENTEU').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('BAA10Y').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('BAMLH0A0HYM2').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('VIXCLS').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('NFCI').then(d => toMonthlyMean(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
  ]);

  let eqMonthly: Map<string, number>;
  try {
    eqMonthly = await fetchYahooMonthly('^GSPC');
  } catch {
    eqMonthly = new Map();
  }

  console.log(`Fed data sizes: fedfunds=${fedfunds.size}, pcepilfe=${pcepilfe.size}, unrate=${unrate.size}`);

  // Build data rows
  const rows: DataRow[] = [];
  for (let i = 13; i < months.length; i++) {
    const m = months[i];
    const mPrev = months[i - 1];
    const m12 = months[i - 12];
    const mLag3 = i >= 3 ? months[i - 3] : null;
    const mFciLag1 = i >= 1 ? months[i - 1] : null;

    const pr = getVal(fedfunds, m);
    const prLag = getVal(fedfunds, mPrev);
    const pceCur = getVal(pcepilfe, m);
    const pce12 = getVal(pcepilfe, m12);
    const ur = getVal(unrate, m);
    const y2 = getVal(dgs2, m);
    const y10 = getVal(dgs10, m);
    const oilCur = getVal(oil, m);
    const oilPrev = getVal(oil, mPrev);

    if (pr == null || prLag == null || pceCur == null || pce12 == null || ur == null || y2 == null || y10 == null || oilCur == null || oilPrev == null) continue;
    if (pce12 === 0 || oilPrev === 0) continue;

    const coreYoy = ((pceCur / pce12) - 1) * 100;
    const inflGap = coreYoy - 2.0;

    // NAIRU: use NROU if available, else rolling 120-month mean of unemployment
    let nairu: number;
    const nrouVal = getVal(nrou, m);
    if (nrouVal != null) {
      nairu = nrouVal;
    } else {
      // Rolling average
      let sum = 0, cnt = 0;
      const lookback = Math.min(120, i);
      for (let j = i - lookback; j <= i; j++) {
        const uv = getVal(unrate, months[j]);
        if (uv != null) { sum += uv; cnt++; }
      }
      nairu = cnt > 0 ? sum / cnt : ur;
    }
    const uGap = nairu - ur;

    // Unemployment gap L3
    let uGapL3: number | null = null;
    if (mLag3) {
      const urL3 = getVal(unrate, mLag3);
      if (urL3 != null) {
        let nairu3: number;
        const nrouL3 = getVal(nrou, mLag3);
        if (nrouL3 != null) {
          nairu3 = nrouL3;
        } else {
          let s2 = 0, c2 = 0;
          const lb = Math.min(120, i - 3);
          for (let j = (i - 3) - lb; j <= i - 3; j++) {
            const uv = getVal(unrate, months[j]);
            if (uv != null) { s2 += uv; c2++; }
          }
          nairu3 = c2 > 0 ? s2 / c2 : urL3;
        }
        uGapL3 = nairu3 - urL3;
      }
    }
    if (uGapL3 == null) continue;

    const slope = y10 - y2;
    const oilLogChange = Math.log(oilCur) - Math.log(oilPrev);

    // Equity downside
    let rNegEq = 0;
    const eqCur = eqMonthly.get(m);
    const eqPrev = eqMonthly.get(mPrev);
    if (eqCur != null && eqPrev != null && eqPrev > 0) {
      const eqRet = Math.log(eqCur) - Math.log(eqPrev);
      rNegEq = Math.max(-eqRet, 0);
    }

    const cs = getVal(baa10y, m) ?? null;
    const hyVal = getVal(hy, m) ?? null;
    const vixVal = getVal(vixcls, m) ?? null;
    const fciVal = getVal(nfci, m) ?? null;
    const fciL1 = mFciLag1 ? (getVal(nfci, mFciLag1) ?? null) : null;

    rows.push({
      month: m,
      policy_rate: pr,
      policy_rate_lag: prLag,
      inflation_gap: inflGap,
      unemployment_gap: uGap,
      unemployment_gap_l3: uGapL3,
      y2y: y2,
      slope,
      oil_log_change: oilLogChange,
      r_neg_equity: rNegEq,
      credit_spread: cs,
      hy_spread: hyVal,
      vix: vixVal,
      fci: fciVal,
      fci_l1: fciL1,
    });
  }

  console.log(`Fed model: ${rows.length} data rows`);
  if (rows.length < 30) throw new Error('Insufficient Fed data for model estimation');

  return runTwoStepModel(rows, 'FED');
}

async function buildEcbModel(months: string[]): Promise<ModelResult> {
  console.log('Fetching ECB FRED data...');

  const [ecbdfr, hicp, urate, de10y, de3m, oil, baa10y, hy, vixcls, nfci] = await Promise.all([
    fetchFredCSV('ECBDFR').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('CP0000EZ19M086NEST').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('LRHUTTTTEZM156S').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('IRLTLT01DEM156N').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('IR3TIB01DEM156N').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('DCOILBRENTEU').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)),
    fetchFredCSV('BAA10Y').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('BAMLH0A0HYM2').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('VIXCLS').then(d => toMonthlyLast(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('NFCI').then(d => toMonthlyMean(d)).then(d => forwardFill(d, months)).catch(() => new Map<string, number>()),
  ]);

  let eqMonthly: Map<string, number>;
  try {
    eqMonthly = await fetchYahooMonthly('^STOXX50E');
  } catch {
    eqMonthly = new Map();
  }

  console.log(`ECB data sizes: ecbdfr=${ecbdfr.size}, hicp=${hicp.size}, urate=${urate.size}`);

  const rows: DataRow[] = [];
  for (let i = 1; i < months.length; i++) {
    const m = months[i];
    const mPrev = months[i - 1];
    const mLag3 = i >= 3 ? months[i - 3] : null;
    const mFciLag1 = i >= 1 ? months[i - 1] : null;

    const pr = getVal(ecbdfr, m);
    const prLag = getVal(ecbdfr, mPrev);
    const hicpVal = getVal(hicp, m);
    const ur = getVal(urate, m);
    const y2 = getVal(de3m, m); // 3M money market rate as short rate proxy
    const y10 = getVal(de10y, m);
    const oilCur = getVal(oil, m);
    const oilPrev = getVal(oil, mPrev);

    if (pr == null || prLag == null || hicpVal == null || ur == null || y2 == null || y10 == null || oilCur == null || oilPrev == null) continue;
    if (oilPrev === 0) continue;

    // ECB inflation gap: HICP YoY is already given directly, subtract target of 2.0
    const inflGap = hicpVal - 2.0;

    // NAIRU for ECB: rolling 120-month mean
    let sum = 0, cnt = 0;
    const lookback = Math.min(120, i);
    for (let j = Math.max(0, i - lookback); j <= i; j++) {
      const uv = getVal(urate, months[j]);
      if (uv != null) { sum += uv; cnt++; }
    }
    const nairu = cnt > 0 ? sum / cnt : ur;
    const uGap = nairu - ur;

    // U gap L3
    let uGapL3: number | null = null;
    if (mLag3 && i >= 3) {
      const urL3 = getVal(urate, mLag3);
      if (urL3 != null) {
        let s2 = 0, c2 = 0;
        const lb = Math.min(120, i - 3);
        for (let j = Math.max(0, (i - 3) - lb); j <= i - 3; j++) {
          const uv = getVal(urate, months[j]);
          if (uv != null) { s2 += uv; c2++; }
        }
        const nairu3 = c2 > 0 ? s2 / c2 : urL3;
        uGapL3 = nairu3 - urL3;
      }
    }
    if (uGapL3 == null) continue;

    const slope = y10 - y2;
    const oilLogChange = Math.log(oilCur) - Math.log(oilPrev);

    let rNegEq = 0;
    const eqCur = eqMonthly.get(m);
    const eqPrev = eqMonthly.get(mPrev);
    if (eqCur != null && eqPrev != null && eqPrev > 0) {
      const eqRet = Math.log(eqCur) - Math.log(eqPrev);
      rNegEq = Math.max(-eqRet, 0);
    }

    const cs = getVal(baa10y, m) ?? null;
    const hyVal = getVal(hy, m) ?? null;
    const vixVal = getVal(vixcls, m) ?? null;
    const fciVal = getVal(nfci, m) ?? null;
    const fciL1 = mFciLag1 ? (getVal(nfci, mFciLag1) ?? null) : null;

    rows.push({
      month: m,
      policy_rate: pr,
      policy_rate_lag: prLag,
      inflation_gap: inflGap,
      unemployment_gap: uGap,
      unemployment_gap_l3: uGapL3,
      y2y: y2,
      slope,
      oil_log_change: oilLogChange,
      r_neg_equity: rNegEq,
      credit_spread: cs,
      hy_spread: hyVal,
      vix: vixVal,
      fci: fciVal,
      fci_l1: fciL1,
    });
  }

  console.log(`ECB model: ${rows.length} data rows`);
  if (rows.length < 30) throw new Error('Insufficient ECB data for model estimation');

  return runTwoStepModel(rows, 'ECB');
}

/** Run the two-step residual Taylor Rule model (Approach 2) */
function runTwoStepModel(rows: DataRow[], bank: string): ModelResult {
  const n = rows.length;

  // Step 1: Macro block
  // i_t = α + ρ*i_{t-1} + φ_π*π_gap + φ_u*u_gap + φ_{u,3}*u_gap_{t-3} + e_t
  const y = rows.map(r => r.policy_rate);
  const X_macro: number[][] = rows.map(r => [
    1, // constant
    r.policy_rate_lag,
    r.inflation_gap,
    r.unemployment_gap,
    r.unemployment_gap_l3,
  ]);

  const macroResult = olsFit(X_macro, y);

  // Step 2: Residual block on orthogonalized market signals
  // Build market feature matrix for rows that have all financial data
  const marketColNames = ['y2y', 'slope', 'oil_log_change', 'r_neg_equity', 'credit_spread', 'hy_spread', 'vix', 'fci', 'fci_l1'];

  // Find which market columns are available (>85% non-null)
  const availMarketCols: string[] = [];
  for (const col of marketColNames) {
    const nonNull = rows.filter(r => (r as Record<string, unknown>)[col] != null).length;
    if (nonNull / n >= 0.85) availMarketCols.push(col);
  }

  // Filter to rows with all available market data
  const validRows = rows.filter(r => {
    for (const col of availMarketCols) {
      if ((r as Record<string, unknown>)[col] == null) return false;
    }
    return true;
  });

  let r2Combined = macroResult.r2;
  let impliedCombined = macroResult.fitted[n - 1];

  if (validRows.length >= 30 && availMarketCols.length > 0) {
    const yValid = validRows.map(r => r.policy_rate);
    const X_macroValid: number[][] = validRows.map(r => [1, r.policy_rate_lag, r.inflation_gap, r.unemployment_gap, r.unemployment_gap_l3]);
    const macroValid = olsFit(X_macroValid, yValid);

    // Build market matrix with constant
    const M_raw: number[][] = validRows.map(r => {
      const row = [1]; // constant for residual block
      for (const col of availMarketCols) {
        row.push((r as Record<string, unknown>)[col] as number);
      }
      return row;
    });

    // Orthogonalize each market column against macro block
    const M_orth: number[][] = M_raw.map(row => [...row]);
    for (let j = 0; j < M_raw[0].length; j++) {
      const colVec = M_raw.map(row => row[j]);
      const orthoResult = olsFit(X_macroValid, colVec);
      for (let i = 0; i < M_orth.length; i++) {
        M_orth[i][j] = colVec[i] - orthoResult.fitted[i];
      }
    }

    // Fit residuals
    try {
      const residResult = olsFit(M_orth, macroValid.residuals);
      const combinedFit = macroValid.fitted.map((mf, i) => mf + residResult.fitted[i]);
      const ssRes = yValid.reduce((s, yi, i) => s + (yi - combinedFit[i]) ** 2, 0);
      const yMean = yValid.reduce((s, v) => s + v, 0) / yValid.length;
      const ssTot = yValid.reduce((s, v) => s + (v - yMean) ** 2, 0);
      r2Combined = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      // Latest combined implied rate
      const lastIdx = validRows.length - 1;
      impliedCombined = combinedFit[lastIdx];
    } catch (err) {
      console.warn(`Combined model failed for ${bank}, using macro only:`, err);
    }
  }

  // Compute stress score for latest observation for regime classification
  const lastRow = rows[n - 1];
  let stressScore = 0;
  let regime = 'Neutral';

  // Simple stress score based on available data
  const stressComponents: number[] = [];
  if (lastRow.credit_spread != null) {
    // Standardize against sample
    const csVals = rows.filter(r => r.credit_spread != null).map(r => r.credit_spread!);
    const csMean = csVals.reduce((s, v) => s + v, 0) / csVals.length;
    const csStd = Math.sqrt(csVals.reduce((s, v) => s + (v - csMean) ** 2, 0) / csVals.length) || 1;
    stressComponents.push((lastRow.credit_spread - csMean) / csStd);
  }
  if (lastRow.vix != null) {
    const vVals = rows.filter(r => r.vix != null).map(r => r.vix!);
    const vMean = vVals.reduce((s, v) => s + v, 0) / vVals.length;
    const vStd = Math.sqrt(vVals.reduce((s, v) => s + (v - vMean) ** 2, 0) / vVals.length) || 1;
    stressComponents.push((lastRow.vix - vMean) / vStd);
  }
  if (lastRow.fci != null) {
    const fVals = rows.filter(r => r.fci != null).map(r => r.fci!);
    const fMean = fVals.reduce((s, v) => s + v, 0) / fVals.length;
    const fStd = Math.sqrt(fVals.reduce((s, v) => s + (v - fMean) ** 2, 0) / fVals.length) || 1;
    stressComponents.push((lastRow.fci - fMean) / fStd);
  }

  if (stressComponents.length > 0) {
    stressScore = stressComponents.reduce((s, v) => s + v, 0) / stressComponents.length;
    // Compute quantiles for regime
    const allStress: number[] = [];
    for (const r of rows) {
      const comps: number[] = [];
      if (r.credit_spread != null) comps.push(r.credit_spread);
      if (r.vix != null) comps.push(r.vix);
      if (r.fci != null) comps.push(r.fci);
      if (comps.length > 0) allStress.push(comps.reduce((s, v) => s + v, 0) / comps.length);
    }
    allStress.sort((a, b) => a - b);
    const q20 = allStress[Math.floor(allStress.length * 0.2)];
    const q80 = allStress[Math.floor(allStress.length * 0.8)];
    const currentSimple = stressComponents.length > 0 ? stressComponents.reduce((s, v) => s + v, 0) / stressComponents.length : 0;
    if (currentSimple <= q20) regime = 'Benign';
    else if (currentSimple >= q80) regime = 'Stress';
    else regime = 'Neutral';
  }

  const macroCoefs: Record<string, number> = {};
  const coefNames = ['const', 'rho (persistence)', 'phi_pi (inflation)', 'phi_u (unemployment)', 'phi_u_l3 (unemp lag3)'];
  macroResult.beta.forEach((b, i) => { macroCoefs[coefNames[i] || `coef_${i}`] = Math.round(b * 10000) / 10000; });

  const impliedMacro = macroResult.fitted[n - 1];

  return {
    bank,
    actual_rate: lastRow.policy_rate,
    implied_rate_macro: Math.round(impliedMacro * 1000) / 1000,
    implied_rate_combined: Math.round(impliedCombined * 1000) / 1000,
    gap_macro: Math.round((impliedMacro - lastRow.policy_rate) * 1000) / 1000,
    gap_combined: Math.round((impliedCombined - lastRow.policy_rate) * 1000) / 1000,
    r2_macro: Math.round(macroResult.r2 * 10000) / 10000,
    r2_combined: Math.round(r2Combined * 10000) / 10000,
    sample_start: rows[0].month,
    sample_end: lastRow.month,
    sample_size: n,
    latest_month: lastRow.month,
    variables: {
      inflation_gap: Math.round(lastRow.inflation_gap * 100) / 100,
      unemployment_gap: Math.round(lastRow.unemployment_gap * 100) / 100,
      y2y: lastRow.y2y != null ? Math.round(lastRow.y2y * 100) / 100 : null,
      slope: Math.round(lastRow.slope * 100) / 100,
      oil_log_change: Math.round(lastRow.oil_log_change * 1000) / 1000,
      credit_spread: lastRow.credit_spread != null ? Math.round(lastRow.credit_spread * 100) / 100 : null,
      vix: lastRow.vix != null ? Math.round(lastRow.vix * 100) / 100 : null,
      fci: lastRow.fci != null ? Math.round(lastRow.fci * 1000) / 1000 : null,
    },
    macro_coefficients: macroCoefs,
    regime,
    stress_score: Math.round(stressScore * 1000) / 1000,
  };
}

// ─── Caching ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CACHE_TTL_HOURS = 12;

async function getCachedResult(): Promise<{ fed: ModelResult; ecb: ModelResult; generated_at: string } | null> {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/analysis_cache?analysis_type=eq.policy_reaction&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const age = (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
    if (age > CACHE_TTL_HOURS) return null;
    return row.result as { fed: ModelResult; ecb: ModelResult; generated_at: string };
  } catch {
    return null;
  }
}

async function setCachedResult(result: { fed: ModelResult; ecb: ModelResult; generated_at: string }) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/analysis_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        analysis_type: 'policy_reaction',
        bank: 'ALL',
        data_hash: new Date().toISOString().substring(0, 10),
        result,
      }),
    });
  } catch (err) {
    console.warn('Failed to cache result:', err);
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check cache first
    const cached = await getCachedResult();
    if (cached) {
      console.log('Returning cached policy reaction result');
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate monthly index from 2000-01 to current month
    const now = new Date();
    const months = generateMonthlyIndex(2000, 1, now.getFullYear(), now.getMonth() + 1);

    // Run both models in parallel
    const [fed, ecb] = await Promise.all([
      buildFedModel(months),
      buildEcbModel(months),
    ]);

    const result = {
      fed,
      ecb,
      generated_at: new Date().toISOString(),
    };

    // Cache the result
    await setCachedResult(result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Policy reaction error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
