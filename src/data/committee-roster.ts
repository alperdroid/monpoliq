// ─────────────────────────────────────────────────────────────────────────────
// Rate-setting committees: FOMC (Board of Governors + Reserve Bank presidents) and the ECB
// Governing Council (Executive Board + euro-area NCB governors). One roster for the Committee
// and Speakers pages and the speaker analytics.
//
// VERIFIED AS OF 2026-09-30. Update it when a member changes (and FED_SPEECH_SOURCES /
// BUNDESBANK_PRESIDENT on the backend). Departed members stay listed with `until` so their past
// communications are still attributed; they are not shown as current members.
// ─────────────────────────────────────────────────────────────────────────────

export const ROSTER_VERIFIED = '2026-09-30';

export type Body = 'fed-board' | 'fed-bank' | 'ecb-board' | 'ecb-ncb';

export interface RosterMember {
  name: string;
  /** Lower-case words that identify the member in a title (matched as whole words). */
  patterns: string[];
  bank: 'FED' | 'ECB';
  body: Body;
  role: string;
  institution: string;
  /** Reserve Bank city, for the FOMC voting rotation. */
  fedBank?: string;
  /** In the current role since (YYYY-MM-DD, or YYYY-MM when the day is not published). */
  since?: string;
  /** End of the current term, when fixed (ECB Executive Board). */
  termEnd?: string;
  /** Left the committee on this date (exclusive): former member. */
  until?: string;
  note?: string;
}

export const COMMITTEE_ROSTER: RosterMember[] = [
  // ── Federal Reserve Board ──
  { name: 'Kevin Warsh', patterns: ['warsh'], bank: 'FED', body: 'fed-board', role: 'Chair', institution: 'Federal Reserve Board', since: '2026-05-22' },
  { name: 'Philip Jefferson', patterns: ['jefferson'], bank: 'FED', body: 'fed-board', role: 'Vice Chair', institution: 'Federal Reserve Board' },
  { name: 'Michelle Bowman', patterns: ['bowman'], bank: 'FED', body: 'fed-board', role: 'Vice Chair for Supervision', institution: 'Federal Reserve Board' },
  { name: 'Christopher Waller', patterns: ['waller'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board' },
  { name: 'Lisa Cook', patterns: ['cook'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board',
    note: 'Serving while her challenge to removal proceeds (Supreme Court, 29 Jun 2026)' },
  { name: 'Michael Barr', patterns: ['barr'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board' },
  { name: 'Jerome Powell', patterns: ['powell'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board',
    note: 'Chair until 22 May 2026; remains a governor' },
  { name: 'Stephen Miran', patterns: ['miran'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board', since: '2025-09-16', until: '2026-05-22' },
  { name: 'Adriana Kugler', patterns: ['kugler'], bank: 'FED', body: 'fed-board', role: 'Governor', institution: 'Federal Reserve Board', until: '2025-08-08' },

  // ── Reserve Bank presidents ──
  { name: 'John Williams', patterns: ['williams'], bank: 'FED', body: 'fed-bank', fedBank: 'New York', role: 'President (FOMC Vice Chair)', institution: 'Federal Reserve Bank of New York' },
  { name: 'Susan Collins', patterns: ['collins'], bank: 'FED', body: 'fed-bank', fedBank: 'Boston', role: 'President', institution: 'Federal Reserve Bank of Boston' },
  { name: 'Anna Paulson', patterns: ['paulson'], bank: 'FED', body: 'fed-bank', fedBank: 'Philadelphia', role: 'President', institution: 'Federal Reserve Bank of Philadelphia', since: '2025-07-01' },
  { name: 'Beth Hammack', patterns: ['hammack'], bank: 'FED', body: 'fed-bank', fedBank: 'Cleveland', role: 'President', institution: 'Federal Reserve Bank of Cleveland' },
  { name: 'Thomas Barkin', patterns: ['barkin'], bank: 'FED', body: 'fed-bank', fedBank: 'Richmond', role: 'President', institution: 'Federal Reserve Bank of Richmond' },
  { name: 'Cheryl Venable', patterns: ['venable'], bank: 'FED', body: 'fed-bank', fedBank: 'Atlanta', role: 'Interim President', institution: 'Federal Reserve Bank of Atlanta', since: '2026-03-01',
    note: 'Interim after Raphael Bostic retired; search for a permanent president under way' },
  { name: 'Raphael Bostic', patterns: ['bostic'], bank: 'FED', body: 'fed-bank', fedBank: 'Atlanta', role: 'President', institution: 'Federal Reserve Bank of Atlanta', until: '2026-03-01' },
  { name: 'Austan Goolsbee', patterns: ['goolsbee'], bank: 'FED', body: 'fed-bank', fedBank: 'Chicago', role: 'President', institution: 'Federal Reserve Bank of Chicago' },
  { name: 'Alberto Musalem', patterns: ['musalem'], bank: 'FED', body: 'fed-bank', fedBank: 'St. Louis', role: 'President', institution: 'Federal Reserve Bank of St. Louis' },
  { name: 'Neel Kashkari', patterns: ['kashkari'], bank: 'FED', body: 'fed-bank', fedBank: 'Minneapolis', role: 'President', institution: 'Federal Reserve Bank of Minneapolis' },
  { name: 'Jeffrey Schmid', patterns: ['schmid'], bank: 'FED', body: 'fed-bank', fedBank: 'Kansas City', role: 'President', institution: 'Federal Reserve Bank of Kansas City' },
  { name: 'Lorie Logan', patterns: ['logan'], bank: 'FED', body: 'fed-bank', fedBank: 'Dallas', role: 'President', institution: 'Federal Reserve Bank of Dallas' },
  { name: 'Mary Daly', patterns: ['daly'], bank: 'FED', body: 'fed-bank', fedBank: 'San Francisco', role: 'President', institution: 'Federal Reserve Bank of San Francisco' },

  // ── ECB Executive Board ──
  { name: 'Christine Lagarde', patterns: ['lagarde'], bank: 'ECB', body: 'ecb-board', role: 'President', institution: 'European Central Bank', since: '2019-11-01', termEnd: '2027-10-31',
    note: 'Has not ruled out leaving a few months before her term ends' },
  { name: 'Boris Vujčić', patterns: ['vujčić', 'vujcic'], bank: 'ECB', body: 'ecb-board', role: 'Vice-President', institution: 'European Central Bank', since: '2026-06-01', termEnd: '2034-05-31',
    note: 'Governor of the Croatian National Bank until May 2026' },
  { name: 'Philip Lane', patterns: ['lane'], bank: 'ECB', body: 'ecb-board', role: 'Chief Economist', institution: 'European Central Bank', since: '2019-06-01', termEnd: '2027-05-31' },
  { name: 'Isabel Schnabel', patterns: ['schnabel'], bank: 'ECB', body: 'ecb-board', role: 'Executive Board Member', institution: 'European Central Bank', since: '2020-01-01', termEnd: '2027-12-31',
    note: 'Leaving on 3 Jan 2027 for a senior IMF role (announced 24 Sep 2026)' },
  { name: 'Piero Cipollone', patterns: ['cipollone'], bank: 'ECB', body: 'ecb-board', role: 'Executive Board Member', institution: 'European Central Bank', since: '2023-11-01', termEnd: '2031-10-31' },
  { name: 'Frank Elderson', patterns: ['elderson'], bank: 'ECB', body: 'ecb-board', role: 'Executive Board Member', institution: 'European Central Bank', since: '2020-12-15', termEnd: '2026-12-14' },
  { name: 'Luis de Guindos', patterns: ['guindos'], bank: 'ECB', body: 'ecb-board', role: 'Vice-President', institution: 'European Central Bank', until: '2026-06-01' },

  // ── Euro-area national central bank governors (21 countries) ──
  { name: 'Martin Kocher', patterns: ['kocher'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Oesterreichische Nationalbank', since: '2025-09-01' },
  { name: 'Pierre Wunsch', patterns: ['wunsch'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'National Bank of Belgium' },
  { name: 'Dimitar Radev', patterns: ['radev'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Bulgarian National Bank', note: 'On the Governing Council since Bulgaria joined the euro (Jan 2026)' },
  { name: 'Ante Žigman', patterns: ['žigman', 'zigman'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Croatian National Bank', since: '2026-06' },
  { name: 'Christodoulos Patsalides', patterns: ['patsalides'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Central Bank of Cyprus', since: '2024-04-11' },
  { name: 'Ülo Kaasik', patterns: ['kaasik'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Eesti Pank', since: '2026-06-07' },
  { name: 'Olli Rehn', patterns: ['rehn'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Bank of Finland' },
  { name: 'Emmanuel Moulin', patterns: ['moulin'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banque de France', since: '2026-06-02' },
  { name: 'Joachim Nagel', patterns: ['nagel'], bank: 'ECB', body: 'ecb-ncb', role: 'President', institution: 'Deutsche Bundesbank' },
  { name: 'Yannis Stournaras', patterns: ['stournaras'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Bank of Greece', note: 'Third term from June 2026' },
  { name: 'Gabriel Makhlouf', patterns: ['makhlouf'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Central Bank of Ireland', note: 'Second term from Sep 2026' },
  { name: 'Fabio Panetta', patterns: ['panetta'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: "Banca d'Italia" },
  { name: 'Mārtiņš Kazāks', patterns: ['kazāks', 'kazaks'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Latvijas Banka' },
  { name: 'Gediminas Šimkus', patterns: ['šimkus', 'simkus'], bank: 'ECB', body: 'ecb-ncb', role: 'Chairman of the Board', institution: 'Bank of Lithuania', note: 'Second term from Apr 2026' },
  { name: 'Gaston Reinesch', patterns: ['reinesch'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banque centrale du Luxembourg' },
  { name: 'Alexander Demarco', patterns: ['demarco'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Central Bank of Malta', since: '2026-01-01' },
  { name: 'Olaf Sleijpen', patterns: ['sleijpen'], bank: 'ECB', body: 'ecb-ncb', role: 'President', institution: 'De Nederlandsche Bank', since: '2025-07-01' },
  { name: 'Álvaro Santos Pereira', patterns: ['santos pereira'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banco de Portugal', since: '2025-10-06' },
  { name: 'Peter Kažimír', patterns: ['kažimír', 'kazimir'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Národná banka Slovenska' },
  { name: 'Primož Dolenc', patterns: ['dolenc'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banka Slovenije', since: '2026-03-01' },
  { name: 'José Luis Escrivá', patterns: ['escrivá', 'escriva'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banco de España' },

  // former governors, kept for attributing their past communications
  { name: 'François Villeroy de Galhau', patterns: ['villeroy'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banque de France', until: '2026-06-02' },
  { name: 'Madis Müller', patterns: ['müller', 'muller'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Eesti Pank', until: '2026-06-07' },
  { name: 'Boštjan Vasle', patterns: ['vasle'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banka Slovenije', until: '2026-03-01' },
  { name: 'Klaas Knot', patterns: ['knot'], bank: 'ECB', body: 'ecb-ncb', role: 'President', institution: 'De Nederlandsche Bank', until: '2025-07-01' },
  { name: 'Mário Centeno', patterns: ['centeno'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Banco de Portugal', until: '2025-10-06' },
  { name: 'Robert Holzmann', patterns: ['holzmann'], bank: 'ECB', body: 'ecb-ncb', role: 'Governor', institution: 'Oesterreichische Nationalbank', until: '2025-09-01' },
];

/** The five largest euro-area economies share 4 votes (group 1); the other 16 governors share 11 (group 2). */
export const ECB_VOTING_GROUP_1 = ['Deutsche Bundesbank', 'Banque de France', "Banca d'Italia", 'Banco de España', 'De Nederlandsche Bank'];

export function isCurrent(m: RosterMember, date = new Date().toISOString().slice(0, 10)): boolean {
  return !m.until || date < m.until;
}

export const currentMembers = (bank?: 'FED' | 'ECB') =>
  COMMITTEE_ROSTER.filter(m => isCurrent(m) && (!bank || m.bank === bank));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match of the member's patterns in a title ("Lane" matches "Philip Lane:", not "plane"). */
export function mentions(m: RosterMember, title: string): boolean {
  const t = (title || '').toLowerCase();
  return m.patterns.some(p => new RegExp(`(^|[^\\p{L}])${esc(p)}($|[^\\p{L}])`, 'u').test(t));
}

/** The member a communication dated `date` belongs to: departed members only before they left. */
export function speakerOf(title: string, bank: string, date: string): RosterMember | null {
  return COMMITTEE_ROSTER.find(m => m.bank === bank && isCurrent(m, date) && mentions(m, title)) ?? null;
}

// ── FOMC voting rotation (mirrors fomcVoterBanks in supabase/functions/_shared/fed-speeches.ts) ──
// New York votes every year; the other eleven banks rotate in four groups, one voter per group per year.
const ROTATION: { anchor: number; banks: string[] }[] = [
  { anchor: 2025, banks: ['Boston', 'Philadelphia', 'Richmond'] },
  { anchor: 2026, banks: ['Cleveland', 'Chicago'] },
  { anchor: 2025, banks: ['St. Louis', 'Dallas', 'Atlanta'] },
  { anchor: 2025, banks: ['Kansas City', 'Minneapolis', 'San Francisco'] },
];

export function fomcVoterBanks(year: number): string[] {
  return ['New York', ...ROTATION.map(g => g.banks[((year - g.anchor) % g.banks.length + g.banks.length) % g.banks.length])];
}

/** Whether the member votes on the FOMC in `year`: Board members and New York always, others by rotation. */
export function isFomcVoter(m: RosterMember, year: number): boolean {
  if (m.bank !== 'FED') return false;
  if (m.body === 'fed-board') return true;
  return !!m.fedBank && fomcVoterBanks(year).includes(m.fedBank);
}
