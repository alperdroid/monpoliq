export type CentralBank = 'FED' | 'ECB';

export interface CentralBankMeeting {
  id: string;
  bank: CentralBank;
  date: string;
  label: string;
  decision: string | null;
  /** Realized policy action in basis points (+ hike, − cut, 0 hold). Undefined = not yet decided. */
  bps?: number;
}

// ── 2015 – January 2025: decisions as [date, bps], labels generated below ──
// Same dates and bps as POLICY_ACTIONS in supabase/functions/_shared/scoring-weights.ts
// (src/test/meeting-schedule.test.ts checks the two agree). Fed: change in the upper bound of
// the target range, 0.25% before the first entry; ECB: deposit facility rate, −0.20%.
const FED_HISTORY: [string, number][] = [
  ['2015-01-28', 0], ['2015-03-18', 0], ['2015-04-29', 0], ['2015-06-17', 0], ['2015-07-29', 0], ['2015-09-17', 0], ['2015-10-28', 0], ['2015-12-16', 25],
  ['2016-01-27', 0], ['2016-03-16', 0], ['2016-04-27', 0], ['2016-06-15', 0], ['2016-07-27', 0], ['2016-09-21', 0], ['2016-11-02', 0], ['2016-12-14', 25],
  ['2017-02-01', 0], ['2017-03-15', 25], ['2017-05-03', 0], ['2017-06-14', 25], ['2017-07-26', 0], ['2017-09-20', 0], ['2017-11-01', 0], ['2017-12-13', 25],
  ['2018-01-31', 0], ['2018-03-21', 25], ['2018-05-02', 0], ['2018-06-13', 25], ['2018-08-01', 0], ['2018-09-26', 25], ['2018-11-08', 0], ['2018-12-19', 25],
  ['2019-01-30', 0], ['2019-03-20', 0], ['2019-05-01', 0], ['2019-06-19', 0], ['2019-07-31', -25], ['2019-09-18', -25], ['2019-10-30', -25], ['2019-12-11', 0],
  ['2020-01-29', 0], ['2020-03-03', -50], ['2020-03-15', -100], ['2020-04-29', 0], ['2020-06-10', 0], ['2020-07-29', 0], ['2020-09-16', 0], ['2020-11-05', 0], ['2020-12-16', 0],
  ['2021-01-27', 0], ['2021-03-17', 0], ['2021-04-28', 0], ['2021-06-16', 0], ['2021-07-28', 0], ['2021-09-22', 0], ['2021-11-03', 0], ['2021-12-15', 0],
  ['2022-01-26', 0], ['2022-03-16', 25], ['2022-05-04', 50], ['2022-06-15', 75], ['2022-07-27', 75], ['2022-09-21', 75], ['2022-11-02', 75], ['2022-12-14', 50],
  ['2023-02-01', 25], ['2023-03-22', 25], ['2023-05-03', 25], ['2023-06-14', 0], ['2023-07-26', 25], ['2023-09-20', 0], ['2023-11-01', 0], ['2023-12-13', 0],
  ['2024-01-31', 0], ['2024-03-20', 0], ['2024-05-01', 0], ['2024-06-12', 0], ['2024-07-31', 0], ['2024-09-18', -50], ['2024-11-07', -25], ['2024-12-18', -25],
  ['2025-01-29', 0],
];
const ECB_HISTORY: [string, number][] = [
  ['2015-01-22', 0], ['2015-03-05', 0], ['2015-04-15', 0], ['2015-06-03', 0], ['2015-07-16', 0], ['2015-09-03', 0], ['2015-10-22', 0], ['2015-12-03', -10],
  ['2016-01-21', 0], ['2016-03-10', -10], ['2016-04-21', 0], ['2016-06-02', 0], ['2016-07-21', 0], ['2016-09-08', 0], ['2016-10-20', 0], ['2016-12-08', 0],
  ['2017-01-19', 0], ['2017-03-09', 0], ['2017-04-27', 0], ['2017-06-08', 0], ['2017-07-20', 0], ['2017-09-07', 0], ['2017-10-26', 0], ['2017-12-14', 0],
  ['2018-01-25', 0], ['2018-03-08', 0], ['2018-04-26', 0], ['2018-06-14', 0], ['2018-07-26', 0], ['2018-09-13', 0], ['2018-10-25', 0], ['2018-12-13', 0],
  ['2019-01-24', 0], ['2019-03-07', 0], ['2019-04-10', 0], ['2019-06-06', 0], ['2019-07-25', 0], ['2019-09-12', -10], ['2019-10-24', 0], ['2019-12-12', 0],
  ['2020-01-23', 0], ['2020-03-12', 0], ['2020-04-30', 0], ['2020-06-04', 0], ['2020-07-16', 0], ['2020-09-10', 0], ['2020-10-29', 0], ['2020-12-10', 0],
  ['2021-01-21', 0], ['2021-03-11', 0], ['2021-04-22', 0], ['2021-06-10', 0], ['2021-07-22', 0], ['2021-09-09', 0], ['2021-10-28', 0], ['2021-12-16', 0],
  ['2022-02-03', 0], ['2022-03-10', 0], ['2022-04-14', 0], ['2022-06-09', 0], ['2022-07-21', 50], ['2022-09-08', 75], ['2022-10-27', 75], ['2022-12-15', 50],
  ['2023-02-02', 50], ['2023-03-16', 50], ['2023-05-04', 25], ['2023-06-15', 25], ['2023-07-27', 25], ['2023-09-14', 25], ['2023-10-26', 0], ['2023-12-14', 0],
  ['2024-01-25', 0], ['2024-03-07', 0], ['2024-04-11', 0], ['2024-06-06', -25], ['2024-07-18', 0], ['2024-09-12', -25], ['2024-10-17', -25], ['2024-12-12', -25],
  ['2025-01-30', -25],
];
const UNSCHEDULED = new Set(['2020-03-03', '2020-03-15']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function historicalMeetings(bank: CentralBank, decisions: [string, number][], start: number): CentralBankMeeting[] {
  let rate = start;
  return decisions.map(([date, bps]) => {
    rate = Math.round((rate + bps / 100) * 100) / 100;
    const level = bank === 'FED' ? `${(rate - 0.25).toFixed(2)}–${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`;
    const instrument = bank === 'FED' ? 'Fed Funds Rate' : 'Deposit Facility Rate';
    const when = `${MONTHS[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}${UNSCHEDULED.has(date) ? ' (unscheduled)' : ''}`;
    const move = bps > 0 ? 'Hike' : bps < 0 ? 'Cut' : 'Hold';
    return {
      id: `${bank.toLowerCase()}-${date}`, bank, date,
      label: `${bank === 'FED' ? 'FOMC' : 'ECB'} ${when} — ${move} ${bps ? 'to' : 'at'} ${level}`,
      decision: bps ? `${move} ${Math.abs(bps)}bps — ${instrument} to ${level}` : `Hold — ${instrument} at ${level}`,
      bps,
    };
  });
}

export const CENTRAL_BANK_MEETINGS = ([
  ...historicalMeetings('FED', FED_HISTORY, 0.25),
  ...historicalMeetings('ECB', ECB_HISTORY, -0.20),
  { id: 'ecb-2025-03-06', bank: 'ECB', date: '2025-03-06', label: 'ECB Mar 2025 — Cut to 2.50%', decision: 'Cut — Deposit Facility Rate to 2.50%', bps: -25 },
  { id: 'fed-2025-03-19', bank: 'FED', date: '2025-03-19', label: 'FOMC Mar 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%', bps: 0 },
  { id: 'ecb-2025-04-17', bank: 'ECB', date: '2025-04-17', label: 'ECB Apr 2025 — Cut to 2.25%', decision: 'Cut — Deposit Facility Rate to 2.25%', bps: -25 },
  { id: 'fed-2025-05-07', bank: 'FED', date: '2025-05-07', label: 'FOMC May 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%', bps: 0 },
  { id: 'ecb-2025-06-05', bank: 'ECB', date: '2025-06-05', label: 'ECB Jun 2025 — Cut to 2.00%', decision: 'Cut — Deposit Facility Rate to 2.00%', bps: -25 },
  { id: 'fed-2025-06-18', bank: 'FED', date: '2025-06-18', label: 'FOMC Jun 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%', bps: 0 },
  { id: 'ecb-2025-07-24', bank: 'ECB', date: '2025-07-24', label: 'ECB Jul 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2025-07-30', bank: 'FED', date: '2025-07-30', label: 'FOMC Jul 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%', bps: 0 },
  { id: 'ecb-2025-09-11', bank: 'ECB', date: '2025-09-11', label: 'ECB Sep 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2025-09-17', bank: 'FED', date: '2025-09-17', label: 'FOMC Sep 2025 — Cut to 4.00–4.25%', decision: 'Cut 25bps — Fed Funds Rate to 4.00–4.25%', bps: -25 },
  { id: 'fed-2025-10-29', bank: 'FED', date: '2025-10-29', label: 'FOMC Oct 2025 — Cut to 3.75–4.00%', decision: 'Cut 25bps — Fed Funds Rate to 3.75–4.00%', bps: -25 },
  { id: 'ecb-2025-10-30', bank: 'ECB', date: '2025-10-30', label: 'ECB Oct 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2025-12-10', bank: 'FED', date: '2025-12-10', label: 'FOMC Dec 2025 — Cut to 3.50–3.75%', decision: 'Cut 25bps — Fed Funds Rate to 3.50–3.75%', bps: -25 },
  { id: 'ecb-2025-12-18', bank: 'ECB', date: '2025-12-18', label: 'ECB Dec 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2026-01-28', bank: 'FED', date: '2026-01-28', label: 'FOMC Jan 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%', bps: 0 },
  { id: 'ecb-2026-02-05', bank: 'ECB', date: '2026-02-05', label: 'ECB Feb 2026 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2026-03-18', bank: 'FED', date: '2026-03-18', label: 'FOMC Mar 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%', bps: 0 },
  { id: 'ecb-2026-03-19', bank: 'ECB', date: '2026-03-19', label: 'ECB Mar 2026 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'fed-2026-04-29', bank: 'FED', date: '2026-04-29', label: 'FOMC Apr 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%', bps: 0 },
  { id: 'ecb-2026-04-30', bank: 'ECB', date: '2026-04-30', label: 'ECB Apr 2026 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%', bps: 0 },
  { id: 'ecb-2026-06-11', bank: 'ECB', date: '2026-06-11', label: 'ECB Jun 2026 — Hike to 2.25%', decision: 'Hike 25bps — Deposit Facility Rate to 2.25%', bps: 25 },
  { id: 'fed-2026-06-17', bank: 'FED', date: '2026-06-17', label: 'FOMC Jun 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%', bps: 0 },
  { id: 'ecb-2026-07-23', bank: 'ECB', date: '2026-07-23', label: 'ECB Jul 2026 — Hold at 2.25%', decision: 'Hold — Deposit Facility Rate at 2.25%', bps: 0 },
  { id: 'fed-2026-07-29', bank: 'FED', date: '2026-07-29', label: 'FOMC Jul 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%', bps: 0 },
  { id: 'ecb-2026-09-10', bank: 'ECB', date: '2026-09-10', label: 'ECB Sep 2026 — Hike to 2.50%', decision: 'Hike 25bps — Deposit Facility Rate to 2.50%', bps: 25 },
  { id: 'fed-2026-09-16', bank: 'FED', date: '2026-09-16', label: 'FOMC Sep 2026 — Hike to 3.75–4.00%', decision: 'Hike 25bps — Fed Funds Rate to 3.75–4.00%', bps: 25 },
  { id: 'fed-2026-10-28', bank: 'FED', date: '2026-10-28', label: 'FOMC Oct 2026', decision: null },
  { id: 'ecb-2026-10-29', bank: 'ECB', date: '2026-10-29', label: 'ECB Oct 2026', decision: null },
  { id: 'fed-2026-12-09', bank: 'FED', date: '2026-12-09', label: 'FOMC Dec 2026', decision: null },
  { id: 'ecb-2026-12-17', bank: 'ECB', date: '2026-12-17', label: 'ECB Dec 2026', decision: null },
] satisfies CentralBankMeeting[]).sort((a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank));

export function isMeetingPast(meeting: CentralBankMeeting, now = new Date()): boolean {
  const daysSinceMeeting = (now.getTime() - new Date(`${meeting.date}T12:00:00`).getTime()) / (1000 * 60 * 60 * 24);
  return meeting.decision !== null || daysSinceMeeting >= 5;
}

export function getUpcomingMeetings(now = new Date()): CentralBankMeeting[] {
  return CENTRAL_BANK_MEETINGS.filter(meeting => !isMeetingPast(meeting, now));
}