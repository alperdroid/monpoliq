// ─────────────────────────────────────────────────────────────────────────────
// Verifying member remarks found by the AI search against a real, citable source.
//
// The AI search (fetchMediaInterviews) recalls remarks from the model's memory: it has no
// web access, so a remark, its summary and its "outlet_url" can be invented. A remark is
// only treated as real when an article or speech confirms it:
//   - the text is at least ARTICLE_MIN_WORDS long,
//   - it names the speaker at least twice,
//   - it contains at least half of the headline's distinctive words,
//   - it contains at least two policy-relevant sentences attributed to the speaker.
// The scored text is only the speaker's attributed sentences (sentences naming them, plus
// the quotes and "said" sentences that directly follow), not the journalist's framing or
// other officials' quotes. Speeches are not handled here: a member's BIS speech is already
// scored in full as its own "Member Speech (BIS)" item.
//
// Candidate articles come from GDELT (api.gdeltproject.org, a free news index with no key;
// its article search covers roughly the last three months).
// ─────────────────────────────────────────────────────────────────────────────
import { splitSentences, relevantSentences } from './frozen-scorer.ts';

export const REMARK_SOURCES = ['GC Member Remark', 'Fed Official Remark'];
export const ARTICLE_MIN_WORDS = 150;
export const GDELT_WINDOW_DAYS = 88;

const INSTITUTION = new Set(['ecb', 'fed', 'feds', 'federal', 'reserve', 'bank', 'bundesbank', 'central', 'governing', 'council',
  'banque', 'france', 'dnb', 'oenb', 'boe', 'imf', 'eu', 'euro', 'us', 'u.s', 'fomc', 'official', 'officials', 'member', 'members',
  'president', 'governor', 'chair', 'vice', 'reuters', 'bloomberg', 'interview', 'speech', 'public', 'remarks', 'the', 'a']);
const STOP = new Set(['about', 'after', 'again', 'also', 'amid', 'before', 'being', 'could', 'from', 'further', 'have', 'into',
  'more', 'most', 'must', 'need', 'needed', 'says', 'said', 'sees', 'should', 'than', 'that', 'their', 'there', 'these', 'this',
  'those', 'very', 'what', 'when', 'which', 'while', 'will', 'with', 'would', 'year', 'this', 'suggests', 'reiterates', 'warns',
  'hints', 'citing', 'remain', 'remains', 'avoid', 'potential', 'thereafter', 'much', 'many', 'some', 'only', 'still']);

const words = (s: string) => s.match(/[\p{L}\p{N}'’.-]+/gu) ?? [];
const bare = (w: string) => w.toLowerCase().replace(/['’]s$/, '').replace(/[.'’-]+$/g, '');
const isCap = (w: string) => /^\p{Lu}/u.test(w);

/** Speaker surname in a remark headline: "Knot: ...", "Bundesbank's Nagel: ...", "ECB's Rehn sees ...", "Bostic reiterates ...". */
export function remarkSurname(title: string): string | null {
  const t = (title || '').replace(/\([^)]*\)/g, ' ').trim();
  const colon = t.indexOf(':');
  if (colon > 1 && colon < 60) {
    const head = words(t.slice(0, colon)).filter(w => isCap(w) && !INSTITUTION.has(bare(w)) && !/['’]s$/.test(w));
    if (head.length) return head[0].replace(/[.'’]+$/, '');
  }
  for (const w of words(t).slice(0, 6)) {
    if (/['’]s$/.test(w)) continue;                            // "ECB's", "Bundesbank's": an institution, not the speaker
    if (isCap(w) && !INSTITUTION.has(bare(w))) return w.replace(/[.'’]+$/, '');
  }
  return null;
}

/** Distinctive words of the headline, used to check an article covers the same remark. */
export function headlineKeywords(title: string, surname: string): string[] {
  const t = (title || '').replace(/\([^)]*\)/g, ' ');
  const colon = t.indexOf(':');
  const body = colon > 1 && colon < 60 ? t.slice(colon + 1) : t;
  const sn = surname.toLowerCase();
  const out = new Set<string>();
  for (const w of words(body)) {
    const b = bare(w);
    if (b.length < 4 || b === sn || STOP.has(b) || INSTITUTION.has(b)) continue;
    out.add(b);
  }
  return [...out];
}

const nameRx = (surname: string) => new RegExp(`(?<![\\p{L}])${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu');

export function surnameHits(text: string, surname: string): number {
  return (text.match(nameRx(surname)) ?? []).length;
}

/** Sentences attributed to the speaker: those naming them, plus up to two directly following quote/"said" sentences. */
export function attributedSentences(text: string, surname: string): string[] {
  const rx = nameRx(surname);
  const out: string[] = [];
  let carry = 0;
  for (const s of splitSentences(text)) {
    rx.lastIndex = 0;
    if (rx.test(s)) { out.push(s); carry = 2; continue; }
    if (carry > 0 && (/["“”]/.test(s) || /\b(said|says|added|told|according to)\b/i.test(s) || /^(He|She|They)\b/.test(s))) {
      out.push(s); carry--; continue;
    }
    carry = 0;
  }
  return out;
}

export interface Verification {
  ok: boolean; reason: string; words: number; surname_hits: number; keyword_share: number;
  attributed: string[]; relevant: number;
}

export function verifyArticle(text: string, surname: string, headline: string): Verification {
  const nWords = (text || '').split(/\s+/).filter(Boolean).length;
  const hits = surnameHits(text || '', surname);
  const kw = headlineKeywords(headline, surname);
  const low = (text || '').toLowerCase();
  const share = kw.length ? kw.filter(k => low.includes(k)).length / kw.length : 0;
  const attributed = attributedSentences(text || '', surname);
  const relevant = relevantSentences(attributed).length;
  const base = { words: nWords, surname_hits: hits, keyword_share: Math.round(share * 100) / 100, attributed, relevant };
  if (nWords < ARTICLE_MIN_WORDS) return { ok: false, reason: `too short (${nWords} words)`, ...base };
  if (hits < 2) return { ok: false, reason: `names the speaker ${hits}x`, ...base };
  if (kw.length >= 2 ? share < 0.5 : hits < 3) return { ok: false, reason: `headline words matched ${Math.round(share * 100)}%`, ...base };
  if (relevant < 2) return { ok: false, reason: `${relevant} policy sentence(s) from the speaker`, ...base };
  return { ok: true, reason: 'verified', ...base };
}

// ── GDELT news search ────────────────────────────────────────────────────────
export interface Candidate { url: string; title: string; date: string | null; domain: string }

const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

export function gdeltUrl(surname: string, bank: string, date: string, days = 2): string {
  const d = new Date(date + 'T00:00:00Z');
  const from = new Date(d.getTime() - days * 86400000), to = new Date(d.getTime() + (days + 1) * 86400000);
  const inst = bank === 'ECB' ? '(ECB OR "central bank")' : '(Fed OR "Federal Reserve")';
  const q = `"${surname}" ${inst} sourcelang:english`;
  return 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
    query: q, mode: 'artlist', format: 'json', maxrecords: '25', sort: 'datedesc',
    startdatetime: stamp(from), enddatetime: stamp(to),
  }).toString();
}

export function parseGdelt(json: unknown): Candidate[] {
  const arts = (json as { articles?: unknown[] } | null)?.articles;
  if (!Array.isArray(arts)) return [];
  const out: Candidate[] = [];
  for (const a of arts as Record<string, unknown>[]) {
    const url = typeof a.url === 'string' ? a.url : '';
    if (!/^https?:\/\//.test(url)) continue;
    const sd = typeof a.seendate === 'string' ? a.seendate.match(/^(\d{4})(\d{2})(\d{2})/) : null;
    out.push({
      url, title: typeof a.title === 'string' ? a.title : '',
      date: sd ? `${sd[1]}-${sd[2]}-${sd[3]}` : null,
      domain: typeof a.domain === 'string' ? a.domain : (url.match(/^https?:\/\/([^/]+)/)?.[1] ?? ''),
    });
  }
  return out;
}

const PAYWALLED = /(^|\.)(bloomberg\.com|ft\.com|wsj\.com|barrons\.com|economist\.com|nytimes\.com|handelsblatt\.com|faz\.net|lesechos\.fr)$/i;

/** Articles naming the speaker in their title first, paywalled sites last, one per URL. */
export function rankCandidates(cands: Candidate[], surname: string): Candidate[] {
  const seen = new Set<string>();
  const rx = nameRx(surname);
  const score = (c: Candidate) => { rx.lastIndex = 0; return (rx.test(c.title) ? 2 : 0) + (PAYWALLED.test(c.domain) ? -3 : 0); };
  return cands.filter(c => !seen.has(c.url) && seen.add(c.url)).sort((a, b) => score(b) - score(a));
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86400000;
}
