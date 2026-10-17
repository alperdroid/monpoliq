// ─────────────────────────────────────────────────────────────────────────────
// Statistical history helpers (pure functions; the fetching lives in sentiment-analysis).
//
// 1. Euro-area statistics from the ECB Data Portal, for the months before the live
//    ECB/Eurostat press-release feeds start. The portal serves today's (revised) values,
//    not first releases, and no release dates: each period is dated at its usual
//    Eurostat release (approximate, marked release:approx / vintage:current).
// 2. Central bank balance sheet growth (QE / QT): total assets, year-on-year, sampled
//    once a month (the first weekly statement of each month), for the Fed (H.4.1, WALCL)
//    and the ECB (weekly financial statement, ECBASSETSW), both from FRED.
// 3. A guard for ALFRED release dates of series whose vintage history starts late.
// ─────────────────────────────────────────────────────────────────────────────

export interface Obs { period: string; value: number }

/** SDMX "csvdata" from data-api.ecb.europa.eu → observations in period order. */
export function parseEcbCsv(csv: string): Obs[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const split = (l: string) => l.split(',').map(c => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]);
  const ti = head.indexOf('TIME_PERIOD'), vi = head.indexOf('OBS_VALUE');
  if (ti < 0 || vi < 0) return [];
  const out: Obs[] = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const v = parseFloat(c[vi]);
    if (c[ti] && Number.isFinite(v)) out.push({ period: c[ti], value: v });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export type EcbTransform = 'level' | 'pop';     // as published, or % change on the previous period

export interface EcbSeries {
  /** Metric name, as in the live ECB statistics table (EU in sentiment-analysis). */
  metric: string;
  label: string;
  /** Candidate series (flow/key); the one with the most recent data is used. */
  keys: string[];
  transform: EcbTransform;
  /** Usual release: months after the reference period starts, and day of that month. */
  release: { months: number; day: number };
}

export const ECB_SERIES: EcbSeries[] = [
  { metric: 'HICP', label: 'Euro area annual inflation (HICP)', transform: 'level', release: { months: 1, day: 1 },
    keys: ['HICP/M.U2.N.000000.4D0.ANR', 'ICP/M.U2.N.000000.4.ANR'] },
  { metric: 'Unemployment', label: 'Euro area unemployment rate', transform: 'level', release: { months: 2, day: 1 },
    keys: ['LFSI/M.I9.S.UNEHRT.TOTAL0.15_74.T', 'LFSI/M.U2.S.UNEHRT.TOTAL0.15_74.T', 'LFSI/M.I8.S.UNEHRT.TOTAL0.15_74.T'] },
  // quarterly: the preliminary flash comes about a month after the quarter ends
  { metric: 'GDP', label: 'Euro area GDP, q/q', transform: 'pop', release: { months: 4, day: 1 },
    keys: ['MNA/Q.Y.I9.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.N', 'MNA/Q.Y.I8.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.N'] },
  { metric: 'Ind Prod', label: 'Euro area industrial production, m/m', transform: 'pop', release: { months: 2, day: 13 },
    keys: ['STS/M.I9.Y.PROD.NS0020.4.000', 'STS/M.I8.Y.PROD.NS0020.4.000'] },
  { metric: 'Retail', label: 'Euro area retail trade volume, m/m', transform: 'pop', release: { months: 2, day: 5 },
    keys: ['STS/M.I9.Y.TOVV.2G4700.4.000', 'STS/M.I8.Y.TOVV.2G4700.4.000'] },
  { metric: 'PPI', label: 'Euro area industrial producer prices, m/m', transform: 'pop', release: { months: 2, day: 3 },
    keys: ['STS/M.I9.N.PRIN.NS0020.4.000', 'STS/M.I8.N.PRIN.NS0020.4.000'] },
];

export function ecbDataUrl(key: string, startPeriod: string): string {
  const [flow, ...rest] = key.split('/');
  return `https://data-api.ecb.europa.eu/service/data/${flow}/${rest.join('/')}?format=csvdata&detail=dataonly&startPeriod=${startPeriod}`;
}

/** First day of a period: "2015-03" → 2015-03-01, "2015-Q2" → 2015-04-01. */
export function periodStart(period: string): string {
  const q = period.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}-${String((+q[2] - 1) * 3 + 1).padStart(2, '0')}-01`;
  return period.length === 7 ? `${period}-01` : period.slice(0, 10);
}

/** Usual release date of a period (approximate). */
export function approxRelease(period: string, rel: { months: number; day: number }): string {
  const d = new Date(periodStart(period) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + rel.months, rel.day);
  return d.toISOString().slice(0, 10);
}

/** Values to score: the published level, or the % change on the previous period. */
export function transformSeries(obs: Obs[], t: EcbTransform): Obs[] {
  if (t === 'level') return obs;
  const out: Obs[] = [];
  for (let i = 1; i < obs.length; i++) {
    if (obs[i - 1].value === 0) continue;
    out.push({ period: obs[i].period, value: (obs[i].value / obs[i - 1].value - 1) * 100 });
  }
  return out;
}

export interface StatRow { metric: string; period: string; release: string; value: number }

/** Rows released in [from, before) for one ECB series. */
export function ecbRows(s: EcbSeries, obs: Obs[], from: string, before: string): StatRow[] {
  return transformSeries(obs, s.transform)
    .map(o => ({ metric: s.metric, period: o.period, release: approxRelease(o.period, s.release), value: Math.round(o.value * 100) / 100 }))
    .filter(r => r.release >= from && r.release < before);
}

// ── Balance sheet growth ──

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Year-on-year % change in total assets at the first weekly observation of each month
 * (dates ascending). The comparison is the observation closest to 52 weeks earlier
 * (within 4 days); months without one are skipped.
 */
export function balanceSheetYoY(obs: { date: string; value: number }[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < obs.length; i++) {
    if (i > 0 && obs[i - 1].date.slice(0, 7) === obs[i].date.slice(0, 7)) continue;   // not the first of its month
    const target = Date.parse(addDays(obs[i].date, -364) + 'T00:00:00Z');
    let best: { date: string; value: number } | null = null, gap = Infinity;
    for (let j = i - 1; j >= 0; j--) {
      const g = Math.abs(Date.parse(obs[j].date + 'T00:00:00Z') - target) / 86400000;
      if (g < gap) { gap = g; best = obs[j]; }
      if (Date.parse(obs[j].date + 'T00:00:00Z') < target - 10 * 86400000) break;
    }
    if (!best || gap > 4 || best.value === 0) continue;
    out.push({ date: obs[i].date, value: Math.round((obs[i].value / best.value - 1) * 10000) / 100 });
  }
  return out;
}

/**
 * Publication date for an ALFRED first release. Some series' vintage history starts years after
 * the observation (the first vintage then stamps every older value); such dates are replaced by
 * the observation date plus the series' usual publication lag.
 */
export function releaseDate(observed: string, realtimeStart: string | undefined, lagDays: number, maxLagDays: number): string {
  const usual = addDays(observed, lagDays);
  if (!realtimeStart || realtimeStart === '1776-07-04') return usual;
  return realtimeStart > addDays(observed, maxLagDays) ? usual : realtimeStart;
}
