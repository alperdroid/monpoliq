// Policy Reaction Function — Regime-Aware Econometric Policy Rate Models
// Fed: 18-feature AutoRegime ElasticNet-derived (13 base + 5 regime)
// ECB: 14-feature p-value pruned structural break + automatic regime classifier

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Linear Algebra ────────────────────────────────────────────────────────────

function transpose(m: number[][]): number[][] {
  const rows = m.length, cols = m[0].length;
  const r: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) r[j][i] = m[i][j];
  return r;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length, cols = b[0].length, inner = b.length;
  const r: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < inner; k++)
        r[i][j] += a[i][k] * b[k][j];
  return r;
}

function matVecMul(m: number[][], v: number[]): number[] {
  return m.map(row => row.reduce((s, val, j) => s + val * v[j], 0));
}

function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const aug: number[][] = matrix.map((row, i) => {
    const id = new Array(n).fill(0); id[i] = 1;
    return [...row, ...id];
  });
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error('Singular matrix');
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

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

function ridgeFit(X: number[][], y: number[], lambda: number): { beta: number[]; fitted: number[]; r2: number } {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  for (let i = 1; i < XtX.length; i++) XtX[i][i] += lambda;
  const XtXinv = invertMatrix(XtX);
  const Xty = matVecMul(Xt, y);
  const beta = matVecMul(XtXinv, Xty);
  const fitted = matVecMul(X, beta);
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((s, yi, i) => s + (yi - fitted[i]) ** 2, 0);
  return { beta, fitted, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

// ─── Logistic Regression ───────────────────────────────────────────────────────

function sigmoid(z: number): number {
  const clamped = Math.max(-500, Math.min(500, z));
  return 1 / (1 + Math.exp(-clamped));
}

function standardize(X: number[][]): { Xs: number[][]; means: number[]; stds: number[] } {
  const n = X.length, p = X[0].length;
  const means = new Array(p).fill(0);
  const stds = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    means[j] = sum / n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (X[i][j] - means[j]) ** 2;
    stds[j] = Math.sqrt(ss / n) || 1;
  }
  const Xs = X.map(row => row.map((v, j) => (v - means[j]) / stds[j]));
  return { Xs, means, stds };
}

function logisticPredict(
  X_train: number[][], y_train: number[],
  X_test: number[][],
  maxIter = 300, lr = 0.5
): number[] {
  const n = X_train.length, p = X_train[0].length;
  if (n < 5 || new Set(y_train).size < 2) return X_test.map(() => 0.5);

  const { Xs: Xtr_s, means, stds } = standardize(X_train);
  const Xte_s = X_test.map(row => row.map((v, j) => (v - means[j]) / stds[j]));

  const posCount = y_train.filter(v => v === 1).length;
  const negCount = n - posCount;
  const wPos = n / (2 * Math.max(posCount, 1));
  const wNeg = n / (2 * Math.max(negCount, 1));

  const w = new Array(p + 1).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const grad = new Array(p + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = w[0];
      for (let j = 0; j < p; j++) z += Xtr_s[i][j] * w[j + 1];
      const prob = sigmoid(z);
      const sampleW = y_train[i] === 1 ? wPos : wNeg;
      const err = (y_train[i] - prob) * sampleW;
      grad[0] += err;
      for (let j = 0; j < p; j++) grad[j + 1] += err * Xtr_s[i][j];
    }
    for (let j = 0; j <= p; j++) w[j] += lr * grad[j] / n;
  }

  return Xte_s.map(row => {
    let z = w[0];
    for (let j = 0; j < p; j++) z += row[j] * w[j + 1];
    return sigmoid(z);
  });
}

// ─── OOS Evaluation ────────────────────────────────────────────────────────────

interface OOSMetrics {
  rmse: number;
  r2_vs_naive: number;
  r2_level: number;
  n_oos: number;
}

function expandingWindowOOS(y: number[], X: number[][], minTrain: number, lambda = 0): OOSMetrics {
  const n = y.length;
  const minEff = Math.max(minTrain, X[0].length + 10);
  if (n <= minEff + 1) return { rmse: NaN, r2_vs_naive: NaN, r2_level: NaN, n_oos: 0 };

  const yTrue: number[] = [], yPred: number[] = [], yNaive: number[] = [];
  for (let t = minEff; t < n; t++) {
    try {
      const Xtr = X.slice(0, t);
      const ytr = y.slice(0, t);
      const fit = lambda > 0 ? ridgeFit(Xtr, ytr, lambda) : olsFit(Xtr, ytr);
      const pred = X[t].reduce((s, xij, j) => s + xij * fit.beta[j], 0);
      yTrue.push(y[t]);
      yPred.push(pred);
      yNaive.push(y[t - 1]);
    } catch {
      continue;
    }
  }

  if (yTrue.length < 5) return { rmse: NaN, r2_vs_naive: NaN, r2_level: NaN, n_oos: 0 };

  const sseModel = yTrue.reduce((s, yt, i) => s + (yt - yPred[i]) ** 2, 0);
  const sseNaive = yTrue.reduce((s, yt, i) => s + (yt - yNaive[i]) ** 2, 0);
  const yMean = yTrue.reduce((s, v) => s + v, 0) / yTrue.length;
  const ssTot = yTrue.reduce((s, v) => s + (v - yMean) ** 2, 0);

  return {
    rmse: Math.sqrt(sseModel / yTrue.length),
    r2_vs_naive: sseNaive > 0 ? 1 - sseModel / sseNaive : NaN,
    r2_level: ssTot > 0 ? 1 - sseModel / ssTot : NaN,
    n_oos: yTrue.length,
  };
}

// ─── FRED Data ─────────────────────────────────────────────────────────────────

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

// ─── Quantile helper ───────────────────────────────────────────────────────────

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

// ─── Extended Data Row ─────────────────────────────────────────────────────────

interface FullRow {
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
  // Lags
  unemployment_gap_l1: number;
  unemployment_gap_l3: number;
  unemployment_gap_l6: number;
  y2y_l1: number;
  y2y_l3: number;
  slope_l6: number;
  credit_spread_l1: number;
  fci_l1: number;
  fci_l3: number;
  // Derived
  vix_sq: number;
  rate_change_l1: number;
  inflation_gap_l1: number;
  inflation_accel: number;
  stress_score: number;
}

// ─── Fed Model (AutoRegime: 13 base + 5 regime = 18 features) ─────────────────

const FED_BASE_FEATURES = [
  'policy_rate_lag', 'inflation_gap', 'unemployment_gap', 'slope',
  'r_neg_equity', 'vix', 'unemployment_gap_l1', 'vix_sq',
  'unemployment_gap_l6', 'y2y_l1', 'credit_spread_l1', 'slope_l6',
  'y2y_x_d_hy_q75',
] as const;

const FED_REGIME_FEATURES = [
  'p_next_restrictive', 'p_next_expansionary', 'env_bias',
  'infl_x_p_restrictive', 'unemp_x_p_expansionary',
] as const;

const FED_ALL_FEATURES = [...FED_BASE_FEATURES, ...FED_REGIME_FEATURES];

function buildFedFeatureRow(
  row: FullRow,
  hyQ75: number,
  rp: PerRowRegimeProbs | null,
): number[] {
  const dHyQ75 = row.hy_spread >= hyQ75 ? 1 : 0;
  const features = [
    1, // intercept
    row.policy_rate_lag,
    row.inflation_gap,
    row.unemployment_gap,
    row.slope,
    row.r_neg_equity,
    row.vix,
    row.unemployment_gap_l1,
    row.vix_sq,
    row.unemployment_gap_l6,
    row.y2y_l1,
    row.credit_spread_l1,
    row.slope_l6,
    row.y2y * dHyQ75, // Y2Y_X_D_HY_SPREAD_Q75
  ];

  // Regime probability features (per-row expanding-window values)
  if (rp) {
    features.push(
      rp.restrictive,
      rp.expansionary,
      rp.env_bias,
      row.inflation_gap * rp.restrictive,    // INFL_X_P_RESTRICTIVE
      row.unemployment_gap * rp.expansionary, // UNEMP_X_P_EXPANSIONARY
    );
  }

  return features;
}

// ─── ECB Model: 14 p-value pruned features ─────────────────────────────────────
// Correct specification after backward elimination (p <= 0.10):
// Y2Y, POLICY_RATE_LAG, FCI_L1, INFLATION_GAP_L1, Y2Y_L3, SLOPE, HY_SPREAD,
// RATE_CHANGE_L1, FCI_L3, UNEMPLOYMENT_GAP_X_D_GFC, VOL (=VIX),
// INFLATION_GAP_X_D_NEG_RATE_ERA, POLICY_RATE_LAG_X_D_SOV_CRISIS, CREDIT_SPREAD

function isGFC(month: string): boolean {
  return month >= '2008-09' && month <= '2010-06';
}
function isSovCrisis(month: string): boolean {
  return month >= '2010-04' && month <= '2012-09';
}

const ECB_FEATURE_NAMES = [
  'const', 'y2y', 'policy_rate_lag', 'fci_l1', 'inflation_gap_l1', 'y2y_l3',
  'slope', 'hy_spread', 'rate_change_l1', 'fci_l3', 'unemp_gap_x_gfc',
  'vix', 'infl_gap_x_neg_rate', 'rate_lag_x_sov_crisis', 'credit_spread',
];

function buildECBFeatureRow(row: FullRow): number[] {
  const dNegRate = row.policy_rate_lag <= 0 ? 1 : 0;
  const dGFC = isGFC(row.month) ? 1 : 0;
  const dSovCrisis = isSovCrisis(row.month) ? 1 : 0;

  return [
    1, // intercept
    row.y2y,
    row.policy_rate_lag,
    row.fci_l1,
    row.inflation_gap_l1,
    row.y2y_l3,
    row.slope,
    row.hy_spread,
    row.rate_change_l1,
    row.fci_l3,
    row.unemployment_gap * dGFC,      // UNEMPLOYMENT_GAP_X_D_GFC
    row.vix,                           // VOL in the notebook = VIX
    row.inflation_gap * dNegRate,      // INFLATION_GAP_X_D_NEG_RATE_ERA
    row.policy_rate_lag * dSovCrisis,  // POLICY_RATE_LAG_X_D_SOV_CRISIS
    row.credit_spread,
  ];
}

// ─── Regime Classifier (shared for both Fed and ECB) ──────────────────────────

interface RegimeProbs {
  restrictive: number;
  zlb: number;
  gfc: number;
  pandemic: number;
  expansionary: number;
  env_bias: number;
}

/** Per-row regime probabilities for the policy model feature matrix */
interface PerRowRegimeProbs {
  restrictive: number;
  expansionary: number;
  env_bias: number;
}

function isPandemic(month: string): boolean {
  return month >= '2020-03' && month <= '2021-12';
}

function computeRegimeLabels(rows: FullRow[]): {
  restrictive: number[];
  zlb: number[];
  gfc: number[];
  pandemic: number[];
} {
  const rateMu: number[] = [];
  const inflMu: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const windowStart = Math.max(0, i - 59);
    let rSum = 0, rCnt = 0, iSum = 0, iCnt = 0;
    for (let j = windowStart; j <= i; j++) {
      rSum += rows[j].policy_rate_lag; rCnt++;
      iSum += rows[j].inflation_gap; iCnt++;
    }
    rateMu.push(rCnt > 0 ? rSum / rCnt : 0);
    inflMu.push(iCnt > 0 ? iSum / iCnt : 0);
  }

  const rateStd: number[] = [];
  const inflStd: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const windowStart = Math.max(0, i - 59);
    let rSS = 0, iSS = 0, cnt = 0;
    for (let j = windowStart; j <= i; j++) {
      rSS += (rows[j].policy_rate_lag - rateMu[i]) ** 2;
      iSS += (rows[j].inflation_gap - inflMu[i]) ** 2;
      cnt++;
    }
    rateStd.push(cnt > 1 ? Math.sqrt(rSS / cnt) || 1 : 1);
    inflStd.push(cnt > 1 ? Math.sqrt(iSS / cnt) || 1 : 1);
  }

  const restrictive: number[] = [];
  const zlb: number[] = [];
  const gfc: number[] = [];
  const pandemic: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rateZ = (rows[i].policy_rate_lag - rateMu[i]) / rateStd[i];
    const inflZ = (rows[i].inflation_gap - inflMu[i]) / inflStd[i];
    const rateChangeL1 = rows[i].rate_change_l1;

    restrictive.push((rateZ >= 0.5 && inflZ >= 0 && rateChangeL1 >= 0) ? 1 : 0);
    zlb.push(rows[i].policy_rate <= 0 ? 1 : 0);
    gfc.push(isGFC(rows[i].month) ? 1 : 0);
    pandemic.push(isPandemic(rows[i].month) ? 1 : 0);
  }

  return { restrictive, zlb, gfc, pandemic };
}

const CLF_FEATURE_NAMES = [
  'policy_rate_lag', 'inflation_gap', 'unemployment_gap', 'y2y', 'slope',
  'oil_log_change', 'r_neg_equity', 'credit_spread', 'hy_spread', 'vix', 'fci',
  'stress_score', 'rate_change_l1', 'inflation_accel',
];

/**
 * Single full-sample logistic regression for regime probabilities.
 * Trains on [0..n-2] shifted labels, predicts fitted values for all rows.
 * Much faster than expanding-window (~4 fits vs ~1000).
 */
function singlePassRegimeProba(
  X: number[][], yLabel: number[], minTrain: number
): number[] {
  const n = X.length;
  const probs = new Array(n).fill(0);
  if (n < minTrain + 5) return probs;

  // yShifted[i] = yLabel[i+1] (predict next month's label)
  const yShifted = yLabel.slice(1); // length n-1

  // Train on all rows except last, predict all rows
  const Xtrain = X.slice(0, n - 1);
  const ytrain = yShifted.slice(0, n - 1);

  if (new Set(ytrain).size < 2) return probs;

  try {
    const allProbs = logisticPredict(Xtrain, ytrain, X, 300, 0.5);
    for (let i = 0; i < n; i++) probs[i] = allProbs[i];
  } catch {
    // keep zeros
  }

  return probs;
}

/**
 * Compute per-row regime probabilities using single-pass logistic regression.
 */
function computeExpandingRegimeProbs(
  rows: FullRow[],
  labels: { restrictive: number[]; zlb: number[]; gfc: number[]; pandemic: number[] },
  minTrain = 36,
): { perRow: PerRowRegimeProbs[]; latest: RegimeProbs } {
  const X = rows.map(r => CLF_FEATURE_NAMES.map(f => (r as Record<string, number>)[f] ?? 0));

  const pRestr = singlePassRegimeProba(X, labels.restrictive, minTrain);
  const pZlb = singlePassRegimeProba(X, labels.zlb, minTrain);
  const pGfc = singlePassRegimeProba(X, labels.gfc, minTrain);
  const pPandemic = singlePassRegimeProba(X, labels.pandemic, minTrain);

  const perRow: PerRowRegimeProbs[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = pRestr[i];
    const exp = Math.max(pZlb[i], pGfc[i], pPandemic[i]);
    perRow.push({ restrictive: r, expansionary: exp, env_bias: r - exp });
  }

  const last = rows.length - 1;
  const latest: RegimeProbs = {
    restrictive: Math.round(pRestr[last] * 10000) / 10000,
    zlb: Math.round(pZlb[last] * 10000) / 10000,
    gfc: Math.round(pGfc[last] * 10000) / 10000,
    pandemic: Math.round(pPandemic[last] * 10000) / 10000,
    expansionary: Math.round(Math.max(pZlb[last], pGfc[last], pPandemic[last]) * 10000) / 10000,
    env_bias: Math.round((pRestr[last] - Math.max(pZlb[last], pGfc[last], pPandemic[last])) * 10000) / 10000,
  };

  return { perRow, latest };
}


// ─── Build Full Rows ───────────────────────────────────────────────────────────

function buildFullRows(
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
): FullRow[] {
  interface BaseRow {
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
  }

  const baseRows: (BaseRow | null)[] = [];

  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const mPrev = i > 0 ? months[i - 1] : null;
    const m12 = i >= 12 ? months[i - 12] : null;

    const pr = gv(policyRate, m);
    const prLag = mPrev ? gv(policyRate, mPrev) : null;
    const ur = gv(unemployment, m);
    const y2 = gv(shortRate, m);
    const y10 = gv(longRate, m);
    const oilCur = gv(oil, m);
    const oilPrev = mPrev ? gv(oil, mPrev) : null;

    if (pr == null || prLag == null || ur == null || y2 == null || y10 == null || oilCur == null || oilPrev == null || oilPrev === 0) {
      baseRows.push(null);
      continue;
    }

    let inflGap: number;
    if (inflationIsYoY) {
      const hicpVal = gv(inflationSeries, m);
      if (hicpVal == null) { baseRows.push(null); continue; }
      inflGap = hicpVal - 2.0;
    } else {
      if (!m12) { baseRows.push(null); continue; }
      const pceCur = gv(inflationSeries, m);
      const pce12 = gv(inflationSeries, m12);
      if (pceCur == null || pce12 == null || pce12 === 0) { baseRows.push(null); continue; }
      inflGap = ((pceCur / pce12) - 1) * 100 - 2.0;
    }

    const nrouVal = gv(nrou, m);
    let nairu: number;
    if (nrouVal != null) {
      nairu = nrouVal;
    } else {
      nairu = rollingMean(unemployment, months, i, 120) ?? ur;
    }
    const uGap = nairu - ur;

    const slope = y10 - y2;
    const oilLogChange = Math.log(oilCur) - Math.log(oilPrev);

    let rNegEq = 0;
    const eqCur = equity.get(m);
    const eqPrev = mPrev ? equity.get(mPrev) : undefined;
    if (eqCur != null && eqPrev != null && eqPrev > 0) {
      rNegEq = Math.max(-(Math.log(eqCur) - Math.log(eqPrev)), 0);
    }

    baseRows.push({
      month: m,
      policy_rate: pr,
      policy_rate_lag: prLag,
      inflation_gap: inflGap,
      unemployment_gap: uGap,
      y2y: y2,
      slope,
      oil_log_change: oilLogChange,
      r_neg_equity: rNegEq,
      credit_spread: gv(creditSpread, m) ?? 0,
      hy_spread: gv(hySpread, m) ?? 0,
      vix: gv(vix, m) ?? 20,
      fci: gv(fci, m) ?? 0,
    });
  }

  // Second pass: compute lags and derived features
  const fullRows: FullRow[] = [];
  for (let i = 0; i < months.length; i++) {
    const cur = baseRows[i];
    if (!cur) continue;

    const prev1 = i >= 1 ? baseRows[i - 1] : null;
    const prev2 = i >= 2 ? baseRows[i - 2] : null;
    const prev3 = i >= 3 ? baseRows[i - 3] : null;
    const prev6 = i >= 6 ? baseRows[i - 6] : null;

    if (!prev1 || !prev3 || !prev6) continue;

    const stressComps = [cur.credit_spread, cur.hy_spread / 5, cur.vix / 20, cur.fci];
    const stressScore = stressComps.reduce((s, v) => s + v, 0) / stressComps.length;

    fullRows.push({
      ...cur,
      unemployment_gap_l1: prev1.unemployment_gap,
      unemployment_gap_l3: prev3.unemployment_gap,
      unemployment_gap_l6: prev6.unemployment_gap,
      y2y_l1: prev1.y2y,
      y2y_l3: prev3.y2y,
      slope_l6: prev6.slope,
      credit_spread_l1: prev1.credit_spread,
      fci_l1: prev1.fci,
      fci_l3: prev3.fci,
      vix_sq: cur.vix * cur.vix,
      rate_change_l1: prev1.policy_rate - (prev2 ? prev2.policy_rate : prev1.policy_rate),
      inflation_gap_l1: prev1.inflation_gap,
      inflation_accel: cur.inflation_gap - prev1.inflation_gap,
      stress_score: stressScore,
    });
  }

  return fullRows;
}

// ─── Model Result Interface ────────────────────────────────────────────────────

interface ModelResult {
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
  sample_start: string;
  sample_end: string;
  sample_size: number;
}

function round2(v: number | null): number | null { return v != null ? Math.round(v * 100) / 100 : null; }
function round3(v: number | null): number | null { return v != null ? Math.round(v * 1000) / 1000 : null; }

// ─── Run Fed Model (AutoRegime) ────────────────────────────────────────────────

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

  const rows = buildFullRows(months, fedfunds, pcepilfe, false, unrate, nrou, dgs2, dgs10, oil, equity, baa10y, hy, vixcls, nfci);
  console.log(`Fed: ${rows.length} rows`);
  if (rows.length < 50) throw new Error('Insufficient Fed data');

  // HY spread Q75 threshold
  const hyVals = rows.map(r => r.hy_spread).filter(v => v > 0);
  const hyQ75 = hyVals.length > 0 ? quantile(hyVals, 0.75) : 6;

  // Run expanding-window regime classifier for Fed (per-row probabilities)
  const regimeLabels = computeRegimeLabels(rows);
  const { perRow: regimePerRow, latest: regimeProbs } = computeExpandingRegimeProbs(rows, regimeLabels, 36);
  console.log('Fed regime probs (latest):', regimeProbs);

  // Build feature matrix — always use regime-augmented (AutoRegime spec) with per-row probs
  const y = rows.map(r => r.policy_rate);
  const finalX = rows.map((r, i) => buildFedFeatureRow(r, hyQ75, regimePerRow[i]));
  const finalFeatureNames = ['const', ...FED_ALL_FEATURES];
  console.log('Fed: Using AutoRegime specification (18 features, per-row regime probs)');

  // Fit final model
  const fullFit = ridgeFit(finalX, y, 0.0001);
  const oosMetrics = expandingWindowOOS(y, finalX, 60, 0.0001);

  // Regime from stress
  const lastRow = rows[rows.length - 1];
  const allStress = rows.map(r => r.stress_score).sort((a, b) => a - b);
  const q20 = allStress[Math.floor(allStress.length * 0.2)];
  const q80 = allStress[Math.floor(allStress.length * 0.8)];
  const regime = lastRow.stress_score <= q20 ? 'Benign' : lastRow.stress_score >= q80 ? 'Stress' : 'Neutral';

  const coefficients: Record<string, number> = {};
  fullFit.beta.forEach((b, i) => { coefficients[finalFeatureNames[i]] = Math.round(b * 1e6) / 1e6; });

  const implied = finalX[finalX.length - 1].reduce((s, x, j) => s + x * fullFit.beta[j], 0);

  return {
    bank: 'FED',
    actual_rate: lastRow.policy_rate,
    implied_rate: Math.round(implied * 1000) / 1000,
    gap: Math.round((implied - lastRow.policy_rate) * 1000) / 1000,
    r2_insample: Math.round(fullFit.r2 * 10000) / 10000,
    oos_metrics: {
      rmse: Math.round(oosMetrics.rmse * 10000) / 10000,
      r2_vs_naive: Math.round(oosMetrics.r2_vs_naive * 10000) / 10000,
      r2_level: Math.round(oosMetrics.r2_level * 10000) / 10000,
      n_oos: oosMetrics.n_oos,
    },
    model_name: 'AutoRegime ElasticNet-Ridge (α=0.0001)',
    n_features: finalFeatureNames.length - 1,
    feature_names: finalFeatureNames.filter(f => f !== 'const'),
    regime,
    stress_score: Math.round(lastRow.stress_score * 1000) / 1000,
    regime_probabilities: regimeProbs,
    variables: {
      inflation_gap: round2(lastRow.inflation_gap),
      unemployment_gap: round2(lastRow.unemployment_gap),
      y2y: round2(lastRow.y2y),
      slope: round2(lastRow.slope),
      oil_log_change: round3(lastRow.oil_log_change),
      r_neg_equity: round3(lastRow.r_neg_equity),
      vix: round2(lastRow.vix),
      credit_spread: round2(lastRow.credit_spread),
      fci: round3(lastRow.fci),
      hy_spread: round2(lastRow.hy_spread),
    },
    coefficients,
    sample_start: rows[0].month,
    sample_end: lastRow.month,
    sample_size: rows.length,
  };
}

// ─── Run ECB Model (14-feature pruned structural break) ────────────────────────

async function runECBModel(months: string[]): Promise<ModelResult> {
  console.log('Fetching ECB data...');
  const [ecbdfr, hicp, urate, de10y, de3m, oil, baa10y, hy, vixcls, nfci] = await Promise.all([
    fetchFredCSV('ECBDFR').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('CP0000EZ19M086NEST').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('LRHUTTTTEZM156S').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('IRLTLT01DEM156N').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('IR3TIB01DEM156N').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('DCOILBRENTEU').then(d => toMonthlyLast(d)).then(d => ffill(d, months)),
    fetchFredCSV('BAA10Y').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('BAMLH0A0HYM2').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('VIXCLS').then(d => toMonthlyLast(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
    fetchFredCSV('NFCI').then(d => toMonthlyMean(d)).then(d => ffill(d, months)).catch(() => new Map<string, number>()),
  ]);

  let equity: Map<string, number>;
  try { equity = await fetchYahooMonthly('^STOXX50E'); } catch { equity = new Map(); }

  const rows = buildFullRows(months, ecbdfr, hicp, true, urate, new Map(), de3m, de10y, oil, equity, baa10y, hy, vixcls, nfci);
  console.log(`ECB: ${rows.length} rows`);
  if (rows.length < 50) throw new Error('Insufficient ECB data');

  // Run expanding-window regime classifier (for display only, not in ECB feature set after pruning)
  const regimeLabels = computeRegimeLabels(rows);
  const { latest: regimeProbs } = computeExpandingRegimeProbs(rows, regimeLabels, 36);
  console.log('ECB regime probs:', regimeProbs);

  // Build ECB features — 14-feature pruned model
  const y = rows.map(r => r.policy_rate);
  const X = rows.map(r => buildECBFeatureRow(r));

  // Fit final model
  const fullFit = olsFit(X, y);
  const oosMetrics = expandingWindowOOS(y, X, 60);

  const coefficients: Record<string, number> = {};
  fullFit.beta.forEach((b, i) => {
    const name = ECB_FEATURE_NAMES[i] || `feat_${i}`;
    coefficients[name] = Math.round(b * 1e6) / 1e6;
  });

  const lastRow = rows[rows.length - 1];
  const implied = X[X.length - 1].reduce((s, x, j) => s + x * fullFit.beta[j], 0);

  // Regime from stress
  const allStress = rows.map(r => r.stress_score).sort((a, b) => a - b);
  const q20 = allStress[Math.floor(allStress.length * 0.2)];
  const q80 = allStress[Math.floor(allStress.length * 0.8)];
  const regime = lastRow.stress_score <= q20 ? 'Benign' : lastRow.stress_score >= q80 ? 'Stress' : 'Neutral';

  return {
    bank: 'ECB',
    actual_rate: lastRow.policy_rate,
    implied_rate: Math.round(implied * 1000) / 1000,
    gap: Math.round((implied - lastRow.policy_rate) * 1000) / 1000,
    r2_insample: Math.round(fullFit.r2 * 10000) / 10000,
    oos_metrics: {
      rmse: Math.round((oosMetrics.rmse || 0) * 10000) / 10000,
      r2_vs_naive: Math.round((oosMetrics.r2_vs_naive || 0) * 10000) / 10000,
      r2_level: Math.round((oosMetrics.r2_level || 0) * 10000) / 10000,
      n_oos: oosMetrics.n_oos,
    },
    model_name: 'Structural Break OLS (p≤0.10 pruned)',
    n_features: ECB_FEATURE_NAMES.length - 1,
    feature_names: ECB_FEATURE_NAMES.filter(f => f !== 'const'),
    regime,
    stress_score: Math.round(lastRow.stress_score * 1000) / 1000,
    regime_probabilities: regimeProbs,
    variables: {
      inflation_gap: round2(lastRow.inflation_gap),
      unemployment_gap: round2(lastRow.unemployment_gap),
      y2y: round2(lastRow.y2y),
      slope: round2(lastRow.slope),
      oil_log_change: round3(lastRow.oil_log_change),
      r_neg_equity: round3(lastRow.r_neg_equity),
      vix: round2(lastRow.vix),
      credit_spread: round2(lastRow.credit_spread),
      fci: round3(lastRow.fci),
      hy_spread: round2(lastRow.hy_spread),
    },
    coefficients,
    sample_start: rows[0].month,
    sample_end: lastRow.month,
    sample_size: rows.length,
  };
}

// ─── Caching ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CACHE_TTL_HOURS = 12;

async function getCached(): Promise<{ fed: ModelResult; ecb: ModelResult; generated_at: string } | null> {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/analysis_cache?analysis_type=eq.policy_reaction_v6&order=created_at.desc&limit=1`,
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
        analysis_type: 'policy_reaction_v5',
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
      console.log('Returning cached regime-aware policy reaction v3');
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const months = genMonths(2000, 1, now.getFullYear(), now.getMonth() + 1);

    const [fed, ecb] = await Promise.all([runFedModel(months), runECBModel(months)]);

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
