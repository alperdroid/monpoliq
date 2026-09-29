// ─────────────────────────────────────────────────────────────────────────────
// Regional Federal Reserve Bank presidents' speeches, read from the banks' own websites.
//
// The BIS feed carries almost no regional Fed presidents, so these come from the source.
// Only sites that serve their speech list as plain HTML or RSS are included (a probe from the
// edge function in September 2026 showed Cleveland, Atlanta, St. Louis and Minneapolis render
// their lists in the browser, and the Philadelphia and Chicago addresses tried were wrong).
//
// A page is kept only if its text names the speaker as the bank's President (e.g. "Lorie K. Logan,
// President and CEO"), so first vice presidents, research staff and guests are skipped. The whole
// speech text is scored, with its URL, like every other communication.
// ─────────────────────────────────────────────────────────────────────────────

export interface FedSpeechSource {
  bank: string;                 // e.g. 'Federal Reserve Bank of New York'
  kind: 'feed' | 'listing';
  url: string;
  link?: RegExp;                // for a listing: which links are individual speeches
}

export const FED_SPEECH_SOURCES: FedSpeechSource[] = [
  { bank: 'Federal Reserve Bank of New York', kind: 'listing', url: 'https://www.newyorkfed.org/newsevents/speeches',
    link: /\/newsevents\/speeches\/\d{4}\/[a-z]{2,5}\d{6}$/ },
  { bank: 'Federal Reserve Bank of Boston', kind: 'feed', url: 'https://www.bostonfed.org/feeds/rss_speeches.xml' },
  { bank: 'Federal Reserve Bank of Richmond', kind: 'feed', url: 'https://www.richmondfed.org/press_room/speeches?cc_view=rss' },
  { bank: 'Federal Reserve Bank of Kansas City', kind: 'listing', url: 'https://www.kansascityfed.org/speeches/',
    link: /\/speeches\/(?!speakers-bureau)[a-z0-9-]{8,}\/?$/ },
  // Per-president pages: if the president changes, the dry run shows no President byline; update the path.
  { bank: 'Federal Reserve Bank of Dallas', kind: 'listing', url: 'https://www.dallasfed.org/news/speeches/logan',
    link: /\/news\/speeches\/logan\/.+/ },
  { bank: 'Federal Reserve Bank of San Francisco', kind: 'listing', url: 'https://www.frbsf.org/news-and-media/speeches/mary-c-daly/',
    link: /\/news-and-media\/speeches\/mary-c-daly\/.+/ },
];

export const FED_SITE_SOURCE = 'Member Speech (Fed site)';

// ── FOMC voting rotation ──
// New York votes every year. The other eleven banks rotate in four fixed groups, one voter per
// group per year (Federal Reserve Act §12A). Anchored on 2026: Philadelphia, Cleveland, Dallas,
// Minneapolis. Only speeches given in a year the speaker's bank votes are imported.
const ROTATION: { anchor: number; banks: string[] }[] = [
  { anchor: 2025, banks: ['Boston', 'Philadelphia', 'Richmond'] },
  { anchor: 2026, banks: ['Cleveland', 'Chicago'] },
  { anchor: 2025, banks: ['St. Louis', 'Dallas', 'Atlanta'] },
  { anchor: 2025, banks: ['Kansas City', 'Minneapolis', 'San Francisco'] },
];

/** Regional banks whose president votes on the FOMC in `year` (e.g. 2026 → New York, Philadelphia, Cleveland, Dallas, Minneapolis). */
export function fomcVoterBanks(year: number): string[] {
  return ['New York', ...ROTATION.map(g => g.banks[((year - g.anchor) % g.banks.length + g.banks.length) % g.banks.length])];
}

/** Whether "Federal Reserve Bank of X" (or just "X") had an FOMC vote in the year of `date` (YYYY-MM-DD). */
export function isFomcVoter(bank: string, date: string): boolean {
  const name = bank.replace(/^Federal Reserve Bank of\s+/i, '').trim().toLowerCase();
  return fomcVoterBanks(+date.slice(0, 4)).some(b => b.toLowerCase() === name);
}

export interface Candidate { url: string; title: string; date: string | null }

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '');
const iso = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };

/** Items of an RSS 2.0 / RSS 1.0 / Atom feed. */
export function feedItems(xml: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const x = m[2];
    const link = tag(x, 'link') || x.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || tag(x, 'guid');
    if (!/^https?:\/\//.test(link)) continue;
    out.push({ url: link.trim(), title: tag(x, 'title'), date: iso(tag(x, 'pubDate') || tag(x, 'dc:date') || tag(x, 'published') || tag(x, 'updated')) });
  }
  return out;
}

/** Speech links on a listing page, in page order, one per URL. */
export function listingLinks(html: string, base: string, link: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u: string;
    try { u = new URL(decode(m[1]), base).toString(); } catch { continue; }
    if (link.test(new URL(u).pathname) && !out.includes(u)) out.push(u);
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** First full date near the top of the speech ("September 24, 2026" or "24 September 2026"). */
export function pageDate(text: string): string | null {
  const head = text.slice(0, 3000);
  const m = head.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i)
    ?? head.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return null;
  const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  return `${m[3]}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// "Lorie K. Logan, President and CEO", "John C. Williams, President and Chief Executive Officer",
// "Thomas I. Barkin, President of the Federal Reserve Bank of Richmond". Not "First Vice President".
const NAME = String.raw`(\p{Lu}[\p{L}'’-]+(?:\s+(?:\p{Lu}\.|\p{Lu}[\p{L}'’-]+)){1,3})`;
const BYLINE = new RegExp(NAME + String.raw`,?\s+(?:the\s+)?President\s+(?:and\s+(?:Chief Executive Officer|CEO)|&\s*CEO|of\s+the\s+Federal\s+Reserve\s+Bank)`, 'u');
const NOT_NAME = /\b(Vice|First|Executive|Senior|Chief|Federal|Reserve|Bank)\b/;
const HEADING = /^(Remarks|Speech|Speeches|Opening|Closing|Keynote|Welcome|Introductory|Address|Statement|Presentation|Home|By|Dinner|Luncheon|Panel|Fireside|Chat|Transcript|Video|Audio)$/i;

/** The speaker, if the text names them as the bank's President near the top; otherwise null. */
export function presidentByline(text: string): string | null {
  const m = text.slice(0, 4000).match(BYLINE);
  if (!m) return null;
  const tokens = m[1].split(/\s+/);
  while (tokens.length > 2 && HEADING.test(tokens[0])) tokens.shift();     // "Remarks Lorie K. Logan" → "Lorie K. Logan"
  const name = tokens.join(' ');
  return NOT_NAME.test(name) ? null : name;
}

/** Page title without the site name: og:title, then <h1>, then <title>. */
export function pageTitle(html: string): string {
  const og = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1];
  const raw = og ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ') ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decode(raw).split(/\s+[|–—-]\s+(?=[^|–—-]*(Federal Reserve|Fed\b|Bank))/)[0].trim();
}

/** Title in the "Speaker: title" form speaker calibration understands, without repeating the name. */
export function speechTitle(speaker: string, title: string): string {
  const t = title.replace(new RegExp(`^${speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,–—-]\\s*`, 'i'), '').trim();
  return `${speaker}: ${t || 'Speech'}`;
}
