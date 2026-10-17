// ─────────────────────────────────────────────────────────────────────────────
// Archive readers for the history backfill (2015 onwards). Pure parsing only; the
// sentiment-analysis admin mode "backfill-history" fetches the pages and scores what
// these return with the frozen scorer, exactly like live items.
//
//   Fed Board speeches     federalreserve.gov/newsevents/speech/{year}-speeches.htm
//                          (each link names the speaker and date: yellen20151202a.htm)
//   ECB index pages        ecb.europa.eu/…/{year}/html/index_include.en.html: monetary policy
//                          statements (is…), accounts (mg…), decisions (mp… / pr… "Monetary
//                          policy decisions"), Executive Board speeches (sp…) and interviews (in…)
//   BIS member speeches    bis.org/review/r{yymmdd}{a,b,c…}.htm: one page per speech, numbered
//                          by publication day; the page states the speaker's role and date
// ─────────────────────────────────────────────────────────────────────────────

import { deliveredDate, type BisItem } from './member-sources.ts';

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&#8217;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—').replace(/\s+/g, ' ').trim();
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ' '));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Fed Board speeches ──

export interface FedSpeechLink { url: string; date: string; surname: string; title: string }

/** Board members' speeches on a yearly index page, in date order. */
export function parseFedSpeechIndex(html: string, year: number): FedSpeechLink[] {
  const out = new Map<string, FedSpeechLink>();
  const re = /<a\b[^>]*href="((?:https:\/\/www\.federalreserve\.gov)?\/newsevents\/speech\/([a-z]+)(\d{4})(\d{2})(\d{2})[a-z]\.htm)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    if (+m[3] !== year) continue;
    const title = stripTags(m[6]);
    if (!title || out.has(m[1])) continue;
    const url = m[1].startsWith('http') ? m[1] : 'https://www.federalreserve.gov' + m[1];
    out.set(m[1], { url, date: `${m[3]}-${m[4]}-${m[5]}`, surname: cap(m[2].toLowerCase()), title });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Title in the live 'Fed Speech' form ("Yellen, The Economic Outlook"). */
export const fedSpeechTitle = (s: FedSpeechLink) => `${s.surname}, ${s.title}`;

// ── ECB index pages ──

export interface EcbLink {
  url: string;
  /** Document type from the file name: is (statement), mg (account), mp/pr (press release), sp (speech), in (interview). */
  kind: string;
  date: string;
  /** Link text. */
  text: string;
  /** Text that follows the link up to the next entry (subtitle: "Speech by …, at …"). */
  context: string;
}

const ECB_FILE = /(?:^|\/)(?:ecb\.)?([a-z]{2})(\d{2})(\d{2})(\d{2})(?:_\d+)?(?:~[0-9a-f]+)?\.en\.html$/i;

/** Links to English documents on an ECB yearly index_include page, de-duplicated, in date order. */
export function parseEcbIndex(html: string): EcbLink[] {
  const out = new Map<string, EcbLink>();
  // Only links to documents delimit entries: author links inside an entry stay in its context.
  const docs = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].filter(m => ECB_FILE.test(decode(m[1])));
  docs.forEach((m, i) => {
    const href = decode(m[1]);
    const f = href.match(ECB_FILE)!;
    const url = href.startsWith('http') ? href : 'https://www.ecb.europa.eu' + (href.startsWith('/') ? '' : '/') + href;
    if (out.has(url)) return;
    const start = (m.index ?? 0) + m[0].length;
    const end = docs[i + 1]?.index ?? html.length;
    const tail = html.slice(start, Math.min(end, start + 1500));
    out.set(url, {
      url, kind: f[1].toLowerCase(), date: `20${f[2]}-${f[3]}-${f[4]}`,
      text: stripTags(m[2]), context: stripTags(tail.split(/<dt\b/i)[0]),
    });
  });
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const isEcbDecision = (l: EcbLink) => l.kind === 'mp' || (l.kind === 'pr' && /monetary policy decisions?/i.test(l.text));

/** Surname with its particle ("Luis de Guindos" → "de Guindos", "Philip R. Lane" → "Lane"). */
export function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.length - 1;
  if (last >= 1 && /^(de|van|von|del|da|di|le|la)$/i.test(parts[last - 1])) return `${parts[last - 1].toLowerCase()} ${parts[last]}`;
  return parts[last];
}

// Executive Board members since 2015, for index entries that name the speaker only as an author link.
const ECB_BOARD = ['Mario Draghi', 'Christine Lagarde', 'Vítor Constâncio', 'Luis de Guindos', 'Peter Praet', 'Philip R. Lane',
  'Benoît Cœuré', 'Yves Mersch', 'Sabine Lautenschläger', 'Isabel Schnabel', 'Fabio Panetta', 'Frank Elderson', 'Piero Cipollone',
  'Boris Vujčić'];
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').toLowerCase();

/**
 * Speaker of an ECB speech/interview when the speaker sits on the Executive Board (President,
 * Vice-President, members, Chief Economist): from the subtitle ("Speech by X, Member of the Executive
 * Board of the ECB, …"), else from a Board member's name in the entry. Supervisory Board officials
 * who are not on the Executive Board do not set rates and return null.
 */
export function ecbBoardSpeaker(context: string): { name: string; surname: string } | null {
  const viaRole = roleSpeaker(context);
  if (viaRole !== undefined) return viaRole;
  const c = fold(context);
  const hit = ECB_BOARD.find(n => c.includes(fold(surnameOf(n))) && c.includes(fold(n.split(' ')[0])));
  return hit ? { name: hit, surname: surnameOf(hit) } : null;
}

/** The "by/with NAME, ROLE" sentence: a Board speaker, null for anyone else, undefined when there is none. */
function roleSpeaker(context: string): { name: string; surname: string } | null | undefined {
  const m = context.match(/\b(?:by|with)\s+((?:\p{Lu}[\p{L}'’.-]*\s+){0,4}?\p{Lu}[\p{L}'’.-]+(?:\s+(?:de|van|von|del)\s+\p{Lu}[\p{L}'’-]+)?),\s+([^,]{0,140})/u);
  if (!m) return undefined;
  const role = m[2];
  const board = /Executive Board|Chief Economist/i.test(role) || /^(President|Vice-President)\b[^,]*\b(ECB|European Central Bank)\b/i.test(role);
  if (!board) return null;
  return { name: m[1].trim(), surname: surnameOf(m[1]) };
}

/** Title in the "Surname: title" form that the speaker calibration and the speaker cap read. */
export const ecbSpeechTitle = (surname: string, title: string) => `${surname}: ${title}`;

// ── BIS central bankers' speeches ──

const yymmdd = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

/** Review page addresses for one publication day: r{yymmdd}a.htm, r{yymmdd}b.htm, … */
export function bisReviewUrl(day: string, n: number): string {
  return `https://www.bis.org/review/r${yymmdd(day)}${String.fromCharCode(97 + n)}.htm`;
}

const ROLE_LINE = /\b((?:Speech|Remarks|Keynote|Opening|Introductory|Welcome|Closing|Concluding|Lecture|Statement|Testimony|Address|Presentation|Dinner|Lunch|Contribution|Article|Interview|Panel|Comments|Prepared)[^.]{0,80}?\b(?:by|with)\s+(?:(?:Mr|Ms|Mrs|Dr|Prof)\.?\s+)?([^,]{3,60}),[^]{0,600}?\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/;

/**
 * A BIS review page as the same item the BIS feed gives (title, speaker, role sentence, dates),
 * so the live member filters (classifyMember, the FOMC voter rotation) apply unchanged.
 */
export function parseBisReviewPage(html: string, url: string, published: string): BisItem | null {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  const text = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const role = text.match(ROLE_LINE);
  if (!role) return null;
  const description = role[1];
  const speaker = role[2].replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/i, '').trim();
  // The page heading may read "Speaker: title"; the item keeps the title alone, as in the BIS feed.
  let title = stripTags(h1 || titleTag || '').replace(/\s*[|–-]\s*BIS\s*$/i, '');
  const colon = title.indexOf(': ');
  if (colon > 0 && colon < 70 && fold(title.slice(0, colon)).includes(fold(surnameOf(speaker)))) title = title.slice(colon + 2);
  if (!title) return null;
  const pdf = html.match(/href="([^"]*\/review\/r\d{6}[a-z]\.pdf)"/i)?.[1];
  return {
    title, speaker, description, url,
    pdf: pdf ? (pdf.startsWith('http') ? pdf : 'https://www.bis.org' + pdf) : null,
    published, delivered: deliveredDate(description),
  };
}

/** True when a dated feed reply really covers the requested window (the feed may ignore the dates). */
export function coversWindow(dates: string[], from: string, till: string): boolean {
  if (!dates.length) return false;
  const inside = dates.filter(d => d >= from && d <= till).length;
  return inside / dates.length >= 0.8;
}
