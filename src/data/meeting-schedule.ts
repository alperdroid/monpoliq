export type CentralBank = 'FED' | 'ECB';

export interface CentralBankMeeting {
  id: string;
  bank: CentralBank;
  date: string;
  label: string;
  decision: string | null;
}

export const CENTRAL_BANK_MEETINGS: CentralBankMeeting[] = [
  { id: 'ecb-2025-03-06', bank: 'ECB', date: '2025-03-06', label: 'ECB Mar 2025 — Cut to 2.50%', decision: 'Cut — Deposit Facility Rate to 2.50%' },
  { id: 'fed-2025-03-19', bank: 'FED', date: '2025-03-19', label: 'FOMC Mar 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%' },
  { id: 'ecb-2025-04-17', bank: 'ECB', date: '2025-04-17', label: 'ECB Apr 2025 — Cut to 2.25%', decision: 'Cut — Deposit Facility Rate to 2.25%' },
  { id: 'fed-2025-05-07', bank: 'FED', date: '2025-05-07', label: 'FOMC May 2025 — Hold at 4.25–4.50%', decision: 'Hold — Fed Funds Rate at 4.25–4.50%' },
  { id: 'ecb-2025-06-05', bank: 'ECB', date: '2025-06-05', label: 'ECB Jun 2025 — Cut to 2.00%', decision: 'Cut — Deposit Facility Rate to 2.00%' },
  { id: 'fed-2025-06-18', bank: 'FED', date: '2025-06-18', label: 'FOMC Jun 2025 — Cut to 4.00–4.25%', decision: 'Cut 25bps — Fed Funds Rate to 4.00–4.25%' },
  { id: 'ecb-2025-07-24', bank: 'ECB', date: '2025-07-24', label: 'ECB Jul 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2025-07-30', bank: 'FED', date: '2025-07-30', label: 'FOMC Jul 2025 — Cut to 3.75–4.00%', decision: 'Cut 25bps — Fed Funds Rate to 3.75–4.00%' },
  { id: 'ecb-2025-09-11', bank: 'ECB', date: '2025-09-11', label: 'ECB Sep 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2025-09-17', bank: 'FED', date: '2025-09-17', label: 'FOMC Sep 2025 — Cut to 3.50–3.75%', decision: 'Cut 25bps — Fed Funds Rate to 3.50–3.75%' },
  { id: 'fed-2025-10-29', bank: 'FED', date: '2025-10-29', label: 'FOMC Oct 2025 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%' },
  { id: 'ecb-2025-10-30', bank: 'ECB', date: '2025-10-30', label: 'ECB Oct 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2025-12-10', bank: 'FED', date: '2025-12-10', label: 'FOMC Dec 2025 — Cut to 3.25–3.50%', decision: 'Cut 25bps — Fed Funds Rate to 3.25–3.50%' },
  { id: 'ecb-2025-12-18', bank: 'ECB', date: '2025-12-18', label: 'ECB Dec 2025 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2026-01-29', bank: 'FED', date: '2026-01-29', label: 'FOMC Jan 2026 — Hold at 3.25–3.50%', decision: 'Hold — Fed Funds Rate at 3.25–3.50%' },
  { id: 'ecb-2026-02-05', bank: 'ECB', date: '2026-02-05', label: 'ECB Feb 2026 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2026-03-19', bank: 'FED', date: '2026-03-19', label: 'FOMC Mar 2026 — Hold at 3.50–3.75%', decision: 'Hold — Fed Funds Rate at 3.50–3.75%' },
  { id: 'ecb-2026-03-19', bank: 'ECB', date: '2026-03-19', label: 'ECB Mar 2026 — Hold at 2.00%', decision: 'Hold — Deposit Facility Rate at 2.00%' },
  { id: 'fed-2026-04-29', bank: 'FED', date: '2026-04-29', label: 'FOMC Apr 2026', decision: null },
  { id: 'ecb-2026-04-30', bank: 'ECB', date: '2026-04-30', label: 'ECB Apr 2026', decision: null },
  { id: 'fed-2026-06-11', bank: 'FED', date: '2026-06-11', label: 'FOMC Jun 2026', decision: null },
  { id: 'ecb-2026-06-11', bank: 'ECB', date: '2026-06-11', label: 'ECB Jun 2026', decision: null },
  { id: 'ecb-2026-07-23', bank: 'ECB', date: '2026-07-23', label: 'ECB Jul 2026', decision: null },
  { id: 'fed-2026-07-30', bank: 'FED', date: '2026-07-30', label: 'FOMC Jul 2026', decision: null },
  { id: 'ecb-2026-09-10', bank: 'ECB', date: '2026-09-10', label: 'ECB Sep 2026', decision: null },
  { id: 'fed-2026-09-17', bank: 'FED', date: '2026-09-17', label: 'FOMC Sep 2026', decision: null },
  { id: 'ecb-2026-10-29', bank: 'ECB', date: '2026-10-29', label: 'ECB Oct 2026', decision: null },
  { id: 'fed-2026-11-05', bank: 'FED', date: '2026-11-05', label: 'FOMC Nov 2026', decision: null },
  { id: 'fed-2026-12-17', bank: 'FED', date: '2026-12-17', label: 'FOMC Dec 2026', decision: null },
  { id: 'ecb-2026-12-17', bank: 'ECB', date: '2026-12-17', label: 'ECB Dec 2026', decision: null },
].sort((a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank));

export function isMeetingPast(meeting: CentralBankMeeting, now = new Date()): boolean {
  const daysSinceMeeting = (now.getTime() - new Date(`${meeting.date}T12:00:00`).getTime()) / (1000 * 60 * 60 * 24);
  return meeting.decision !== null || daysSinceMeeting >= 5;
}

export function getUpcomingMeetings(now = new Date()): CentralBankMeeting[] {
  return CENTRAL_BANK_MEETINGS.filter(meeting => !isMeetingPast(meeting, now));
}