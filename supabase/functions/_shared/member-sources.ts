// ─────────────────────────────────────────────────────────────────────────────
// Member communications from a real, citable source (replaces the Gemini
// "media interview search", which asked the model to recall remarks from memory
// and stored its own summary as the text, with no URL).
//
// Source: BIS central bankers' speeches feed, https://www.bis.org/doclist/cbspeeches.rss
// (English texts; each item's description states the speaker's role and
// institution, e.g. "Speech by Dr Joachim Nagel, President of the Deutsche
// Bundesbank, at ..., Berlin, 9 September 2026.").
//
// Assignment is by the role text, not by a list of names, so it stays correct
// when people change. Only speakers NOT already covered by monpoliq's primary
// scrapers are taken, to avoid double counting:
//   ECB  → governors / presidents of euro-area national central banks
//          (ECB Executive Board is already scraped from ecb.europa.eu)
//   FED  → presidents of the regional Federal Reserve Banks
//          (Board of Governors is already scraped from federalreserve.gov)
// Deputies are excluded: they do not vote on the ECB Governing Council.
// ─────────────────────────────────────────────────────────────────────────────

export const BIS_FEED = 'https://www.bis.org/doclist/cbspeeches.rss';

export type MemberGroup = 'ncb_governor' | 'reserve_bank_president';

export interface BisItem {
  title: string;
  speaker: string;
  description: string;
  url: string;
  pdf: string | null;
  published: string;            // YYYY-MM-DD (BIS publication date)
  delivered: string | null;     // YYYY-MM-DD parsed from the description
}

export interface MemberSpeech extends BisItem {
  bank: 'FED' | 'ECB';
  group: MemberGroup;
  institution: string;
}

// Euro-area national central banks (members of the ECB Governing Council via their governor).
// Bulgaria joined the euro area on 1 January 2026.
const EURO_NCBS = [
  'Deutsche Bundesbank', 'Bank of France', 'Banque de France', 'Bank of Italy', 'Banca d.Italia', 'Bank of Spain',
  'Banco de España', 'De Nederlandsche Bank', 'Netherlands Bank', 'National Bank of Belgium', 'Oesterreichische Nationalbank',
  'Central Bank of Austria', 'Austrian National Bank', 'Bank of Finland', 'Central Bank of Ireland', 'Bank of Portugal',
  'Banco de Portugal', 'Bank of Greece', 'Central Bank of Cyprus', 'Central Bank of Malta', 'Bank of Slovenia',
  'National Bank of Slovakia', 'Eesti Pank', 'Bank of Estonia', 'Latvijas Banka', 'Bank of Latvia', 'Bank of Lithuania',
  'Central Bank of Luxembourg', 'Banque centrale du Luxembourg', 'Croatian National Bank', 'Bulgarian National Bank',
];
const ncbAlt = EURO_NCBS.map(n => n.replace(/\s+/g, '\\s+')).join('|');
// "Governor of the Bank of Italy", "President of the Deutsche Bundesbank" — but not "Deputy Governor", "Vice-President"
const NCB_ROLE = new RegExp(`(?<!Deputy\\s)(?<!Vice-)(?<!Vice\\s)\\b(Governor|President)\\b(?:\\s+and\\s+[A-Z][\\w ]{0,40}?)?\\s+of\\s+(?:the\\s+)?(${ncbAlt})`, 'i');
const FRB_ROLE = /(?<!First Vice\s)(?<!Vice\s)\bPresident\b[^,]{0,60}?\bof the Federal Reserve Bank of ([A-Z][A-Za-z. ]+)/;

const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : '';
}
function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** Last "d Month yyyy" in the description is the delivery date. */
export function deliveredDate(description: string): string | null {
  const all = [...description.matchAll(/\b(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi)];
  const m = all[all.length - 1];
  return m ? `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}` : null;
}

export function parseBisRss(xml: string): BisItem[] {
  const items: BisItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const url = tag(x, 'link');
    const description = tag(x, 'description');
    const pdfM = x.match(/<cb:link>([^<]+\.pdf)<\/cb:link>/);
    if (!url) continue;
    items.push({
      title: tag(x, 'title'),
      speaker: tag(x, 'dc:creator').replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/i, ''),
      description,
      url,
      pdf: pdfM ? pdfM[1] : null,
      published: tag(x, 'dc:date').slice(0, 10),
      delivered: deliveredDate(description),
    });
  }
  return items;
}

export function classifyMember(it: BisItem): MemberSpeech | null {
  const d = it.description;
  if (/Supervisory Board of the European Central Bank/i.test(d)) return null;    // supervision, not monetary policy
  if (/of the European Central Bank/i.test(d)) return null;                      // Executive Board: primary scraper
  if (/Board of Governors of the Federal Reserve System/i.test(d)) return null;  // Board: primary scraper
  const n = d.match(NCB_ROLE);
  if (n) return { ...it, bank: 'ECB', group: 'ncb_governor', institution: n[2].replace(/\s+/g, ' ') };
  const f = d.match(FRB_ROLE);
  if (f) return { ...it, bank: 'FED', group: 'reserve_bank_president', institution: `Federal Reserve Bank of ${f[1].trim()}` };
  return null;
}

/** Title in the "Speaker: title" form that speaker-calibration.extractSpeaker() understands. */
export function monpoliqTitle(s: MemberSpeech): string {
  return `${s.speaker}: ${s.title}`;
}
