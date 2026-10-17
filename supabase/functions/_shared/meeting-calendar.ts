// ─────────────────────────────────────────────────────────────────────────────
// Rate-decision calendar, 2015 onwards: which meetings the document fetchers read.
//
// FOMC: the decision day (second day of a two-day meeting; the date in the Fed's URLs:
// monetaryYYYYMMDDa.htm, fomcminutesYYYYMMDD.htm, FOMCpresconfYYYYMMDD.pdf,
// fomcprojtablYYYYMMDD.htm). Until 2018 the Chair held a press conference and the SEP was
// published at the quarterly meetings only (March, June, September, December); from 2019
// every meeting has a press conference. In March 2020 the scheduled meeting was replaced by
// the unscheduled 3 and 15 March decisions and no SEP was published.
// ECB: Governing Council monetary policy meetings, each followed by a press conference.
//
// The bps of each decision live in POLICY_ACTIONS (_shared/scoring-weights.ts) and
// src/data/meeting-schedule.ts; tests/calendar_test.ts keeps the three in step.
// When a new year's schedule is published, add its dates here.
// ─────────────────────────────────────────────────────────────────────────────

const FOMC_DATES = [
  '2015-01-28', '2015-03-18', '2015-04-29', '2015-06-17', '2015-07-29', '2015-09-17', '2015-10-28', '2015-12-16',
  '2016-01-27', '2016-03-16', '2016-04-27', '2016-06-15', '2016-07-27', '2016-09-21', '2016-11-02', '2016-12-14',
  '2017-02-01', '2017-03-15', '2017-05-03', '2017-06-14', '2017-07-26', '2017-09-20', '2017-11-01', '2017-12-13',
  '2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13', '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19',
  '2019-01-30', '2019-03-20', '2019-05-01', '2019-06-19', '2019-07-31', '2019-09-18', '2019-10-30', '2019-12-11',
  '2020-01-29', '2020-03-03', '2020-03-15', '2020-04-29', '2020-06-10', '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16',
  '2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16', '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15',
  '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
  '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
];

/** Unscheduled FOMC decisions (no SEP). */
const FOMC_UNSCHEDULED = new Set(['2020-03-03', '2020-03-15']);

export const ECB_DATES = [
  '2015-01-22', '2015-03-05', '2015-04-15', '2015-06-03', '2015-07-16', '2015-09-03', '2015-10-22', '2015-12-03',
  '2016-01-21', '2016-03-10', '2016-04-21', '2016-06-02', '2016-07-21', '2016-09-08', '2016-10-20', '2016-12-08',
  '2017-01-19', '2017-03-09', '2017-04-27', '2017-06-08', '2017-07-20', '2017-09-07', '2017-10-26', '2017-12-14',
  '2018-01-25', '2018-03-08', '2018-04-26', '2018-06-14', '2018-07-26', '2018-09-13', '2018-10-25', '2018-12-13',
  '2019-01-24', '2019-03-07', '2019-04-10', '2019-06-06', '2019-07-25', '2019-09-12', '2019-10-24', '2019-12-12',
  '2020-01-23', '2020-03-12', '2020-04-30', '2020-06-04', '2020-07-16', '2020-09-10', '2020-10-29', '2020-12-10',
  '2021-01-21', '2021-03-11', '2021-04-22', '2021-06-10', '2021-07-22', '2021-09-09', '2021-10-28', '2021-12-16',
  '2022-02-03', '2022-03-10', '2022-04-14', '2022-06-09', '2022-07-21', '2022-09-08', '2022-10-27', '2022-12-15',
  '2023-02-02', '2023-03-16', '2023-05-04', '2023-06-15', '2023-07-27', '2023-09-14', '2023-10-26', '2023-12-14',
  '2024-01-25', '2024-03-07', '2024-04-11', '2024-06-06', '2024-07-18', '2024-09-12', '2024-10-17', '2024-12-12',
  '2025-01-30', '2025-03-06', '2025-04-17', '2025-06-05', '2025-07-24', '2025-09-11', '2025-10-30', '2025-12-18',
  '2026-02-05', '2026-03-19', '2026-04-30', '2026-06-11', '2026-07-23', '2026-09-10', '2026-10-29', '2026-12-17',
];

export interface FomcMeeting {
  date: string;
  /** The Chair held a press conference (transcript PDF). */
  pressConf: boolean;
  /** A Summary of Economic Projections was published. */
  sep: boolean;
  unscheduled: boolean;
}

const QUARTERLY = new Set(['03', '06', '09', '12']);

export const FOMC_MEETINGS: FomcMeeting[] = FOMC_DATES.map(date => {
  const unscheduled = FOMC_UNSCHEDULED.has(date);
  const sep = !unscheduled && QUARTERLY.has(date.slice(5, 7));
  return { date, sep, unscheduled, pressConf: +date.slice(0, 4) >= 2019 || sep };
});

/** FOMC meetings with a decision date in [from, to] (YYYY-MM-DD). */
export function fomcMeetingsBetween(from: string, to: string): FomcMeeting[] {
  return FOMC_MEETINGS.filter(m => m.date >= from && m.date <= to);
}

/** ECB decision dates in [from, to] (YYYY-MM-DD). */
export function ecbMeetingsBetween(from: string, to: string): string[] {
  return ECB_DATES.filter(d => d >= from && d <= to);
}
