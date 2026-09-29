// ─────────────────────────────────────────────────────────────────────────────
// Read-only probe of candidate sources for member speeches (BIS archive, regional Fed
// banks' own speech pages). Used once, from the admin page, to find out which sources
// are readable from the edge function before any import is built on them.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeTarget { name: string; bank: 'FED' | 'ECB'; url: string }

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** BIS archive candidates for a past window (90–180 days ago), so a working one shows older dates than the live feed. */
export function bisArchiveTargets(now = new Date()): ProbeTarget[] {
  const from = ddmmyyyy(new Date(now.getTime() - 180 * 86400000)), till = ddmmyyyy(new Date(now.getTime() - 90 * 86400000));
  const w = `from=${encodeURIComponent(from)}&till=${encodeURIComponent(till)}`;
  return [
    { name: 'BIS feed (live)', bank: 'ECB', url: 'https://www.bis.org/doclist/cbspeeches.rss' },
    { name: 'BIS feed, date window', bank: 'ECB', url: `https://www.bis.org/doclist/cbspeeches.rss?${w}` },
    { name: 'BIS feed, page 2', bank: 'ECB', url: 'https://www.bis.org/doclist/cbspeeches.rss?page=2' },
    { name: 'BIS list fragment, date window', bank: 'ECB',
      url: `https://www.bis.org/doclist/cbspeeches.htm?${w}&page=1&paging_length=25&sort_list=date_desc` },
    { name: 'BIS speeches page, date window', bank: 'ECB', url: `https://www.bis.org/cbspeeches/index.htm?${w}` },
  ];
}

// Public speeches pages of the twelve regional Federal Reserve Banks (best known addresses;
// the probe reports which ones load and which RSS feeds they advertise).
export const REGIONAL_FED_TARGETS: ProbeTarget[] = [
  { name: 'Boston Fed', bank: 'FED', url: 'https://www.bostonfed.org/news-and-events/speeches.aspx' },
  { name: 'New York Fed', bank: 'FED', url: 'https://www.newyorkfed.org/newsevents/speeches' },
  { name: 'Philadelphia Fed', bank: 'FED', url: 'https://www.philadelphiafed.org/the-president' },
  { name: 'Cleveland Fed', bank: 'FED', url: 'https://www.clevelandfed.org/collections/speeches' },
  { name: 'Richmond Fed', bank: 'FED', url: 'https://www.richmondfed.org/press_room/speeches' },
  { name: 'Atlanta Fed', bank: 'FED', url: 'https://www.atlantafed.org/news/speeches' },
  { name: 'Chicago Fed', bank: 'FED', url: 'https://www.chicagofed.org/publications/speeches' },
  { name: 'St. Louis Fed', bank: 'FED', url: 'https://www.stlouisfed.org/from-the-president/remarks' },
  { name: 'Minneapolis Fed', bank: 'FED', url: 'https://www.minneapolisfed.org/speeches' },
  { name: 'Kansas City Fed', bank: 'FED', url: 'https://www.kansascityfed.org/speeches/' },
  { name: 'Dallas Fed', bank: 'FED', url: 'https://www.dallasfed.org/news/speeches' },
  { name: 'San Francisco Fed', bank: 'FED', url: 'https://www.frbsf.org/news-and-media/speeches/' },
];

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

function absolute(href: string, base: string): string | null {
  try { return new URL(decode(href.trim()), base).toString().replace(/#.*$/, ''); } catch { return null; }
}

/** RSS/Atom feeds a page advertises in its <head>. */
export function feedLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const u = href && absolute(href, base);
    if (u) out.add(u);
  }
  return [...out];
}

/** Links on the same site that look like individual speeches (path mentions speech/remarks, and is not the listing itself). */
export function speechLinks(html: string, base: string): string[] {
  const host = new URL(base).host.replace(/^www\./, '');
  const self = base.replace(/\/+$/, '');
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const u = absolute(m[1], base);
    if (!u || !/^https?:/.test(u)) continue;
    const p = new URL(u);
    if (p.host.replace(/^www\./, '') !== host) continue;
    if (!/speech|remarks|\/speeches\//i.test(p.pathname)) continue;
    if (u.replace(/\/+$/, '') === self || /[?&](page|from|till)=/i.test(p.search)) continue;
    if (p.pathname.split('/').filter(Boolean).length < 2) continue;
    out.add(u);
  }
  return [...out];
}

/** Dates found in link paths (e.g. /speeches/20260924-..., /2026/09/..., /sp260924). */
export function linkDate(url: string): string | null {
  let m = url.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  m = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = url.match(/(?<![\d])(\d{2})(\d{2})(\d{2})(?![\d])/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && +m[1] >= 10 && +m[1] <= 40) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function dateRange(dates: (string | null)[]): { min: string | null; max: string | null; dated: number } {
  const d = dates.filter((x): x is string => !!x).sort();
  return { min: d[0] ?? null, max: d[d.length - 1] ?? null, dated: d.length };
}
