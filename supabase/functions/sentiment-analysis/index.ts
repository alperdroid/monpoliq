// ── Sentiment Analysis v4.0 — AI-Powered + Press Conferences + Dedup ──
// Communication items scored by Gemini AI for contextual understanding.
// Statistical items use numeric formula scoring.
// Consumer Expectations Surveys → reclassified as statistical.
// Fed Funds excluded (it's the target variable, not a predictor).
// Duplicate inflation prints within same month → counted once.
// FOMC & ECB press conference transcripts now scraped and analyzed.
// Aggregation: dynamic time-decay × contextual document tier × surprise-weighted stats.

import { weightedAggregate, blendedAggregate, documentTier } from '../_shared/scoring-weights.ts';
import { applyConsensusSurprise } from '../_shared/consensus-surprise.ts';
import { partitionForScoring } from '../_shared/relevance-filter.ts';
import { applySpeakerCalibration } from '../_shared/speaker-calibration.ts';



const CH = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface It {
  bank:string; source:string; item_date:string; title:string; url:string;
  is_statistical:boolean; hawk_pts:number; dove_pts:number; net_score:number;
  label:string; word_count:number; reasons:string[];
  stat_metric:string|null; stat_value:number|null; stat_weight:number;
  policy_dimensions?:Record<string, unknown>|null;
}

// ── Cross-language / variant-title dedup helpers ──
function htmlDecode(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
function canonicalUrl(url: string): string {
  if (!url) return '';
  let u = url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  u = u.replace(/^www\./, '');
  // Collapse duplicate slashes (e.g. ecb.europa.eu//press → ecb.europa.eu/press)
  u = u.replace(/([^:])\/{2,}/g, '$1/');
  // Strip query/fragment
  u = u.split('?')[0].split('#')[0];
  // Language path segments → __lang__
  u = u.replace(/\/(en|de|fr|es|it|nl|pt)\//g, '/__lang__/');
  // Bundesbank German↔English path equivalents
  u = u
    .replace(/\/presse\/reden\//g, '/press/speeches/')
    .replace(/\/presse\/interviews\//g, '/press/interviews/')
    .replace(/\/presse\/gastbeitraege\//g, '/press/contributions/')
    .replace(/\/presse\//g, '/press/');
  // Bundesbank trailing numeric IDs differ between DE/EN — strip them
  u = u.replace(/-\d{4,}$/, '');
  u = u.replace(/\.(en|de|fr|es|it|nl|pt)\.(html?|pdf)$/i, '.$2');
  return u;
}
function normalizedTitle(t: string): string {
  return htmlDecode(t).toLowerCase()
    .replace(/\(with q&a\)/g, '')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/—.*$/, '')        // drop em-dash subtitle (e.g. "— 06/11/2026")
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '') // strip embedded dates
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupKey(it: { bank: string; source: string; item_date: string; title: string; url: string }): string {
  const urlKey = canonicalUrl(it.url);
  // KEY EXCLUDES source — same content may be tagged with different feed labels (e.g. "ECB Press" vs "ECB Press Conf")
  if (urlKey) return `${it.bank}|${it.item_date}|U:${urlKey}`;
  return `${it.bank}|${it.item_date}|T:${normalizedTitle(it.title)}`;
}
function preferItem(a: It, b: It): It {
  const aEn = /\/en\//.test(a.url || '') || /\.en\.(html?|pdf)/i.test(a.url || '');
  const bEn = /\/en\//.test(b.url || '') || /\.en\.(html?|pdf)/i.test(b.url || '');
  if (aEn !== bEn) return aEn ? a : b;
  const aQA = /q&amp;a|q&a|q & a/i.test(a.title);
  const bQA = /q&amp;a|q&a|q & a/i.test(b.title);
  if (aQA !== bQA) return aQA ? a : b;
  // Prefer "Press" over "Press Conf" wrapper sources (cleaner canonical label)
  const aConf = /press\s+conf/i.test(a.source || '');
  const bConf = /press\s+conf/i.test(b.source || '');
  if (aConf !== bConf) return aConf ? b : a;
  return (b.word_count || 0) > (a.word_count || 0) ? b : a;
}
function dedupItems(items: It[]): It[] {
  const map = new Map<string, It>();
  for (const it of items) {
    const k = dedupKey(it);
    const prev = map.get(k);
    if (!prev) map.set(k, it);
    else map.set(k, preferItem(prev, it));
  }
  return Array.from(map.values());
}

// ── AI cross-language dedup (groups DE/EN twin speeches with different URLs/titles) ──
async function aiCrossLangDedup(items: It[], apiKey: string): Promise<It[]> {
  if (!apiKey || items.length < 2) return items;
  const byDay = new Map<string, It[]>();
  for (const it of items) {
    const k = `${it.bank}|${it.item_date}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(it);
  }
  const removed = new Set<string>();
  for (const [k, grp] of byDay) {
    if (grp.length < 2) continue;
    const hasDe = grp.some(g => /\/de\//.test(g.url) || /\.de\./.test(g.url));
    const hasEn = grp.some(g => /\/en\//.test(g.url) || /\.en\./.test(g.url));
    const hasMixedLabels = grp.some(g => /press\s+conf/i.test(g.source)) && grp.some(g => !/press\s+conf/i.test(g.source));
    if (!hasDe && !hasEn && !hasMixedLabels) continue;
    const numbered = grp.map((g, i) => `${i}: [${g.source}] ${htmlDecode(g.title)}`).join('\n');
    try {
      const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [{
            role: 'user',
            content: `These are central-bank publications from the same day. Identify groups where multiple entries are the SAME underlying speech/press-release/event (e.g. German and English versions, or duplicate feed labels). Reply ONLY with a JSON array of arrays of indices, e.g. [[0,3],[2,5]]. Omit singletons. Translated titles count as the same item.\n\n${numbered}`
          }],
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const groups: number[][] = JSON.parse(match[0]);
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!Array.isArray(g) || g.length < 2) continue;
        let best = grp[g[0]];
        for (const idx of g.slice(1)) {
          if (!grp[idx]) continue;
          best = preferItem(best, grp[idx]);
        }
        for (const idx of g) {
          if (grp[idx] && grp[idx] !== best) {
            removed.add(`${grp[idx].bank}|${grp[idx].item_date}|${grp[idx].url}|${grp[idx].title}`);
          }
        }
      }
    } catch (e) {
      console.log(`aiCrossLangDedup error for ${k}:`, e instanceof Error ? e.message : e);
    }
  }
  if (!removed.size) return items;
  console.log(`AI cross-lang dedup removed ${removed.size} items`);
  return items.filter(it => !removed.has(`${it.bank}|${it.item_date}|${it.url}|${it.title}`));
}

// ── Statistical value scoring (continuous, [-1,1] scale) ──
// Scores are normalized to [-1, 1] to match AI communication scores.
// Weight is stored separately for aggregation weighting, NOT multiplied into the score.
function sv(v:number, ht:number, dt:number, dir:string, w:number, met:string) {
  const mid = (ht + dt) / 2;
  const spread = Math.max(Math.abs(ht - dt), 1);
  let raw: number;
  if (dir === 'lh') {
    // Lower = hawkish (e.g. unemployment: low unemployment is hawkish)
    raw = (mid - v) / spread;
  } else {
    // Higher = hawkish (e.g. inflation: high inflation is hawkish)
    raw = (v - mid) / spread;
  }
  // Diminishing returns beyond ±1 spread, hard clamp at [-1, 1]
  if (Math.abs(raw) > 1) {
    raw = Math.sign(raw) * (1 - 0.05 / Math.abs(raw)); // asymptote toward ±1
  }
  raw = Math.max(-1, Math.min(1, raw));
  const lb = raw > 0.05 ? 'hawkish' : raw < -0.05 ? 'dovish' : 'neutral';
  return { net_score: Math.round(raw * 1000) / 1000, label: lb, metric: met, value: Math.round(v * 100) / 100 };
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
async function sf(url: string, ms = 15000): Promise<Response | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
    clearTimeout(t);
    return r;
  } catch { return null; }
}

// ── Extract readable text from HTML ──
function extractText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');
  const contentMarkers = [
    { pattern: /<div[^>]*id="article"[^>]*>/i, tag: 'div' },
    { pattern: /<div[^>]*id="content"[^>]*>/i, tag: 'div' },
    { pattern: /<article[^>]*>/i, tag: 'article' },
    { pattern: /<main[^>]*>/i, tag: 'main' },
  ];
  for (const marker of contentMarkers) {
    const startMatch = t.match(marker.pattern);
    if (!startMatch || startMatch.index === undefined) continue;
    const startIdx = startMatch.index + startMatch[0].length;
    const openRe = new RegExp(`<${marker.tag}[\\s>]`, 'gi');
    const closeRe = new RegExp(`</${marker.tag}>`, 'gi');
    let depth = 1;
    const sub = t.slice(startIdx);
    const allTags: { idx: number; isOpen: boolean }[] = [];
    let m2;
    openRe.lastIndex = 0; closeRe.lastIndex = 0;
    while ((m2 = openRe.exec(sub)) !== null) allTags.push({ idx: m2.index, isOpen: true });
    while ((m2 = closeRe.exec(sub)) !== null) allTags.push({ idx: m2.index, isOpen: false });
    allTags.sort((a, b) => a.idx - b.idx);
    for (const tag of allTags) {
      if (tag.isOpen) depth++;
      else { depth--; if (depth === 0) { const content = sub.slice(0, tag.idx); if (content.length > 200) { t = content; break; } } }
    }
    if (depth === 0 || t.length < html.length / 2) break;
  }
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ── PDF text extraction ─────────────────────────────────────────────────────
// FOMC transcripts are PDFs whose page content lives in Flate-compressed
// streams. Reading only the uncompressed `(...)` literals returns font tables
// and fragments — never the transcript — so the streams must be inflated first
// and the text pulled out of the Tj/TJ show-text operators.
async function inflate(bytes: Uint8Array): Promise<string | null> {
  // PDF stream bodies carry trailing EOL bytes, and DecompressionStream errors
  // on any trailing data — so trim the EOL and keep whatever inflated before an
  // error rather than discarding the whole stream.
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 10 || bytes[end - 1] === 13)) end--;
  const data = bytes.subarray(0, end);
  if (!data.length) return null;
  for (const fmt of ['deflate', 'deflate-raw'] as const) {
    const ds = new DecompressionStream(fmt);
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const chunks: Uint8Array[] = [];
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
      } catch { /* keep what we already read */ }
    })();
    try {
      await writer.write(data);
      await writer.close();
    } catch { /* trailing garbage / wrong format */ }
    await pump;
    if (chunks.length) {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return new TextDecoder('latin1').decode(out);
    }
  }
  return null;
}


function showTextOf(content: string): string {
  let text = '';
  const re = /\((?:\\.|[^\\()])*\)|T\*|Td|TD|ET/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[0];
    if (s.startsWith('(')) {
      text += s.slice(1, -1)
        .replace(/\\([nrt])/g, ' ')
        .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1');
    } else {
      text += ' ';
    }
  }
  return text;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(bytes);
  const pages: string[] = [];
  const re = /stream\r?\n?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const inflated = await inflate(bytes.slice(start, end));
    if (inflated) pages.push(inflated);
    re.lastIndex = end + 'endstream'.length; // skip past the keyword's own "stream"
  }
  // Fall back to the uncompressed literals only if nothing inflated at all.
  if (pages.length === 0) return showTextOf(raw).replace(/[^\S\f]+/g, ' ').trim();
  // Keep only the streams that decode to prose. A PDF also carries font tables
  // and image data as streams; dropping them means the surviving blocks line up
  // with the document's real pages, so PAGE_SEP (\f) yields a citable page
  // number for every quote instead of an opaque character offset.
  const prose = pages
    .map(p => showTextOf(p).replace(/[^\S\f]+/g, ' ').trim())
    .filter(p => {
      if (p.length < 40) return false;
      const words = p.split(/\s+/).filter(w => w.length > 1);
      if (words.length < 12) return false;
      return (p.match(/[A-Za-z ]/g) || []).length / p.length > 0.75;
    });
  return (prose.length > 0 ? prose : pages.map(p => showTextOf(p).replace(/[^\S\f]+/g, ' ').trim()).filter(Boolean))
    .join(PAGE_SEP);
}


/** Real page boundary marker inside extracted document text. */
export const PAGE_SEP = '\f';

export interface EvidenceRef {
  /** 1-based page number (PDFs); 1 for single-page HTML documents. */
  page: number;
  /** 1-based sentence-line index within that page. */
  line: number;
  /** Character offset of the quote inside the full extracted text. */
  char_start: number;
  /** The full sentence-line the quote sits in, for context. */
  context: string;
  /** Total pages in the extracted document. */
  pages: number;
}

// ── Scoring provenance ──────────────────────────────────────────────────────
// Every published score must be traceable to the exact text version it was
// computed from, the parser settings that produced that text, and the run that
// wrote it. The identity of a text version is its SHA-256 fingerprint, so a
// re-read that yields different text is visibly a different input.

/** Bump when the PDF/HTML readers change in a way that alters extracted text. */
export const EXTRACTOR_VERSION = 'pdf-inflate-v3-pagesep';
export const HTML_EXTRACTOR_VERSION = 'html-strip-v2';

/** Parser settings that decide which streams survive and where pages break. */
export const PARSER_SETTINGS = {
  page_sep: '\\f',
  pdf_inflate_formats: ['deflate', 'deflate-raw'],
  prose_stream_min_chars: 40,
  prose_stream_min_words: 12,
  prose_stream_alpha_ratio: 0.75,
  prose_gate_min_words: { policy: 200, other: 40 },
} as const;

export interface ExtractionMeta {
  url: string;
  extractor: 'pdf' | 'html';
  extractor_version: string;
  http_status: number;
  content_type: string;
  source_bytes: number;
  fetched_at: string;
}

/** Text fingerprint → how that exact text version was obtained. */
const EXTRACTIONS = new Map<string, ExtractionMeta>();

/** Short, stable SHA-256 fingerprint identifying one extracted text version. */
export async function textFingerprint(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export interface RunMeta {
  /** Unique id of this invocation — the "repair run" a score came from. */
  run_id: string;
  /** scrape | repair-transcripts | repair-refs | repair-zero-scores | … */
  mode: string;
  started_at: string;
}
let RUN: RunMeta = { run_id: crypto.randomUUID(), mode: 'unknown', started_at: new Date().toISOString() };
export function beginRun(mode: string): RunMeta {
  RUN = { run_id: crypto.randomUUID(), mode, started_at: new Date().toISOString() };
  return RUN;
}
export function currentRun(): RunMeta { return RUN; }


const normalize = (s: string) => s.toLowerCase().replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const splitLines = (s: string) => s.split(/(?<=[.?!])\s+/).map(l => l.trim()).filter(Boolean);

/**
 * Locate a verbatim evidence quote inside the extracted document text and
 * return a citable page/line reference. The model often stitches several
 * sentences together with "...", so each fragment is tried separately, longest
 * first. Matching runs on normalized text (case, quotes and punctuation are
 * ignored) and the normalized hit is mapped back to the sentence-line it sits
 * in. If nothing can be matched the reference is omitted rather than guessed.
 */
export function locateEvidence(quote: string, fullText: string): EvidenceRef | null {
  if (!quote || !fullText) return null;
  const fragments = [quote, ...quote.split(/\.\.\.|…/)]
    .map(f => normalize(f))
    .filter(f => f.length >= 15)
    .sort((a, b) => b.length - a.length);
  if (fragments.length === 0) return null;

  const pages = fullText.split(PAGE_SEP);
  let consumed = 0;
  for (let p = 0; p < pages.length; p++) {
    const pageText = pages[p];
    const lines = splitLines(pageText);
    // Normalized page text plus the normalized start offset of every line, so a
    // quote spanning a sentence break still resolves to its opening line.
    const normLines = lines.map(normalize);
    const starts: number[] = [];
    let acc = 0;
    for (const nl of normLines) { starts.push(acc); acc += nl.length + 1; }
    const normPage = normLines.join(' ');

    for (const frag of fragments) {
      const keys = [frag, frag.slice(0, 60), frag.slice(0, 30)];
      let hit = -1;
      for (const k of keys) {
        if (k.length < 15) continue;
        hit = normPage.indexOf(k);
        if (hit >= 0) break;
      }
      if (hit < 0) continue;
      let line = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= hit) line = i;
      const rawAt = pageText.indexOf(lines[line]);
      return {
        page: p + 1,
        line: line + 1,
        char_start: consumed + (rawAt >= 0 ? rawAt : 0),
        context: lines.slice(line, line + 2).join(' ').slice(0, 600),
        pages: pages.length,
      };
    }
    consumed += pageText.length + PAGE_SEP.length;
  }
  return null;
}



/**
 * Readability gate. A document is only scoreable if the extracted text is
 * actual prose: enough words, and a plausible density of English function
 * words. Font tables, PDF operators and navigation chrome all fail this, and a
 * failing document is skipped rather than guessed at by the model.
 */
const PROSE_WORDS = /\b(the|and|of|to|in|that|we|is|for|on|as|with|inflation|policy|rate|committee|economy|percent)\b/gi;

export function isReadableProse(text: string, minWords = 300): boolean {
  const words = text.split(/\s+/).filter(w => w.length > 1);
  if (words.length < minWords) return false;
  const hits = (text.match(PROSE_WORDS) || []).length;
  return hits / words.length >= 0.05;
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const r = await sf(url, 15000);
    if (!r || !r.ok) return '';
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const isPdf = ct.includes('pdf') || url.toLowerCase().endsWith('.pdf');
    let text: string;
    let bytes = 0;
    if (isPdf) {
      const raw = new Uint8Array(await r.arrayBuffer());
      bytes = raw.length;
      text = await extractPdfText(raw);
    } else {
      const html = await r.text();
      bytes = html.length;
      text = extractText(html);
    }
    // Register how this exact text version was produced so the score written
    // from it can cite the fetch, the reader and the parser settings used.
    if (text) {
      EXTRACTIONS.set(await textFingerprint(text), {
        url,
        extractor: isPdf ? 'pdf' : 'html',
        extractor_version: isPdf ? EXTRACTOR_VERSION : HTML_EXTRACTOR_VERSION,
        http_status: r.status,
        content_type: ct || 'unknown',
        source_bytes: bytes,
        fetched_at: new Date().toISOString(),
      });
    }
    return text;
  } catch { return ''; }
}



// ── XML helpers ──
function cd(xml: string, tag: string): string {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
}
function pi(xml: string) {
  const items: { title: string; link: string; pubDate: string; cat: string }[] = [];
  const re = new RegExp('<item>([\\s\\S]*?)</item>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null)
    items.push({ title: cd(m[1], 'title'), link: cd(m[1], 'link') || cd(m[1], 'guid'), pubDate: cd(m[1], 'pubDate'), cat: cd(m[1], 'category').toLowerCase() });
  return items;
}
function ae(xml: string) {
  const entries: { title: string; link: string; updated: string }[] = [];
  const re = new RegExp('<entry>([\\s\\S]*?)</entry>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const lm = m[1].match(new RegExp('<link[^>]+href=["\']([^"\']+)["\']', 'i'));
    entries.push({ title: cd(m[1], 'title'), link: lm ? lm[1].trim() : '', updated: cd(m[1], 'updated') });
  }
  return entries;
}
function td(t: string): string | null {
  if (!t) return null;
  try { const d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]; } catch { return null; }
}
function xn(title: string): number | null {
  const tl = title.toLowerCase();
  const m = tl.match(new RegExp('(-?\\d+\\.?\\d*)\\s*%'));
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v)) return null;
  // Don't negate if value follows "to", "at", "of" — it's an absolute level (e.g. "inflation down to 1.7%")
  const beforeNum = tl.slice(0, m.index);
  if (/\b(to|at|of)\s*$/.test(beforeNum)) return v;
  // Only negate for change descriptions (e.g. "fell 0.3%")
  const negWords = ['down', 'fell', 'drop', 'decrease', 'decline', 'contract', 'shrink', 'lower'];
  if (v > 0 && negWords.some(w => tl.includes(w))) v = -v;
  return v;
}

// ══════════════════════════════════════════════════════════════
// ── AI-POWERED SCORING via Gemini (Lovable AI Gateway) ──
// ══════════════════════════════════════════════════════════════

const AI_SCORING_PROMPT = `You are a senior monetary policy analyst. Score this central bank communication on the hawkish-dovish spectrum.

CRITICAL — READ THE CONCLUSIONS, NOT JUST THE TOPIC:
- A blog titled "Lower inflation, weaker activity" is DOVISH because the CONCLUSION is weaker economy and falling prices — even if it discusses tariffs.
- A blog about tariffs is NOT automatically hawkish. Read what the authors CONCLUDE about the impact on the economy.
- Focus on the POLICY IMPLICATIONS the authors draw, not just the subject matter.

ENERGY / SUPPLY-SIDE RISKS:
- "Risks to price stability" from energy, fossil fuels, or supply shocks = UPSIDE INFLATION RISK = HAWKISH (not dovish!)
- Discussions warning that commodity dependence or supply disruptions could push prices higher are HAWKISH signals
- Green transition advocacy WITHOUT direct monetary policy implications → score near 0.0 (structural topic)
- Only score energy topics as dovish if the conclusion is that energy prices are FALLING or will ease inflation

SCORING RULES:
- Score from -1.0 (extremely dovish) to +1.0 (extremely hawkish), with 0.0 being neutral
- DEFAULT TO NEUTRAL: if the conclusion is mixed, balanced, conditional, or not explicitly directional → score in [-0.15, +0.15].
- Reserve scores beyond ±0.5 for unambiguous, explicit hike/cut signals, dissents, or strong directional guidance.
- Do NOT inflate to hawkish just because the text mentions inflation, tariffs, supply shocks, or "vigilance" — score it hawkish ONLY if the speaker concludes tighter policy / longer-for-longer is warranted.
- Symmetric calibration: mentions of disinflation, growth weakness, or downside risks should be scored dovish with the same threshold strictness.
- DOVISH signals (-0.2 to -1.0): rate cuts, easing bias, weak growth concerns, disinflation, labor softening, dissent favoring cuts, downside risks, falling inflation forecasts
- HAWKISH signals (+0.2 to +1.0): explicit rate hikes/holds-for-longer, tightening bias, persistent inflation concern with policy implication, upside risks to inflation linked to a policy response
- NEUTRAL (near 0.0): administrative matters, non-monetary topics (digital euro, climate structural reform, banking supervision, counterfeit notes, appointments, green transition without policy implications), data-dependent language without direction
- Government deficit/fiscal policy discussions: score near 0.0 unless they explicitly discuss monetary policy responses
- If the speech is NOT about monetary policy, score 0.0
- Pay attention to DISSENT: if a speaker dissented in favor of cutting, that's very dovish
- Pay attention to NUANCE: "data-dependent" alone is neutral; "data-dependent and we see progress" leans dovish

ENTITY-LEVEL SUB-DIMENSIONS (Layer 2) — score each on the FIXED anchor ladder below.
Do not free-hand a number: pick the anchor whose description the text actually matches, and only
move ±0.1 off an anchor to reflect how emphatic the wording is.

ANCHOR LADDER (identical for all three dimensions):
   0.0  → the text does not address this dimension, or is genuinely two-sided on it
  ±0.2  → mentioned once, hedged or conditional ("could", "some", "we are watching")
  ±0.5  → stated as the speaker's assessment of the current situation, unhedged
  ±0.8  → stated as the dominant concern of the document, repeated or quantified
  ±1.0  → stated as the binding reason for the policy decision itself

1. inflation_persistence — where the text puts price pressure (HICP/PCE, wages, expectations).
   POSITIVE (+) = pressure is persistent, above target, broadening, or expectations drifting up.
   NEGATIVE (−) = disinflation on track, pressure fading, expectations anchored or falling.
   +1.0 example: "inflation is too high and that is why we raised rates today"
   −0.5 example: "underlying inflation has continued to ease as we expected"

2. policy_stance — how restrictive the speaker frames current or needed policy.
   POSITIVE (+) = keep restrictive, higher-for-longer, hike, resist cutting, dissent for a hike.
   NEGATIVE (−) = easing bias, cut delivered or signalled, policy seen as too tight, dissent for a cut.
   +1.0 example: a delivered hike or "we are not close to cutting"
   −1.0 example: a delivered cut or "further easing will be appropriate"
   HOLD RULES (apply strictly — a hold is a continuation, not a new signal):
     • Announcing an unchanged rate, on its own, is 0.0. The words "maintain the target range"
       or "keep rates unchanged" carry NO directional score by themselves.
     • Only go beyond ±0.2 on a hold if the text adds explicit forward direction:
       ±0.2 hedged direction ("we can be patient", "we are watching"),
       ±0.5 unhedged direction ("rates will need to stay at these levels for some time" / "cuts are coming"),
       ±0.8/±1.0 only if that direction is the dominant, repeated message of the document.
     • Voting record adjustment: dissents in favour of cutting push this dimension DOWN
       (−0.2 for one or two dissenters, −0.3 if three or more); dissents for hiking push it up
       by the same amounts. Apply this after picking the anchor, then clamp to [−1, +1].
     • Never score a hold positive merely because the current level is described as restrictive.


3. growth_labor_drag — the state of demand and the labour market as the speaker describes it.
   POSITIVE (+) = economy resilient, labour market tight, demand robust (i.e. no case for easing).
   NEGATIVE (−) = growth slowing, unemployment rising, recession or downside risk emphasised.
   +0.5 example: "the labour market remains solid"
   −0.8 example: "hiring has slowed markedly and downside risks have increased"

Quote the words you scored from: for each non-zero dimension put a short verbatim snippet in
"evidence". The headline score must be consistent with the dimensions you report.

Respond with ONLY a JSON object (no markdown):
{"score": <number>, "label": "hawkish"|"dovish"|"neutral", "reasoning": "<1 sentence>",
 "dimensions": {"inflation_persistence": <number>, "policy_stance": <number>, "growth_labor_drag": <number>},
 "evidence": {"inflation_persistence": "<quote or empty>", "policy_stance": "<quote or empty>", "growth_labor_drag": "<quote or empty>"}}`;


// ── Deterministic hold guard + forward-guidance override ────────────────────
// A decision to keep rates unchanged is a continuation, not a new directional
// signal. The policy_stance dimension is therefore capped at ±0.2 on hold
// documents UNLESS the scored passage contains explicit forward-policy
// language (see _shared/forward-guidance.ts) pointing in the same direction as
// the score. Dissents are then applied mechanically from the vote split.
const HOLD_ANNOUNCEMENT = /\b(maintain|maintaining|keep|keeping|leave|leaving|left|unchanged|no change)\b[^.]{0,80}\b(target range|rate|rates|policy rate|federal funds)\b|\b(target range|rates?)\b[^.]{0,40}\b(unchanged|at its current level)\b/i;
const HOLD_TITLE = /statement|monetary policy decision|press conf|minutes|account/i;
const HOLD_CAP = 0.2;

/** Text around the quote, so guidance one sentence away still counts. */
function quoteContext(quote: string, fullText: string, radius = 700): string {
  if (!quote || !fullText) return quote || '';
  const needle = quote.slice(0, 60);
  const i = fullText.indexOf(needle);
  if (i < 0) return quote;
  return fullText.slice(Math.max(0, i - radius), i + needle.length + radius);
}

function applyHoldGuard(
  stance: number,
  quote: string,
  fullText: string,
  title: string,
): { value: number; notes: string[]; guidance: GuidanceResult } {
  const notes: string[] = [];
  const guidance = detectForwardGuidance(quoteContext(quote, fullText));
  if (!HOLD_TITLE.test(title)) return { value: stance, notes, guidance };
  let v = stance;

  const isHold = HOLD_ANNOUNCEMENT.test(quote);
  if (isHold && Math.abs(v) > HOLD_CAP) {
    const aligned =
      guidance.found &&
      guidance.direction !== 'ambiguous' &&
      Math.sign(v) === (guidance.direction === 'hawkish' ? 1 : -1);
    if (!aligned) {
      v = Math.sign(v) * HOLD_CAP;
      notes.push(
        guidance.found
          ? `forward guidance reads ${guidance.direction} but the stance score points the other way → capped at ±${HOLD_CAP.toFixed(2)}`
          : `hold announcement with no explicit forward-policy language → capped at ±${HOLD_CAP.toFixed(2)}`,
      );
    } else {
      // Only explicit guidance lifts the clamp; conditional guidance lifts it
      // part-way (mid-point between the cap and the model's score).
      if (guidance.strength < 1) {
        v = Math.sign(v) * (HOLD_CAP + (Math.abs(v) - HOLD_CAP) * guidance.strength);
        notes.push(`conditional ${guidance.direction} guidance ("${guidance.cues[0].phrase}") → clamp lifted partially`);
      } else {
        notes.push(`explicit ${guidance.direction} forward guidance ("${guidance.cues[0].phrase}") → clamp overridden`);
      }
    }
  }

  // Vote split, e.g. "by a 9 to 3 vote": dissenters move the stance against the
  // majority. Direction of dissent is read from nearby cut/hike wording.
  const vote = /\b(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\s*vote\b/i.exec(fullText);
  if (vote) {
    const dissent = Math.min(Number(vote[1]), Number(vote[2]));
    if (dissent >= 1) {
      const window = fullText.slice(Math.max(0, vote.index - 400), vote.index + 900);
      const forCut = /(dissent|preferred|voted against|favou?red)[^.]{0,120}\b(lower|cut|reduc)/i.test(window);
      const forHike = /(dissent|preferred|voted against|favou?red)[^.]{0,120}\b(higher|hike|increas|raise)/i.test(window);
      const step = dissent >= 3 ? 0.3 : 0.2;
      if (forCut && !forHike) { v -= step; notes.push(`${dissent} dissent(s) favouring easing → −${step.toFixed(2)}`); }
      else if (forHike && !forCut) { v += step; notes.push(`${dissent} dissent(s) favouring tightening → +${step.toFixed(2)}`); }
    }
  }
  v = Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000;
  return { value: v, notes, guidance };
}


// ── Standardization layer (auditable, deterministic) ──
// The model returns a headline score AND three sub-dimension scores. We do NOT
// take the headline at face value: we recompute a deterministic composite from
// the dimensions with fixed published weights and average the two. The stored
// score is therefore reproducible from numbers the UI can show.
export const SCORING_PROMPT_VERSION = 'v6.1-hold-guard-2026-08';
export const DIMENSION_WEIGHTS = {
  inflation_persistence: 0.45,
  policy_stance: 0.40,
  growth_labor_drag: 0.15,
} as const;
/** Blend of the model's own headline vs the dimension composite. */
export const AI_HEADLINE_WEIGHT = 0.5;
/** Scores inside this band are published as exactly neutral. */
export const NEUTRAL_BAND = 0.10;

interface AIScore {
  score: number;
  label: string;
  reasoning: string;
  dimensions?: { inflation_persistence: number; policy_stance: number; growth_labor_drag: number };
  /** Technical audit trail for the UI: how the published score was derived. */
  audit?: {
    model: string;
    prompt_version: string;
    temperature: number;
    ai_headline: number;
    dimension_composite: number;
    weights: typeof DIMENSION_WEIGHTS;
    ai_headline_weight: number;
    neutral_band: number;
    input_chars: number;
    published: number;
    /** Verbatim snippet the model scored each dimension from. */
    evidence?: { inflation_persistence: string; policy_stance: string; growth_labor_drag: string };
    /** Page/line reference of each snippet inside the extracted document. */
    evidence_refs?: Partial<Record<'inflation_persistence' | 'policy_stance' | 'growth_labor_drag', EvidenceRef>>;
    /** Extraction provenance for the panel: pages found, words extracted, chars sent. */
    extraction?: { pages: number; words: number; doc_chars: number; sampled: boolean };
    /**
     * Full provenance chain: which text version, produced by which reader and
     * parser settings, sampled how, scored by which run.
     */
    provenance?: {
      text_sha256: string;
      text_chars: number;
      extractor: string;
      extractor_version: string;
      parser_settings: typeof PARSER_SETTINGS;
      prose_gate_min_words: number;
      sampling: { budget: number; begin: number; middle: number; end: number; sampled: boolean; sent_chars: number };
      source_url?: string;
      http_status?: number;
      content_type?: string;
      fetched_at?: string;
      run_id: string;
      run_mode: string;
      run_started_at: string;
      attempt: number;
      scored_at: string;
    };

  };
}



// Detect if an item is a major policy document that needs stronger AI model
function isPolicyDocForScoring(title: string, source: string): boolean {
  const tl = (title + ' ' + source).toLowerCase();
  const keywords = [
    'minutes', 'accounts', 'account', 'press conf', 'statement',
    'monetary policy', 'fomc', 'governing council',
  ];
  return keywords.some(k => tl.includes(k));
}

async function scoreWithAI(
  title: string,
  text: string,
  bank: string,
  apiKey: string,
  source?: string,
): Promise<AIScore> {
  const isPolicy = isPolicyDocForScoring(title, source || '');

  // Nothing is ever scored on unusable text: a document whose extraction failed
  // is returned as unscored so the aggregate ignores it, instead of letting the
  // model invent a lean it cannot support.
  if (!isReadableProse(text, isPolicy ? 200 : 40)) {
    return {
      score: 0,
      label: 'neutral',
      reasoning: 'not scored — the source text could not be extracted as readable prose',
    };
  }

  let truncated: string;
  const budget = isPolicy ? 24000 : 6000;
  const beginLen = isPolicy ? 14000 : 3000;
  const midLen = isPolicy ? 6000 : 1500;
  const endLen = isPolicy ? 4000 : 1500;
  if (text.length <= budget) {
    truncated = text;
  } else {
    // Long documents (press conferences, minutes): sample beginning + middle + end.
    // The opening carries the decision and guidance, the Q&A carries the nuance.
    const mid = Math.floor(text.length / 2);
    truncated = text.slice(0, beginLen) +
      '\n...[middle section truncated]...\n' +
      text.slice(mid - Math.floor(midLen / 2), mid + Math.floor(midLen / 2)) +
      '\n...[late section truncated]...\n' +
      text.slice(-endLen);
  }

  // Identity of the exact text version scored, plus how it was obtained.
  const textSha = await textFingerprint(text);
  const extractionMeta = EXTRACTIONS.get(textSha);
  const run = currentRun();


  // Add special instructions for policy documents
  let policyPreamble = '';
  if (isPolicy) {
    policyPreamble = `\n\nIMPORTANT: This is an official central bank policy document. Read the supplied text carefully and base the score ONLY on what it actually says:
- Rate decisions (cut/hold/hike) and the vote split
- Forward guidance language ("appropriate stance", "data-dependent", "further adjustment")
- Risk assessments (upside/downside)
- Dissent or disagreement among members
- Inflation/growth outlook changes
Quote-level evidence is required: the "reasoning" field must cite the specific wording from the text that drove the score. Such documents normally carry a clear signal (±0.2 to ±0.8), but NEVER assume a direction. If the supplied text is garbled, incomplete, or contains no policy content, return score 0 with reasoning stating that the text could not be analysed — do not guess a lean and do not justify a score by referring to these instructions.`;
  }


  const userMsg = `Bank: ${bank}
Title: ${title}${policyPreamble}
Content: ${truncated}`;

  // Use stronger model for policy documents, lighter model for routine items
  const model = isPolicy ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash-lite';

  // Policy documents get several attempts — a rate-limited gateway must never
  // leave a binding statement/decision sitting at a bogus 0 score.
  const attempts = isPolicy ? 4 : 2;
  let lastErr = 'AI scoring unavailable';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt - 1)));
    try {
      const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          // Deterministic decoding: the same document must always produce the
          // same score, otherwise the published number is not reproducible.
          temperature: 0,
          messages: [
            { role: 'system', content: AI_SCORING_PROMPT },
            { role: 'user', content: userMsg },
          ],
        }),
      });

      if (!resp.ok) {
        console.error(`AI scoring failed (attempt ${attempt + 1}/${attempts}):`, resp.status, title.slice(0, 60));
        lastErr = 'AI scoring unavailable';
        continue;
      }

      const data = await resp.json();
      let content = data.choices?.[0]?.message?.content || '';
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const parsed = JSON.parse(content);
      const cl = (v: unknown) => Math.round(Math.max(-1, Math.min(1, Number(v) || 0)) * 1000) / 1000;
      const d = parsed.dimensions || {};
      const dims = {
        inflation_persistence: cl(d.inflation_persistence),
        policy_stance: cl(d.policy_stance),
        growth_labor_drag: cl(d.growth_labor_drag),
      };

      const rawStance = dims.policy_stance;
      const rawEv = parsed.evidence || {};
      const guard = applyHoldGuard(
        rawStance,
        typeof rawEv.policy_stance === 'string' ? rawEv.policy_stance : '',
        text || '',
        title || '',
      );
      dims.policy_stance = guard.value;

      const aiHeadline = cl(parsed.score);
      const composite = cl(
        dims.inflation_persistence * DIMENSION_WEIGHTS.inflation_persistence +
        dims.policy_stance * DIMENSION_WEIGHTS.policy_stance +
        dims.growth_labor_drag * DIMENSION_WEIGHTS.growth_labor_drag,
      );
      const hasDims = Math.abs(dims.inflation_persistence) + Math.abs(dims.policy_stance) + Math.abs(dims.growth_labor_drag) > 0.001;
      let score = hasDims
        ? cl(AI_HEADLINE_WEIGHT * aiHeadline + (1 - AI_HEADLINE_WEIGHT) * composite)
        : aiHeadline;
      if (Math.abs(score) < NEUTRAL_BAND) score = 0;
      const label = score > 0 ? 'hawkish' : score < 0 ? 'dovish' : 'neutral';

      const ev = parsed.evidence || {};
      const q = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 240) : '');
      const evidence = {
        inflation_persistence: q(ev.inflation_persistence),
        policy_stance: q(ev.policy_stance),
        growth_labor_drag: q(ev.growth_labor_drag),
      };
      // Cite each quote back to where it actually sits in the source document.
      const evidence_refs: Record<string, EvidenceRef> = {};
      for (const k of Object.keys(evidence) as (keyof typeof evidence)[]) {
        const ref = evidence[k] ? locateEvidence(evidence[k], text) : null;
        if (ref) evidence_refs[k] = ref;
      }

      return {
        score,
        label,
        reasoning: parsed.reasoning || '',
        dimensions: dims,
        audit: {
          model,
          prompt_version: SCORING_PROMPT_VERSION,
          temperature: 0,
          ai_headline: aiHeadline,
          dimension_composite: composite,
          weights: DIMENSION_WEIGHTS,
          stance_adjustments: guard.notes.length ? { raw_policy_stance: rawStance, applied: guard.notes } : undefined,
          ai_headline_weight: AI_HEADLINE_WEIGHT,
          neutral_band: NEUTRAL_BAND,
          input_chars: truncated.length,
          published: score,
          evidence,
          evidence_refs,
          extraction: {
            pages: text.split(PAGE_SEP).length,
            words: text.split(/\s+/).filter(Boolean).length,
            doc_chars: text.length,
            sampled: truncated.length < text.length,
          },
          provenance: {
            text_sha256: textSha,
            text_chars: text.length,
            extractor: extractionMeta?.extractor ?? 'unknown',
            extractor_version: extractionMeta?.extractor_version ?? 'n/a',
            parser_settings: PARSER_SETTINGS,
            prose_gate_min_words: isPolicy
              ? PARSER_SETTINGS.prose_gate_min_words.policy
              : PARSER_SETTINGS.prose_gate_min_words.other,
            sampling: {
              budget,
              begin: beginLen,
              middle: midLen,
              end: endLen,
              sampled: truncated.length < text.length,
              sent_chars: truncated.length,
            },
            source_url: extractionMeta?.url,
            http_status: extractionMeta?.http_status,
            content_type: extractionMeta?.content_type,
            fetched_at: extractionMeta?.fetched_at,
            run_id: run.run_id,
            run_mode: run.mode,
            run_started_at: run.started_at,
            attempt: attempt + 1,
            scored_at: new Date().toISOString(),
          },
        },

      };


    } catch (e) {
      console.error(`AI score parse error (attempt ${attempt + 1}/${attempts}):`, e);
      lastErr = 'AI scoring error';
    }
  }
  return { score: 0, label: 'neutral', reasoning: lastErr };
}

async function scoreBatchWithAI(
  items: { title: string; text: string; bank: string; source?: string }[],
  apiKey: string,
): Promise<AIScore[]> {
  const results: AIScore[] = [];
  for (let i = 0; i < items.length; i += 3) {
    const batch = items.slice(i, i + 3);
    const batchResults = await Promise.allSettled(
      batch.map(item => scoreWithAI(item.title, item.text, item.bank, apiKey, item.source))
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { score: 0, label: 'neutral', reasoning: 'error' });
    }
    if (i + 3 < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
}

// ══════════════════════════════════════════════════════════════
// ── SEP DELTA SCORING — Compare projections between meetings ──
// ══════════════════════════════════════════════════════════════

interface SEPProjections {
  gdp_current: number | null;
  gdp_next: number | null;
  unemployment_current: number | null;
  unemployment_next: number | null;
  pce_current: number | null;
  pce_next: number | null;
  core_pce_current: number | null;
  core_pce_next: number | null;
  fed_funds_current: number | null;
  fed_funds_next: number | null;
  fed_funds_longer_run: number | null;
}

const SEP_EXTRACTION_PROMPT = `You are an expert at reading FOMC Summary of Economic Projections (SEP) tables.

Extract the MEDIAN projections from this SEP document. The document contains tables with projections for:
- Change in real GDP (%)
- Unemployment rate (%)
- PCE inflation (%)
- Core PCE inflation (%)
- Federal funds rate (%)

For each variable, extract the median value for:
- "current_year" = the year the meeting is in
- "next_year" = the following year
- "longer_run" = only for federal funds rate

IMPORTANT: Look for the MEDIAN row in each table. The median is typically the middle value.
If the text is garbled or you cannot reliably extract numbers, use null.

Respond with ONLY a JSON object (no markdown):
{
  "gdp_current": <number or null>,
  "gdp_next": <number or null>,
  "unemployment_current": <number or null>,
  "unemployment_next": <number or null>,
  "pce_current": <number or null>,
  "pce_next": <number or null>,
  "core_pce_current": <number or null>,
  "core_pce_next": <number or null>,
  "fed_funds_current": <number or null>,
  "fed_funds_next": <number or null>,
  "fed_funds_longer_run": <number or null>
}`;

async function extractSEPProjections(text: string, meetingDate: string, apiKey: string): Promise<SEPProjections | null> {
  try {
    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SEP_EXTRACTION_PROMPT },
          { role: 'user', content: `Meeting date: ${meetingDate}\n\nSEP Document:\n${truncated}` },
        ],
      }),
    });
    if (!resp.ok) { console.error('SEP extraction AI failed:', resp.status); return null; }
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(content);
    const values = [parsed.gdp_current, parsed.unemployment_current, parsed.pce_current, parsed.core_pce_current, parsed.fed_funds_current];
    const nonNull = values.filter((v: any) => v !== null && v !== undefined);
    if (nonNull.length < 2) { console.log('SEP extraction got too few values (' + nonNull.length + '), skipping'); return null; }
    console.log('SEP projections extracted for ' + meetingDate + ': GDP=' + parsed.gdp_current + ', UE=' + parsed.unemployment_current + ', PCE=' + parsed.pce_current + ', CorePCE=' + parsed.core_pce_current + ', FFR=' + parsed.fed_funds_current);
    return parsed as SEPProjections;
  } catch (e) { console.error('SEP extraction error:', e); return null; }
}

function scoreSEPDelta(current: SEPProjections, previous: SEPProjections): { score: number; label: string; reasons: string[] } {
  const deltas: { name: string; delta: number; direction: string; weight: number }[] = [];
  if (current.gdp_current != null && previous.gdp_current != null) deltas.push({ name: 'GDP current yr', delta: current.gdp_current - previous.gdp_current, direction: 'hh', weight: 2 });
  if (current.gdp_next != null && previous.gdp_next != null) deltas.push({ name: 'GDP next yr', delta: current.gdp_next - previous.gdp_next, direction: 'hh', weight: 1.5 });
  if (current.unemployment_current != null && previous.unemployment_current != null) deltas.push({ name: 'UE current yr', delta: current.unemployment_current - previous.unemployment_current, direction: 'lh', weight: 2 });
  if (current.unemployment_next != null && previous.unemployment_next != null) deltas.push({ name: 'UE next yr', delta: current.unemployment_next - previous.unemployment_next, direction: 'lh', weight: 1.5 });
  if (current.pce_current != null && previous.pce_current != null) deltas.push({ name: 'PCE current yr', delta: current.pce_current - previous.pce_current, direction: 'hh', weight: 3 });
  if (current.pce_next != null && previous.pce_next != null) deltas.push({ name: 'PCE next yr', delta: current.pce_next - previous.pce_next, direction: 'hh', weight: 2 });
  if (current.core_pce_current != null && previous.core_pce_current != null) deltas.push({ name: 'Core PCE current yr', delta: current.core_pce_current - previous.core_pce_current, direction: 'hh', weight: 3.5 });
  if (current.core_pce_next != null && previous.core_pce_next != null) deltas.push({ name: 'Core PCE next yr', delta: current.core_pce_next - previous.core_pce_next, direction: 'hh', weight: 2.5 });
  if (current.fed_funds_current != null && previous.fed_funds_current != null) deltas.push({ name: 'FFR current yr', delta: current.fed_funds_current - previous.fed_funds_current, direction: 'hh', weight: 3 });
  if (current.fed_funds_next != null && previous.fed_funds_next != null) deltas.push({ name: 'FFR next yr', delta: current.fed_funds_next - previous.fed_funds_next, direction: 'hh', weight: 2.5 });
  if (current.fed_funds_longer_run != null && previous.fed_funds_longer_run != null) deltas.push({ name: 'FFR longer-run', delta: current.fed_funds_longer_run - previous.fed_funds_longer_run, direction: 'hh', weight: 2 });

  if (deltas.length === 0) return { score: 0, label: 'neutral', reasons: ['No comparable projections found'] };

  let weightedSum = 0, totalWeight = 0;
  const reasons: string[] = [];
  for (const d of deltas) {
    let rawSignal = d.delta / 0.3; // 0.3pp normalizer
    if (d.direction === 'lh') rawSignal = -rawSignal;
    rawSignal = Math.max(-1, Math.min(1, rawSignal));
    weightedSum += rawSignal * d.weight;
    totalWeight += d.weight;
    if (Math.abs(d.delta) >= 0.05) {
      const dir = (d.direction === 'hh' ? (d.delta > 0 ? '↑hawk' : '↓dove') : (d.delta > 0 ? '↓dove' : '↑hawk'));
      reasons.push(`${d.name}: ${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)}pp ${dir}`);
    }
  }
  const score = Math.round((weightedSum / totalWeight) * 1000) / 1000;
  const clampedScore = Math.max(-1, Math.min(1, score));
  const label = clampedScore > 0.05 ? 'hawkish' : clampedScore < -0.05 ? 'dovish' : 'neutral';
  if (reasons.length === 0) reasons.push('Minimal changes from previous SEP');
  return { score: clampedScore, label, reasons };
}

async function runSEPDeltaScoring(sbUrl: string, sbKey: string, apiKey: string): Promise<{ updated: number }> {
  const resp = await fetch(
    `${sbUrl}/rest/v1/sentiment_items?select=id,title,item_date,net_score,policy_dimensions,reasons&source=eq.FOMC SEP&order=item_date.asc&limit=50`,
    { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
  );
  if (!resp.ok) return { updated: 0 };
  const sepItems = await resp.json();
  if (!sepItems || sepItems.length === 0) return { updated: 0 };
  console.log('SEP delta scoring: ' + sepItems.length + ' SEP items found');

  let extractCount = 0;
  for (const item of sepItems) {
    const dims = item.policy_dimensions;
    if (dims && dims.sep_projections && Object.values(dims.sep_projections).some((v: any) => v !== null)) continue;
    const dateMatch = item.title.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!dateMatch) continue;
    const dateStr = dateMatch[3] + dateMatch[1] + dateMatch[2];

    let sepText = '';
    const sepHtmlUrl = 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl' + dateStr + '.htm';
    const htmlResp = await sf(sepHtmlUrl, 12000);
    if (htmlResp && htmlResp.ok) {
      const html = await htmlResp.text();
      if (!html.toLowerCase().includes('page not found') && html.length > 1000) sepText = extractText(html);
    }
    if (sepText.length < 500) {
      const pdfUrl = 'https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl' + dateStr + '.pdf';
      const pdfResp = await sf(pdfUrl, 15000);
      if (pdfResp && pdfResp.ok) {
        const ct = pdfResp.headers.get('content-type') || '';
        if (ct.includes('pdf')) {
          const buf = await pdfResp.arrayBuffer();
          const decoder = new TextDecoder('latin1');
          const raw = decoder.decode(new Uint8Array(buf));
          const parenRe = /\(([^)]*)\)/g; let pm;
          while ((pm = parenRe.exec(raw)) !== null) {
            const t = pm[1].replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
            if (t.length > 1) sepText += t + ' ';
          }
          sepText = sepText.replace(/\s+/g, ' ').trim();
        }
      }
    }
    if (sepText.length < 200) continue;
    const projections = await extractSEPProjections(sepText, item.item_date, apiKey);
    if (!projections) continue;
    const newDims = { ...(dims || {}), sep_projections: projections };
    await fetch(sbUrl + '/rest/v1/sentiment_items?id=eq.' + item.id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_dimensions: newDims }),
    });
    item.policy_dimensions = newDims;
    extractCount++;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('SEP projections extracted for ' + extractCount + ' items');

  let updated = 0;
  for (let i = 1; i < sepItems.length; i++) {
    const current = sepItems[i], previous = sepItems[i - 1];
    const currProj = current.policy_dimensions?.sep_projections;
    const prevProj = previous.policy_dimensions?.sep_projections;
    if (!currProj || !prevProj) continue;
    const deltaResult = scoreSEPDelta(currProj, prevProj);
    console.log('SEP delta ' + current.item_date + ' vs ' + previous.item_date + ': score=' + deltaResult.score + ' (' + deltaResult.label + ') — ' + deltaResult.reasons.join(', '));
    const updateResp = await fetch(sbUrl + '/rest/v1/sentiment_items?id=eq.' + current.id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        net_score: deltaResult.score, label: deltaResult.label,
        hawk_pts: deltaResult.score > 0 ? Math.round(Math.abs(deltaResult.score) * 10) : 0,
        dove_pts: deltaResult.score < 0 ? Math.round(Math.abs(deltaResult.score) * 10) : 0,
        reasons: deltaResult.reasons.map(r => 'sep_delta:' + r),
      }),
    });
    if (updateResp.ok) updated++;
  }
  return { updated };
}

// ── Load existing scored items from DB to skip re-scoring ──
// Items with score=0 from press conferences/minutes are considered unscored and will be re-fetched
async function loadExistingItems(bank: string, sbUrl: string, sbKey: string): Promise<Set<string>> {
  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=title,item_date,net_score,source&bank=eq.${bank}&is_statistical=eq.false&limit=1000`,
      { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
    );
    if (!resp.ok) return new Set();
    const data = await resp.json();
    // Skip items with 0 score from policy documents — they need re-scoring
    // BUT always keep FOMC SEP as existing — they're scored by delta comparison, not AI
    const policyKeywords = ['minutes', 'press conf', 'statement', 'accounts', 'account', 'monetary policy decision', 'rate decision'];
    return new Set((data || [])
      .filter((d: any) => {
        const src = (d.source || '').toLowerCase();
        // FOMC SEP items are scored by delta, never re-score with generic AI
        if (src.includes('fomc sep')) return true;
        const hay = `${src} ${(d.title || '').toLowerCase()}`;
        const isPolicyDoc = policyKeywords.some(k => hay.includes(k));
        // If it's a policy doc with 0 score, don't mark as existing so it gets re-fetched
        if (isPolicyDoc && Math.abs(Number(d.net_score) || 0) < 0.001) return false;
        return true;
      })
      .map((d: any) => `${d.title}|${d.item_date}`));
  } catch { return new Set(); }
}

// ── Cross-source duplicate pruning in the DB ─────────────────────────────────
// The insert conflict key is (bank, source, title, item_date), so the SAME
// document arriving under two feed labels (e.g. "FOMC Statement — 07/29/2026"
// via the FOMC feed and "Federal Reserve issues FOMC statement" via Fed Press)
// lands as two rows and gets double counted. Group semantically and keep one.
const POLICY_DECISION_CLASS = /fomc statement|issues fomc statement|monetary policy decisions/i;
const NOT_DECISION = /press conference|q&amp;a|q&a|minutes|account|transcript/i;

function commGroupKey(it: { bank: string; source: string; item_date: string; title: string; url: string }): string {
  const hay = `${it.source} ${it.title}`;
  if (POLICY_DECISION_CLASS.test(hay) && !NOT_DECISION.test(hay)) {
    return `${it.bank}|${it.item_date}|CLASS:policy-decision`;
  }
  const u = canonicalUrl(it.url);
  if (u) return `${it.bank}|${it.item_date}|U:${u}`;
  return `${it.bank}|${it.item_date}|T:${normalizedTitle(it.title)}`;
}

interface DbRow { id: string; bank: string; source: string; item_date: string; title: string; url: string; net_score: number; word_count: number }

function preferDbRow(a: DbRow, b: DbRow): DbRow {
  const aScored = Math.abs(Number(a.net_score) || 0) > 0.001;
  const bScored = Math.abs(Number(b.net_score) || 0) > 0.001;
  if (aScored !== bScored) return aScored ? a : b;           // never keep an unscored twin
  const aT = documentTier(a.source || '', a.title || '');
  const bT = documentTier(b.source || '', b.title || '');
  if (aT !== bT) return aT < bT ? a : b;                      // more binding document wins
  const aEn = /\/en\//.test(a.url || '');
  const bEn = /\/en\//.test(b.url || '');
  if (aEn !== bEn) return aEn ? a : b;
  return (b.word_count || 0) > (a.word_count || 0) ? b : a;   // richer text wins
}

/** Delete cross-source duplicates of the same document from the DB. */
async function pruneDuplicateComms(bank: string, sbUrl: string, sbKey: string): Promise<number> {
  try {
    const hd = { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey };
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=id,bank,source,item_date,title,url,net_score,word_count&bank=eq.${bank}&is_statistical=eq.false&order=item_date.desc&limit=2000`,
      { headers: hd },
    );
    if (!resp.ok) return 0;
    const rows: DbRow[] = await resp.json();
    const keep = new Map<string, DbRow>();
    const drop: string[] = [];
    for (const r of rows) {
      const k = commGroupKey(r);
      const prev = keep.get(k);
      if (!prev) { keep.set(k, r); continue; }
      const win = preferDbRow(prev, r);
      keep.set(k, win);
      drop.push(win.id === prev.id ? r.id : prev.id);
    }
    for (let i = 0; i < drop.length; i += 50) {
      const ids = drop.slice(i, i + 50).map(id => `"${id}"`).join(',');
      await fetch(`${sbUrl}/rest/v1/sentiment_items?id=in.(${ids})`, { method: 'DELETE', headers: hd });
    }
    if (drop.length) console.log(`${bank}: pruned ${drop.length} cross-source duplicate communications`);
    return drop.length;
  } catch (e) {
    console.log('prune failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}

// ── Repair pass: re-score binding policy documents stuck at 0 ────────────────
// A decision/statement can never legitimately be 0. If an older row was left at
// 0 by a failed AI call it is re-fetched from its stored URL and re-scored.
const POLICY_TITLE_FOR_REPAIR = /monetary policy decision|monetary policy statement|fomc statement|rate decision|policy decision/i;

async function rescoreZeroPolicyDocs(bank: string, sbUrl: string, sbKey: string, aiKey: string): Promise<number> {
  try {
    const hd = { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey };
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=id,source,title,url,item_date,net_score&bank=eq.${bank}&is_statistical=eq.false&net_score=eq.0&order=item_date.desc&limit=600`,
      { headers: hd },
    );
    if (!resp.ok) return 0;
    const rows: { id: string; source: string; title: string; url: string; item_date: string }[] = await resp.json();
    const targets = rows.filter(r => r.url && POLICY_TITLE_FOR_REPAIR.test(`${r.source} ${r.title}`)).slice(0, 8);
    let fixed = 0;
    for (const r of targets) {
      const text = await fetchPageText(r.url);
      if (!text || text.length < 300) continue;
      const ai = await scoreWithAI(r.title, text, bank, aiKey, r.source);
      if (Math.abs(ai.score) < 0.001) continue;
      const patch = await fetch(`${sbUrl}/rest/v1/sentiment_items?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: { ...hd, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          net_score: ai.score,
          label: ai.label,
          hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
          dove_pts: ai.score < 0 ? Math.round(-ai.score * 10) : 0,
          reasons: ['ai:' + (ai.reasoning || 'rescored')],
          word_count: text.split(/\s+/).length,
        }),
      });
      if (patch.ok) { fixed++; console.log(`${bank}: rescored "${r.title}" (${r.item_date}) → ${ai.score}`); }
    }
    return fixed;
  } catch (e) {
    console.log('rescore repair failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}

// ── Repair pass: re-read transcripts/PDFs with the fixed extractor ───────────
// Rows scored before the PDF content streams were inflated were graded on
// unreadable fragments. This refetches the stored URL, extracts real prose and
// rescores; a document that still cannot be read is parked at 0 with an honest
// reason instead of an invented lean.
async function rescoreTranscripts(bank: string, sbUrl: string, sbKey: string, aiKey: string, limit = 12, onlyMissingRefs = false, onlyStaleRubric = false): Promise<number> {
  try {
    const hd = { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey };
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=id,source,title,url,item_date,net_score,reasons,policy_dimensions&bank=eq.${bank}&is_statistical=eq.false&order=item_date.desc&limit=400`,
      { headers: hd },
    );
    if (!resp.ok) return 0;
    const rows: { id: string; source: string; title: string; url: string; item_date: string; net_score: number; reasons: string[]; policy_dimensions?: Record<string, unknown> }[] = await resp.json();
    const suspect = /unavailable|truncated|redacted|garbled|could not|administrative|by their nature|assumed|without specific/i;
    const hasRefs = (r: typeof rows[number]) => {
      const audit = (r.policy_dimensions || {})['scoring_audit'] as { evidence_refs?: Record<string, unknown> } | undefined;
      return !!audit?.evidence_refs && Object.keys(audit.evidence_refs).length > 0;
    };
    // Rows scored under an older rubric version must be re-read so the published
    // score always reflects the current published methodology.
    const staleRubric = (r: typeof rows[number]) => {
      const audit = (r.policy_dimensions || {})['scoring_audit'] as { prompt_version?: string } | undefined;
      return (audit?.prompt_version ?? '') !== SCORING_PROMPT_VERSION;
    };
    const targets = rows
      .filter(r => r.url && (/\.pdf$/i.test(r.url) || /transcript|press conf|projections|minutes|account|statement|monetary policy/i.test(r.title)))
      .filter(r => onlyStaleRubric
        ? staleRubric(r) && Math.abs(Number(r.net_score) || 0) > 0.001
        : onlyMissingRefs
          // Backfill pass: scored documents that carry no page/line citations yet.
          ? !hasRefs(r) && Math.abs(Number(r.net_score) || 0) > 0.05
          : suspect.test((r.reasons || []).join(' ')) || !(r.reasons || []).length)
      .slice(0, limit);

    let fixed = 0;
    for (const r of targets) {
      const text = await fetchPageText(r.url);
      const ai = await scoreWithAI(r.title, text, bank, aiKey, r.source);
      // A citation backfill must never destroy an existing score: if the re-read
      // comes back unscoreable, leave the stored row untouched.
      if ((onlyMissingRefs || onlyStaleRubric) && !ai.dimensions) continue;

      const patch = await fetch(`${sbUrl}/rest/v1/sentiment_items?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: { ...hd, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          net_score: ai.score,
          label: ai.label,
          hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
          dove_pts: ai.score < 0 ? Math.round(-ai.score * 10) : 0,
          reasons: ['ai:' + (ai.reasoning || 'rescored')],
          word_count: text ? text.split(/\s+/).length : 0,
          policy_dimensions: ai.dimensions ? { ...ai.dimensions, scoring_audit: ai.audit } : null,
        }),
      });
      if (patch.ok) { fixed++; console.log(`${bank}: re-read "${r.title}" (${r.item_date}) → ${ai.score}`); }
    }
    return fixed;
  } catch (e) {
    console.log('transcript repair failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}


// ── Load existing STATISTICAL items for dedup ──
async function loadExistingStatItems(bank: string, sbUrl: string, sbKey: string): Promise<It[]> {
  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=bank,source,item_date,title,url,is_statistical,hawk_pts,dove_pts,net_score,label,word_count,reasons,stat_metric,stat_value,stat_weight&bank=eq.${bank}&is_statistical=eq.true&limit=500`,
      { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).map((d: any) => ({
      bank: d.bank, source: d.source, item_date: d.item_date, title: d.title,
      url: d.url || '', is_statistical: d.is_statistical,
      hawk_pts: d.hawk_pts || 0, dove_pts: d.dove_pts || 0, net_score: Number(d.net_score) || 0,
      label: d.label || 'neutral', word_count: d.word_count || 0, reasons: d.reasons || [],
      stat_metric: d.stat_metric, stat_value: d.stat_value != null ? Number(d.stat_value) : null, stat_weight: Number(d.stat_weight) || 0,
    } as It));
  } catch { return []; }
}

// ── Load ALL existing items from DB for aggregation ──
async function loadAllItemsForAggregation(bank: string, sbUrl: string, sbKey: string): Promise<It[]> {
  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=bank,source,item_date,title,url,is_statistical,hawk_pts,dove_pts,net_score,label,word_count,reasons,stat_metric,stat_value,stat_weight&bank=eq.${bank}&limit=1000`,
      { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).map((d: any) => ({
      bank: d.bank, source: d.source, item_date: d.item_date, title: d.title,
      url: d.url || '', is_statistical: d.is_statistical,
      hawk_pts: d.hawk_pts || 0, dove_pts: d.dove_pts || 0, net_score: Number(d.net_score) || 0,
      label: d.label || 'neutral', word_count: d.word_count || 0, reasons: d.reasons || [],
      stat_metric: d.stat_metric, stat_value: d.stat_value != null ? Number(d.stat_value) : null, stat_weight: Number(d.stat_weight) || 0,
    } as It));
  } catch { return []; }
}

// ── FRED (Fed Funds EXCLUDED — it's the target variable, not a predictor) ──
interface FS { id: string; met: string; tr: string; ht: number; dt: number; dir: string; w: number }
const FR: FS[] = [
  { id: 'CPIAUCSL', met: 'CPI YoY', tr: 'p12', ht: 3, dt: 2, dir: 'hh', w: 3 },
  { id: 'CPIAUCSL', met: 'CPI MoM Trend', tr: 'p1', ht: 0.4, dt: 0.1, dir: 'hh', w: 2 },
  { id: 'CPILFESL', met: 'Core CPI YoY', tr: 'p12', ht: 3, dt: 2, dir: 'hh', w: 3 },
  { id: 'PAYEMS', met: 'Payrolls MoM', tr: 'd1', ht: 200, dt: 100, dir: 'hh', w: 3 },
  { id: 'UNRATE', met: 'Unemployment', tr: 'lv', ht: 4, dt: 5, dir: 'lh', w: 3 },
  { id: 'PCEPILFE', met: 'Core PCE YoY', tr: 'p12', ht: 2.5, dt: 2, dir: 'hh', w: 3 },
  // FEDFUNDS removed — it's what we're trying to predict, not a leading indicator
  { id: 'RSAFS', met: 'Retail Sales', tr: 'p1', ht: 0.5, dt: -0.2, dir: 'hh', w: 2 },
  { id: 'INDPRO', met: 'Ind Prod', tr: 'p1', ht: 0.3, dt: -0.3, dir: 'hh', w: 2 },
  { id: 'MANEMP', met: 'Mfg Employment Trend', tr: 'p1', ht: 0.3, dt: -0.3, dir: 'hh', w: 2 },
  // Higher-frequency releases so the US channel never goes stale between monthly prints
  { id: 'ICSA', met: 'Initial Claims (4wk chg)', tr: 'd1', ht: -15000, dt: 15000, dir: 'lh', w: 2 },
  { id: 'CES0500000003', met: 'Avg Hourly Earnings YoY', tr: 'p12', ht: 4, dt: 3, dir: 'hh', w: 2 },
  { id: 'T5YIE', met: '5Y Breakeven Inflation', tr: 'lv', ht: 2.5, dt: 2, dir: 'hh', w: 2 },
  { id: 'T10Y2Y', met: '10Y-2Y Spread', tr: 'lv', ht: 0.6, dt: -0.2, dir: 'hh', w: 1 },
];

/** Latest publication (release) date per FRED series — observation dates are period starts. */
async function fetchFredReleaseDates(key: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.allSettled(ids.map(async id => {
    const r = await sf(`https://api.stlouisfed.org/fred/series?series_id=${id}&api_key=${key}&file_type=json`);
    if (!r || !r.ok) return;
    const d = await r.json();
    const lu: string | undefined = d?.seriess?.[0]?.last_updated;
    if (lu) out[id] = lu.slice(0, 10);
  }));
  return out;
}

async function fetchFred(key: string, days: number): Promise<It[]> {
  const co = new Date(); co.setDate(co.getDate() - days);
  const cs = co.toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  // Deduplicate by series ID to avoid fetching same series twice (e.g. CPI YoY + CPI MoM)
  const uniqueSeriesIds = [...new Set(FR.map(s => s.id))];
  const seriesCache: Record<string, any[]> = {};

  // Fetch each unique series once, plus its publication date
  const [, releaseDates] = await Promise.all([
    Promise.allSettled(uniqueSeriesIds.map(async id => {
      const r = await sf('https://api.stlouisfed.org/fred/series/observations?series_id=' + id + '&api_key=' + key + '&file_type=json&sort_order=desc&limit=15');
      if (!r || !r.ok) return;
      const d = await r.json();
      seriesCache[id] = (d.observations || []).filter((o: any) => o.value !== '.');
    })),
    fetchFredReleaseDates(key, uniqueSeriesIds),
  ]);

  const results: It[] = [];
  for (const s of FR) {
    const obs = seriesCache[s.id];
    if (!obs || !obs.length) continue;
    // Score by RELEASE date (when markets saw it), not by the reference period.
    const period = obs[0].date as string;
    const released = releaseDates[s.id] && releaseDates[s.id] <= today ? releaseDates[s.id] : period;
    if (released < cs) continue;
    const v = obs.map((o: any) => parseFloat(o.value));
    let val: number | null = null;
    if (s.tr === 'lv') val = v[0];
    else if (s.tr === 'd1' && v.length >= 2) val = v[0] - v[1];
    else if (s.tr === 'p1' && v.length >= 2 && v[1] !== 0) val = ((v[0] - v[1]) / Math.abs(v[1])) * 100;
    else if (s.tr === 'p12' && v.length >= 13 && v[12] !== 0) val = ((v[0] - v[12]) / Math.abs(v[12])) * 100;
    if (val === null) continue;
    const r2 = sv(val, s.ht, s.dt, s.dir, s.w, s.met);
    results.push({
      bank: 'FED', source: 'FRED', item_date: released,
      title: s.met + ': ' + val.toFixed(2) + ' (' + s.id + ', ref ' + period + ')',
      url: 'https://fred.stlouisfed.org/series/' + s.id,
      is_statistical: true, hawk_pts: 0, dove_pts: 0,
      net_score: r2.net_score, label: r2.label, word_count: 0,
      reasons: ['fred', 'released:' + released, 'period:' + period], stat_metric: r2.metric, stat_value: r2.value, stat_weight: s.w,
    } as It);
  }
  return results;
}

/**
 * Historical backfill of the US statistical channel.
 * The live fetch only keeps the newest vintage of each series, so months where our
 * scraper was broken end up with no statistical items at all. ALFRED's
 * `output_type=4` returns each observation's FIRST release together with the real
 * publication date (`realtime_start`), which lets us rebuild the true history.
 */
async function backfillFred(key: string, fromDate: string): Promise<It[]> {
  const today = new Date().toISOString().split('T')[0];
  const uniqueSeriesIds = [...new Set(FR.map(s => s.id))];
  // period -> { value, released } per series, ordered oldest → newest
  const hist: Record<string, { period: string; value: number; released: string }[]> = {};

  await Promise.allSettled(uniqueSeriesIds.map(async id => {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}` +
      `&file_type=json&output_type=4&realtime_start=2024-01-01&observation_start=2023-01-01&sort_order=asc`;
    const r = await sf(url, 20000);
    if (!r || !r.ok) return;
    const d = await r.json();
    const rows: { period: string; value: number; released: string }[] = [];
    for (const o of (d.observations || [])) {
      if (o.value === '.' || o.value === undefined) continue;
      const v = parseFloat(o.value);
      if (!isFinite(v)) continue;
      const released = (o.realtime_start && o.realtime_start !== '1776-07-04') ? o.realtime_start : o.date;
      rows.push({ period: o.date, value: v, released: released > today ? today : released });
    }
    hist[id] = rows;
  }));

  const out: It[] = [];
  for (const s of FR) {
    const rows = hist[s.id];
    if (!rows || rows.length < 14) continue;
    for (let i = 13; i < rows.length; i++) {
      const cur = rows[i];
      if (cur.released < fromDate || cur.released > today) continue;
      const v = [cur.value, ...rows.slice(0, i).reverse().map(r => r.value)]; // newest → oldest
      let val: number | null = null;
      if (s.tr === 'lv') val = v[0];
      else if (s.tr === 'd1' && v.length >= 2) val = v[0] - v[1];
      else if (s.tr === 'p1' && v.length >= 2 && v[1] !== 0) val = ((v[0] - v[1]) / Math.abs(v[1])) * 100;
      else if (s.tr === 'p12' && v.length >= 13 && v[12] !== 0) val = ((v[0] - v[12]) / Math.abs(v[12])) * 100;
      if (val === null || !isFinite(val)) continue;
      const r2 = sv(val, s.ht, s.dt, s.dir, s.w, s.met);
      out.push({
        bank: 'FED', source: 'FRED', item_date: cur.released,
        title: s.met + ': ' + val.toFixed(2) + ' (' + s.id + ', ref ' + cur.period + ')',
        url: 'https://fred.stlouisfed.org/series/' + s.id,
        is_statistical: true, hawk_pts: 0, dove_pts: 0,
        net_score: r2.net_score, label: r2.label, word_count: 0,
        reasons: ['fred', 'backfill', 'released:' + cur.released, 'period:' + cur.period],
        stat_metric: r2.metric, stat_value: r2.value, stat_weight: s.w,
      } as It);
    }
  }
  console.log(`FRED backfill: ${out.length} historical statistical items since ${fromDate}`);
  return out;
}



// ── FOMC Minutes ──
const KNOWN_FOMC_DATES = [
  '20260128','20260318','20260506','20260617','20260729','20260917','20261028','20261216',
  '20250129','20250319','20250507','20250618','20250730','20250917','20251029','20251210',
];

async function fetchFomcMinutes(cutoffDate: string): Promise<{ title: string; text: string; date: string; url: string }[]> {
  const items: { title: string; text: string; date: string; url: string }[] = [];
  const now = new Date();
  const cutoff = new Date(cutoffDate);
  const relevantDates = KNOWN_FOMC_DATES.filter(ds => {
    const y = parseInt(ds.slice(0, 4)), m = parseInt(ds.slice(4, 6)) - 1, day = parseInt(ds.slice(6, 8));
    const meetDate = new Date(y, m, day);
    return meetDate >= cutoff && meetDate <= now;
  });
  console.log('FOMC Minutes: checking ' + relevantDates.length + ' dates');
  const results = await Promise.allSettled(relevantDates.map(async (dateStr) => {
    const url = 'https://www.federalreserve.gov/monetarypolicy/fomcminutes' + dateStr + '.htm';
    const r = await sf(url, 12000);
    if (!r || !r.ok) return null;
    const html = await r.text();
    if (html.toLowerCase().includes('page not found') || html.length < 2000) return null;
    const text = extractText(html);
    if (text.length < 500) return null;
    console.log('FOMC Minutes found: ' + dateStr + ' (' + text.length + ' chars)');
    const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), day = dateStr.slice(6, 8);
    return { title: 'FOMC Minutes — ' + m + '/' + day + '/' + y, text, date: y + '-' + m + '-' + day, url };
  }));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) items.push(r.value);
  }
  return items;
}

// ── FOMC Press Conference Transcript PDFs ──
async function fetchFomcPressConferences(cutoffDate: string): Promise<{ title: string; text: string; date: string; url: string }[]> {
  const items: { title: string; text: string; date: string; url: string }[] = [];
  const now = new Date();
  const cutoff = new Date(cutoffDate);
  const relevantDates = KNOWN_FOMC_DATES.filter(ds => {
    const y = parseInt(ds.slice(0, 4)), m = parseInt(ds.slice(4, 6)) - 1, day = parseInt(ds.slice(6, 8));
    const meetDate = new Date(y, m, day);
    return meetDate >= cutoff && meetDate <= now;
  });
  console.log('FOMC Press Conf+Statement+SEP: checking ' + relevantDates.length + ' dates');
  const results = await Promise.allSettled(relevantDates.map(async (dateStr) => {
    const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), day = dateStr.slice(6, 8);
    const foundItems: { title: string; text: string; date: string; url: string }[] = [];

    // 1. Try the FOMC monetary policy statement (always available day-of)
    const stmtUrl = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary' + dateStr + 'a.htm';
    const stmtResp = await sf(stmtUrl, 12000);
    if (stmtResp && stmtResp.ok) {
      const html = await stmtResp.text();
      if (!html.toLowerCase().includes('page not found') && html.length > 1000) {
        const text = extractText(html);
        if (text.length >= 200) {
          console.log('FOMC Statement found: ' + dateStr + ' (' + text.length + ' chars)');
          foundItems.push({ title: 'FOMC Statement — ' + m + '/' + day + '/' + y, text, date: y + '-' + m + '-' + day, url: stmtUrl });
        }
      }
    }

    // 2. Try the press conference transcript PDF — inflated content streams,
    //    and only accepted when the extracted text is real prose.
    const pdfUrl = 'https://www.federalreserve.gov/mediacenter/files/FOMCpresconf' + dateStr + '.pdf';
    const pdfResp = await sf(pdfUrl, 20000);
    if (pdfResp && pdfResp.ok) {
      const ct = pdfResp.headers.get('content-type') || '';
      if (ct.includes('pdf')) {
        const pdfText = await extractPdfText(new Uint8Array(await pdfResp.arrayBuffer()));
        if (isReadableProse(pdfText)) {
          console.log('FOMC Press Conf PDF found: ' + dateStr + ' (' + pdfText.length + ' chars)');
          foundItems.push({ title: 'FOMC Press Conference Transcript — ' + m + '/' + day + '/' + y, text: pdfText, date: y + '-' + m + '-' + day, url: pdfUrl });
        } else {
          console.log('FOMC Press Conf PDF not readable prose: ' + dateStr + ' (' + pdfText.length + ' chars)');
        }
      }
    }

    // 3. Try the press conference HTML page as fallback
    if (!foundItems.some(f => f.title.includes('Transcript'))) {
      const pcUrl = 'https://www.federalreserve.gov/monetarypolicy/fomcpressconf' + dateStr + '.htm';
      const pcResp = await sf(pcUrl, 12000);
      if (pcResp && pcResp.ok) {
        const pcHtml = await pcResp.text();
        if (!pcHtml.toLowerCase().includes('page not found') && pcHtml.length > 2000) {
          const pcText = extractText(pcHtml);
          if (isReadableProse(pcText)) {
            console.log('FOMC Press Conf HTML page found: ' + dateStr + ' (' + pcText.length + ' chars)');
            foundItems.push({ title: 'FOMC Press Conference Transcript — ' + m + '/' + day + '/' + y, text: pcText, date: y + '-' + m + '-' + day, url: pcUrl });
          }
        }

      }
    }

    // 4. Summary of Economic Projections (SEP) — try HTML first, then PDF
    // SEP is only published at projection meetings (March, June, September, December)
    const SEP_MONTHS = ['03', '06', '09', '12'];
    if (SEP_MONTHS.includes(m)) {
      const sepHtmlUrl = 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl' + dateStr + '.htm';
      const sepPdfUrl = 'https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl' + dateStr + '.pdf';
      let sepText = '';
      let sepFinalUrl = sepHtmlUrl;

      // Try HTML page first (much better text extraction)
      const sepHtmlResp = await sf(sepHtmlUrl, 12000);
      if (sepHtmlResp && sepHtmlResp.ok) {
        const html = await sepHtmlResp.text();
        if (!html.toLowerCase().includes('page not found') && html.length > 1000) {
          sepText = extractText(html);
        }
      }

      // Fallback to PDF if HTML failed
      if (sepText.length < 500) {
        const sepResp = await sf(sepPdfUrl, 15000);
        if (sepResp && sepResp.ok) {
          const ct = sepResp.headers.get('content-type') || '';
          if (ct.includes('pdf')) {
            sepText = await extractPdfText(new Uint8Array(await sepResp.arrayBuffer()));
            sepFinalUrl = sepPdfUrl;
          }

        }
      }

      if (sepText.length > 200) {
        console.log('FOMC SEP found: ' + dateStr + ' (' + sepText.length + ' chars, ' + (sepFinalUrl.endsWith('.htm') ? 'HTML' : 'PDF') + ')');
        foundItems.push({ title: 'FOMC Summary of Economic Projections — ' + m + '/' + day + '/' + y, text: sepText, date: y + '-' + m + '-' + day, url: sepFinalUrl });
      }
    }

    return foundItems;
  }));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) items.push(...r.value);
  }
  return items;
}

// ── ECB Press Conferences (Monetary Policy Statement) ──
// Known ECB Governing Council meeting dates for press conferences
const KNOWN_ECB_DATES = [
  '250130', '250306', '250417', '250605', '250724', '250911', '251030', '251218',
  '260205', '260319', '260430', '260611', '260723', '260910', '261029', '261217',
];

async function fetchEcbPressConferences(cutoffDate: string, aiKey: string): Promise<{ title: string; text: string; date: string; url: string }[]> {
  const items: { title: string; text: string; date: string; url: string }[] = [];
  const now = new Date();

  // ECB monetary policy statement URLs contain a hash we can't guess.
  // Strategy 1: Fetch year-specific include files which list all statements with full URLs.
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear - 1];

  try {
    const includeResults = await Promise.allSettled(years.map(async (yr) => {
      const includeUrl = `https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/${yr}/html/index_include.en.html`;
      const r = await sf(includeUrl, 15000);
      if (!r || !r.ok) { console.log('ECB include file not found for ' + yr); return []; }
      const html = await r.text();
      
      const linkRe = /href="([^"]*ecb\.is\d{6}~[^"]*\.en\.html)"/gi;
      let m;
      const links: { url: string; dateStr: string }[] = [];
      while ((m = linkRe.exec(html)) !== null) {
        let link = m[1];
        if (!link.startsWith('http')) link = 'https://www.ecb.europa.eu' + link;
        const dateMatch = link.match(/ecb\.is(\d{2})(\d{2})(\d{2})/);
        if (dateMatch) {
          const fullDate = '20' + dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
          if (fullDate >= cutoffDate && new Date(fullDate) <= now) {
            links.push({ url: link, dateStr: fullDate });
          }
        }
      }
      return links;
    }));

    const allLinksRaw: { url: string; dateStr: string }[] = [];
    for (const r of includeResults) {
      if (r.status === 'fulfilled') allLinksRaw.push(...r.value);
    }
    // Deduplicate by date (same meeting can appear in multiple year files)
    const seenDates = new Set<string>();
    const allLinks: { url: string; dateStr: string }[] = [];
    for (const l of allLinksRaw) {
      if (!seenDates.has(l.dateStr)) {
        seenDates.add(l.dateStr);
        allLinks.push(l);
      }
    }
    console.log('ECB Press Conf: found ' + allLinks.length + ' unique statement links from include files');

    // Fetch each statement page
    const fetchResults = await Promise.allSettled(allLinks.slice(0, 10).map(async ({ url, dateStr }) => {
      const r = await sf(url, 12000);
      if (!r || !r.ok) return null;
      const pageHtml = await r.text();
      const text = extractText(pageHtml);
      if (text.length < 500) return null;
      
      const parts = dateStr.split('-');
      console.log('ECB Press Conf found: ' + dateStr + ' (' + text.length + ' chars)');
      return {
        title: 'ECB Monetary Policy Press Conference — ' + parts[1] + '/' + parts[2] + '/' + parts[0],
        text, date: dateStr, url,
      };
    }));
    for (const r of fetchResults) {
      if (r.status === 'fulfilled' && r.value) items.push(r.value);
    }
  } catch (e) { console.error('ECB press conf include files:', e); }

  // Strategy 2: If include files yielded nothing, use AI to search for ECB press conference URLs
  if (items.length === 0 && aiKey) {
    console.log('ECB Press Conf: include files empty, trying AI search for URLs');
    try {
      const relevantDates = KNOWN_ECB_DATES.filter(ds => {
        const yr = '20' + ds.slice(0, 2), mn = ds.slice(2, 4), dy = ds.slice(4, 6);
        const fullDate = yr + '-' + mn + '-' + dy;
        return fullDate >= cutoffDate && new Date(fullDate) <= now;
      });

      // Ask AI to find the URLs for each known meeting date
      const searchPrompt = `Find the exact URLs for ECB monetary policy press conference transcripts (the full Q&A text, not video) for these meeting dates: ${relevantDates.map(d => '20' + d.slice(0,2) + '-' + d.slice(2,4) + '-' + d.slice(4,6)).join(', ')}.

The URLs typically follow patterns like:
- https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/YYYY/html/ecb.isYYMMDD~HASH.en.html
- https://www.ecb.europa.eu/press/pressconf/YYYY/html/ecb.isYYMMDD~HASH.en.html

Respond with ONLY a JSON array of objects: [{"date": "YYYY-MM-DD", "url": "full_url"}]`;

      const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: searchPrompt }],
        }),
      });

      if (aiResp.ok) {
        const aiData = await aiResp.json();
        let content = aiData.choices?.[0]?.message?.content || '';
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        try {
          const urls: { date: string; url: string }[] = JSON.parse(content);
          console.log('ECB AI search returned ' + urls.length + ' URLs');
          
          const fetchResults = await Promise.allSettled(urls.slice(0, 8).map(async ({ date, url }) => {
            const r = await sf(url, 12000);
            if (!r || !r.ok) { console.log('ECB AI URL failed: ' + url); return null; }
            const pageHtml = await r.text();
            if (pageHtml.toLowerCase().includes('page not found')) return null;
            const text = extractText(pageHtml);
            if (text.length < 500) return null;
            const parts = date.split('-');
            console.log('ECB Press Conf (AI search): ' + date + ' (' + text.length + ' chars)');
            return {
              title: 'ECB Monetary Policy Press Conference — ' + parts[1] + '/' + parts[2] + '/' + parts[0],
              text, date, url,
            };
          }));
          for (const r of fetchResults) {
            if (r.status === 'fulfilled' && r.value) items.push(r.value);
          }
        } catch (e) { console.error('ECB AI URL parse error:', e); }
      }
    } catch (e) { console.error('ECB AI search error:', e); }
  }

  return items;
}

// ── ECB Monetary Policy Accounts (Meeting Minutes equivalent) ──
// Published ~4 weeks after each Governing Council meeting
async function fetchEcbAccounts(cutoffDate: string): Promise<{ title: string; text: string; date: string; url: string }[]> {
  const items: { title: string; text: string; date: string; url: string }[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear - 1];

  try {
    const includeResults = await Promise.allSettled(years.map(async (yr) => {
      const includeUrl = `https://www.ecb.europa.eu/press/accounts/${yr}/html/index_include.en.html`;
      const r = await sf(includeUrl, 15000);
      if (!r || !r.ok) { console.log('ECB accounts include file not found for ' + yr); return []; }
      const html = await r.text();

      // Match links to account pages: ecb.mg{YYMMDD}~HASH.en.html
      const linkRe = /href="([^"]*ecb\.mg\d{6}~[^"]*\.en\.html)"/gi;
      let m;
      const links: { url: string; dateStr: string }[] = [];
      while ((m = linkRe.exec(html)) !== null) {
        let link = m[1];
        if (!link.startsWith('http')) link = 'https://www.ecb.europa.eu' + link;
        const dateMatch = link.match(/ecb\.mg(\d{2})(\d{2})(\d{2})/);
        if (dateMatch) {
          const fullDate = '20' + dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
          if (fullDate >= cutoffDate && new Date(fullDate) <= now) {
            links.push({ url: link, dateStr: fullDate });
          }
        }
      }
      return links;
    }));

    const allLinksRaw: { url: string; dateStr: string }[] = [];
    for (const r of includeResults) {
      if (r.status === 'fulfilled') allLinksRaw.push(...r.value);
    }
    const seenDates = new Set<string>();
    const allLinks: { url: string; dateStr: string }[] = [];
    for (const l of allLinksRaw) {
      if (!seenDates.has(l.dateStr)) {
        seenDates.add(l.dateStr);
        allLinks.push(l);
      }
    }
    console.log('ECB Accounts: found ' + allLinks.length + ' unique account links from include files');

    const fetchResults = await Promise.allSettled(allLinks.slice(0, 12).map(async ({ url, dateStr }) => {
      const r = await sf(url, 15000);
      if (!r || !r.ok) return null;
      const pageHtml = await r.text();
      const text = extractText(pageHtml);
      if (text.length < 500) return null;

      const parts = dateStr.split('-');
      console.log('ECB Account found: ' + dateStr + ' (' + text.length + ' chars)');
      return {
        title: 'ECB Monetary Policy Account — ' + parts[1] + '/' + parts[2] + '/' + parts[0],
        text, date: dateStr, url,
      };
    }));
    for (const r of fetchResults) {
      if (r.status === 'fulfilled' && r.value) items.push(r.value);
    }
  } catch (e) { console.error('ECB accounts scrape error:', e); }

  return items;
}

// ── AI-Powered Media Interview Scraper ──
// Uses Gemini to find recent central banker media interviews (Reuters, Bloomberg, FT etc.)
async function fetchMediaInterviews(bank: string, aiKey: string, existingTitles: Set<string>): Promise<RawComm[]> {
  if (!aiKey) return [];
  const items: RawComm[] = [];
  
  const governors = bank === 'ECB' 
    ? ['Nagel (Bundesbank)', 'Villeroy de Galhau (Banque de France)', 'Knot (DNB)', 'Centeno (Bank of Portugal)', 'Holzmann (OeNB Austria)']
    : ['Goolsbee (Chicago Fed)', 'Bostic (Atlanta Fed)', 'Daly (SF Fed)', 'Williams (NY Fed)', 'Kashkari (Minneapolis Fed)'];
  
  const today = new Date().toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  
  const searchPrompt = `Find the most important recent (${twoWeeksAgo} to ${today}) monetary policy comments made by ${bank === 'ECB' ? 'ECB Governing Council members' : 'Federal Reserve officials'} in media interviews, press conferences, or public remarks.

Focus on: ${governors.join(', ')}

For each comment, provide:
- speaker: full name
- date: YYYY-MM-DD format  
- headline: what they said (include the media outlet if known)
- summary: 2-3 sentences of what they said about monetary policy
- sentiment: hawkish/dovish/neutral
- score: -1.0 to 1.0

Only include comments about monetary policy (rates, inflation, growth outlook).
Skip ceremonial, administrative, or non-monetary remarks.
Only include items you are confident actually happened — do NOT fabricate.

Respond with ONLY a JSON array (no markdown):
[{"speaker":"...","date":"YYYY-MM-DD","headline":"...","summary":"...","sentiment":"...","score":0.0}]
Return empty array [] if no significant remarks found.`;

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: searchPrompt }],
      }),
    });

    if (!resp.ok) { console.error('Media interview search failed:', resp.status); return []; }
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    const remarks: { speaker: string; date: string; headline: string; summary: string; sentiment: string; score: number }[] = JSON.parse(content);
    console.log('Media interview search (' + bank + '): found ' + remarks.length + ' remarks');
    
    for (const remark of remarks) {
      if (!remark.date || !/^\d{4}-\d{2}-\d{2}$/.test(remark.date)) continue;
      const d = new Date(remark.date);
      if (isNaN(d.getTime()) || d.getFullYear() < 2024) continue;
      
      const titleKey = remark.headline + '|' + remark.date;
      if (existingTitles.has(titleKey)) continue;
      
      items.push({
        title: remark.headline,
        text: remark.summary,
        date: remark.date,
        url: '',
        source: bank === 'ECB' ? 'GC Member Remark' : 'Fed Official Remark',
        bank,
      });
    }
  } catch (e) { console.error('Media interview search error:', e); }
  
  return items;
}

// ── Patterns to reclassify as statistical (not commentary) ──
const STATISTICAL_RECLASSIFY_PATTERNS = [
  /consumer\s+expectations?\s+survey/i,
  /bank\s+lending\s+survey/i,
  /survey\s+of\s+professional\s+forecasters/i,
];

function shouldReclassifyAsStatistical(title: string): boolean {
  return STATISTICAL_RECLASSIFY_PATTERNS.some(p => p.test(title));
}

// ── RSS feeds — returns raw items with text ──
const SKIP = new Set(['enforcement actions', 'orders on banking applications', 'other announcements', 'banking and consumer regulatory policy', 'community development']);
const MINUTES_SKIP = /minutes/i;
const PRESS_CONF_SKIP = /press\s*conference/i;

interface RawComm { title: string; text: string; date: string; url: string; source: string; bank: string }

async function fetchRssRaw(cs: string, bank: string): Promise<RawComm[]> {
  const items: RawComm[] = [];
  const feeds = bank === 'FED'
    ? [
        { url: 'https://www.federalreserve.gov/feeds/speeches.xml', lbl: 'Fed Speech' },
        { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', lbl: 'Fed Monetary' },
        { url: 'https://www.federalreserve.gov/feeds/press_all.xml', lbl: 'Fed Press' },
      ]
    : [
        { url: 'https://www.ecb.europa.eu/rss/press.html', lbl: 'ECB Press' },
        { url: 'https://www.ecb.europa.eu/rss/blog.html', lbl: 'ECB Blog' },
        // Note: ECB speeches.html is HTML, not RSS — individual speeches come via speaker-scraper & media interviews
        // Bundesbank speeches, interviews and contributions (verified RSS feed)
        { url: 'https://www.bundesbank.de/service/rss/en/633296/feed.rss', lbl: 'Bundesbank Speech' },
      ];

  const res = await Promise.allSettled(feeds.map(async f => {
    const r = await sf(f.url);
    if (!r || !r.ok) return [];
    let xml = await r.text();
    xml = xml.replace(new RegExp('&(?!amp;|lt;|gt;|quot;|apos;|#)', 'g'), '&amp;');
    let rssItems = pi(xml).map(ri => ({ title: ri.title, link: ri.link, pubDate: ri.pubDate, cat: ri.cat }));
    if (!rssItems.length) {
      rssItems = ae(xml).map(e => ({ title: e.title, link: e.link, pubDate: e.updated, cat: '' }));
    }
    const filtered = rssItems.filter(ri => {
      const p = td(ri.pubDate);
      if (!p || p < cs) return false;
      if (f.lbl === 'Fed Press' && SKIP.has(ri.cat)) return false;
      if (bank === 'FED' && MINUTES_SKIP.test(ri.title)) return false;
      if (bank === 'FED' && PRESS_CONF_SKIP.test(ri.title)) return false; // handled separately
      // Skip FOMC statement from Fed Monetary — already captured by Fed Press
      if (f.lbl === 'Fed Monetary' && /FOMC\s+statement/i.test(ri.title)) return false;
      // Skip economic projections from Fed Press — already captured by Fed Monetary (or SEP scraper)
      if (f.lbl === 'Fed Press' && /economic\s+projections?\s+from/i.test(ri.title)) return false;
      return true;
    }).slice(0, 50);

    const rawComms: RawComm[] = [];
    for (let i = 0; i < filtered.length; i += 5) {
      const batch = filtered.slice(i, i + 5);
      const textResults = await Promise.allSettled(
        batch.map(ri => ri.link ? fetchPageText(ri.link) : Promise.resolve(''))
      );
      for (let j = 0; j < batch.length; j++) {
        const ri = batch[j];
        const pub = td(ri.pubDate)!;
        const pageText = textResults[j].status === 'fulfilled' ? textResults[j].value : '';
        rawComms.push({ title: ri.title, text: pageText, date: pub, url: ri.link, source: f.lbl, bank });
      }
    }
    return rawComms;
  }));

  for (const r of res) if (r.status === 'fulfilled') items.push(...r.value);
  return items;
}

// ── ECB Stats + Eurostat ──
interface SR { pattern: string; met: string; ht: number | null; dt: number | null; dir: string; w: number }
const EU: SR[] = [
  { pattern: 'government deficit', met: 'Gov Deficit', ht: 4.0, dt: 2.5, dir: 'hh', w: 0.5 },
  { pattern: 'government debt', met: 'Gov Debt', ht: null, dt: null, dir: 'hh', w: 0 },
  { pattern: 'industrial production', met: 'Ind Prod', ht: 0.5, dt: -0.5, dir: 'hh', w: 2 },
  { pattern: 'production in construction', met: 'Construction', ht: 0.5, dt: -0.5, dir: 'hh', w: 2 },
  { pattern: 'inflation', met: 'HICP', ht: 2.5, dt: 1.8, dir: 'hh', w: 3 },
  { pattern: 'gdp', met: 'GDP', ht: 0.4, dt: 0.1, dir: 'hh', w: 3 },
  { pattern: 'unemployment', met: 'Unemployment', ht: 6, dt: 7.5, dir: 'lh', w: 3 },
  { pattern: 'producer prices', met: 'PPI', ht: 0.5, dt: -0.3, dir: 'hh', w: 2 },
  { pattern: 'retail trade', met: 'Retail', ht: 0.5, dt: -0.3, dir: 'hh', w: 2 },
  { pattern: 'purchasing managers', met: 'PMI', ht: 52, dt: 48, dir: 'hh', w: 2 },
  { pattern: 'pmi', met: 'PMI', ht: 52, dt: 48, dir: 'hh', w: 2 },
];

function ss(title: string): { ns: number; lb: string; met: string; val: number | null; w: number } | null {
  const tl = title.toLowerCase();
  for (const r of EU) {
    if (!tl.includes(r.pattern)) continue;
    const v = xn(title);
    if (v !== null && r.ht !== null && r.dt !== null) {
      const s = sv(v, r.ht, r.dt, r.dir, r.w, r.met);
      return { ns: s.net_score, lb: s.label, met: s.metric, val: s.value, w: r.w };
    }
    break;
  }
  return null;
}

// ── Dedup inflation/stat prints within same month ──
// If two items have the same stat_metric and same stat_value and same month, keep only the first
// Also checks against existing DB items
function deduplicateStatItems(items: It[], existingDbItems: It[] = []): It[] {
  const seen = new Map<string, It>(); // key: "metric|YYYY-MM|value"
  // Pre-seed with existing DB items so new duplicates are caught
  for (const it of existingDbItems) {
    if (it.is_statistical && it.stat_metric && it.stat_value !== null && Math.abs(it.net_score) > 0.001) {
      const month = it.item_date.slice(0, 7);
      const key = `${it.stat_metric}|${month}|${it.stat_value}`;
      if (!seen.has(key)) seen.set(key, it);
    }
  }
  const result: It[] = [];
  for (const it of items) {
    if (it.is_statistical && it.stat_metric) {
      const month = it.item_date.slice(0, 7);
      const key = `${it.stat_metric}|${month}|${it.stat_value}`;
      if (seen.has(key) && seen.get(key)!.item_date !== it.item_date) {
        // Duplicate — mark it with zero score and note
        const dup = { ...it, net_score: 0, label: 'neutral', reasons: ['duplicate: already counted in ' + seen.get(key)!.item_date], stat_weight: 0 };
        result.push(dup);
        console.log('Dedup: "' + it.title + '" same as earlier ' + seen.get(key)!.item_date + ' print');
      } else {
        // Check if same metric, same month but DIFFERENT value (revised estimate)
        const existingForMonth = [...result, ...existingDbItems].find(r => 
          r.is_statistical && r.stat_metric === it.stat_metric && 
          r.item_date.slice(0, 7) === month && r.stat_value !== it.stat_value &&
          Math.abs(r.net_score) > 0.001
        );
        if (existingForMonth) {
          const revision = (it.stat_value || 0) - (existingForMonth.stat_value || 0);
          console.log('Revision detected for ' + it.stat_metric + ': ' + existingForMonth.stat_value + ' → ' + it.stat_value + ' (diff: ' + revision + ')');
          it.stat_weight = Math.max(0.5, (it.stat_weight || 1) * 0.5);
          it.reasons = ['revised estimate from ' + existingForMonth.stat_value + ' to ' + it.stat_value];
        }
        seen.set(key, it);
        result.push(it);
      }
    } else {
      result.push(it);
    }
  }
  return result;
}

async function fetchEcbStats(cs: string, existingDbItems: It[] = []): Promise<It[]> {
  const items: It[] = [];
  try {
    const r = await sf('https://www.ecb.europa.eu/rss/statpress.html');
    if (r && r.ok) {
      let xml = await r.text();
      xml = xml.replace(new RegExp('&(?!amp;|lt;|gt;|quot;|apos;|#)', 'g'), '&amp;');
      for (const ri of pi(xml).filter(ri => { const p = td(ri.pubDate); return p && p >= cs; }).slice(0, 50)) {
        const pub = td(ri.pubDate)!;
        // Skip meeting accounts — these belong in communications, not statistical
        if (/meeting\s+of\s+/i.test(ri.title) || /monetary\s+policy\s+account/i.test(ri.title)) {
          console.log('ECB Stats: skipping meeting account from stats: ' + ri.title);
          continue;
        }
        const st = ss(ri.title);
        if (st) items.push({ bank: 'ECB', source: 'ECB Stats', item_date: pub, title: ri.title, url: ri.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: st.ns, label: st.lb, word_count: 0, reasons: ['numeric'], stat_metric: st.met, stat_value: st.val, stat_weight: st.w });
        else items.push({ bank: 'ECB', source: 'ECB Stats', item_date: pub, title: ri.title, url: ri.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: 0, label: 'neutral', word_count: 0, reasons: [], stat_metric: null, stat_value: null, stat_weight: 0 });
      }
    }
  } catch (e) { console.error('ECB stats:', e); }
  try {
    const r = await sf('https://ec.europa.eu/eurostat/web/main/news/euro-indicators?p_p_id=estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=atom&p_p_cacheability=cacheLevelPage&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageNumber=1&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageSize=20&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_sort=lastUpdateDate&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_collection=CAT_PREREL');
    if (r && r.ok) {
      for (const e of ae(await r.text())) {
        const pub = e.updated ? td(e.updated) : null;
        if (!pub || pub < cs) continue;
        const st = ss(e.title);
        if (st) items.push({ bank: 'ECB', source: 'Eurostat', item_date: pub, title: e.title, url: e.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: st.ns, label: st.lb, word_count: 0, reasons: ['numeric'], stat_metric: st.met, stat_value: st.val, stat_weight: st.w });
        else items.push({ bank: 'ECB', source: 'Eurostat', item_date: pub, title: e.title, url: e.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: 0, label: 'neutral', word_count: 0, reasons: [], stat_metric: null, stat_value: null, stat_weight: 0 });
      }
    }
  } catch (e) { console.error('Eurostat:', e); }
  return deduplicateStatItems(items, existingDbItems);
}

// ── Aggregation (time-decay × document tier × statistical reliability) ──
function ag(sub: It[], bank?: string) {
  return weightedAggregate(sub, bank);
}


// ── DB persistence ──
async function persist(bank: string, items: It[], s1: ReturnType<typeof ag>, s2: ReturnType<typeof ag>) {
  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const hd = { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
  if (items.length) {
    // Split into batches of 50 to avoid payload size issues
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      const resp = await fetch(sbUrl + '/rest/v1/sentiment_items?on_conflict=bank,source,title,item_date', {
        method: 'POST', headers: hd,
        body: JSON.stringify(batch.map(it => ({
          bank: it.bank, source: it.source, item_date: it.item_date, title: it.title,
          url: it.url || '', is_statistical: it.is_statistical,
          hawk_pts: it.hawk_pts, dove_pts: it.dove_pts, net_score: it.net_score,
          label: it.label, word_count: it.word_count, reasons: it.reasons,
          stat_metric: it.stat_metric, stat_value: it.stat_value, stat_weight: it.stat_weight,
        }))),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('DB persist error (batch ' + (i/50+1) + '):', resp.status, errText);
      }
    }
  }
  const scoreResp = await fetch(sbUrl + '/rest/v1/sentiment_scores?on_conflict=bank', {
    method: 'POST', headers: { ...hd, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      bank,
      score_1_avg: s1.avg, score_1_count: s1.n, score_1_label: s1.sentiment, score_1_dist: s1.dist,
      score_2_avg: s2.avg, score_2_count: s2.n, score_2_label: s2.sentiment, score_2_dist: s2.dist,
      fetched_at: new Date().toISOString(),
    }]),
  });
  if (!scoreResp.ok) {
    const errText = await scoreResp.text();
    console.error('DB scores error:', scoreResp.status, errText);
  }
}

// ── Handler ──
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CH });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const rawBank = (body.bank || 'both').toLowerCase();
    const bank = rawBank === 'fed' ? 'FED' : rawBank === 'ecb' ? 'ECB' : 'both';
    const days = body.days || 365;
    // Stamp every score written by this invocation with one traceable run id.
    const run = beginRun(
      body.mode === 'repair-transcripts' && body.refs === true ? 'repair-citations' : (body.mode || 'scrape'),
    );
    console.log('SA v4.0 (AI+PressConf+Dedup): bank=' + bank + ' days=' + days + ' run=' + run.run_id + ' mode=' + run.mode);

    const co = new Date(); co.setDate(co.getDate() - days);
    const cs = co.toISOString().split('T')[0];
    const fk = Deno.env.get('FRED_API_KEY') || '';
    const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const result: Record<string, any> = {};

    const persistHd = { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };

    // One-off / repeatable historical repair of the US statistical channel.
    // Re-read transcripts/PDFs with the fixed extractor and rescore them.
    if (body.mode === 'repair-transcripts') {
      const banks = bank === 'both' ? ['FED', 'ECB'] : [bank];
      const out: Record<string, number> = {};
      for (const b of banks) out[b] = await rescoreTranscripts(b, sbUrl, sbKey, aiKey, body.limit || 12, body.refs === true, body.stale === true);
      return new Response(JSON.stringify({ mode: 'repair-transcripts', run_id: run.run_id, rescored: out }), {
        headers: { ...CH, 'Content-Type': 'application/json' },
      });
    }


    if (body.mode === 'backfill-fred') {

      const from = body.from || '2026-01-01';
      const items = fk ? await backfillFred(fk, from) : [];
      let saved = 0;
      for (let i = 0; i < items.length; i += 50) {
        const batch = items.slice(i, i + 50);
        const resp = await fetch(sbUrl + '/rest/v1/sentiment_items?on_conflict=bank,source,title,item_date', {
          method: 'POST', headers: persistHd,
          body: JSON.stringify(batch.map(it => ({
            bank: it.bank, source: it.source, item_date: it.item_date, title: it.title,
            url: it.url || '', is_statistical: it.is_statistical,
            hawk_pts: it.hawk_pts, dove_pts: it.dove_pts, net_score: it.net_score,
            label: it.label, word_count: it.word_count, reasons: it.reasons,
            stat_metric: it.stat_metric, stat_value: it.stat_value, stat_weight: it.stat_weight,
          }))),
        });
        if (resp.ok) saved += batch.length;
        else console.error('backfill persist error:', resp.status, await resp.text());
      }
      return new Response(JSON.stringify({ mode: 'backfill-fred', from, found: items.length, saved }), {
        headers: { ...CH, 'Content-Type': 'application/json' },
      });
    }


    if (bank === 'both' || bank === 'FED') {
      const existing = await loadExistingItems('FED', sbUrl, sbKey);
      console.log('FED: ' + existing.size + ' existing items in DB');

      const [fr, rawComms, fomcRaw, pressConfRaw, fedMediaInterviews] = await Promise.allSettled([
        fk ? fetchFred(fk, days) : Promise.resolve([]),
        fetchRssRaw(cs, 'FED'),
        fetchFomcMinutes(cs),
        fetchFomcPressConferences(cs),
        fetchMediaInterviews('FED', aiKey, existing),
      ]);

      const fi: It[] = [];
      if (fr.status === 'fulfilled') fi.push(...fr.value);
      // Re-score macro prints as standardized surprises vs market consensus
      if (aiKey && fi.length) await applyConsensusSurprise(fi, aiKey);


      // Combine all communication sources
      const allRawComms: RawComm[] = [];
      if (rawComms.status === 'fulfilled') allRawComms.push(...rawComms.value);
      if (fomcRaw.status === 'fulfilled') {
        for (const m of fomcRaw.value) {
          allRawComms.push({ title: m.title, text: m.text, date: m.date, url: m.url, source: 'FOMC Minutes', bank: 'FED' });
        }
      }
      if (pressConfRaw.status === 'fulfilled') {
        for (const pc of pressConfRaw.value) {
          // Assign more specific source labels
          let src = 'FOMC Press Conf';
          if (pc.title.includes('Statement')) src = 'FOMC Statement';
          else if (pc.title.includes('Summary of Economic Projections')) src = 'FOMC SEP';
          else if (pc.title.includes('Transcript')) src = 'FOMC Press Conf';
          allRawComms.push({ title: pc.title, text: pc.text, date: pc.date, url: pc.url, source: src, bank: 'FED' });
        }
      }

      // Add Fed official media interview remarks
      if (fedMediaInterviews.status === 'fulfilled' && fedMediaInterviews.value.length > 0) {
        allRawComms.push(...fedMediaInterviews.value);
        console.log('FED: ' + fedMediaInterviews.value.length + ' media interview remarks found');
      }

      const newComms = allRawComms.filter(c => !existing.has(`${c.title}|${c.date}`));
      console.log('FED: ' + allRawComms.length + ' total comms, ' + newComms.length + ' NEW to score with AI');

      // Layer 1 — drop administrative/operational noise before the NLP pass
      const fedPart = partitionForScoring(newComms.map(c => ({ ...c, source: c.source, text: c.text })));
      console.log('FED layer1: ' + fedPart.scorable.length + ' scorable, ' + fedPart.noise.length + ' filtered as noise');
      for (const { doc: c, verdict } of fedPart.noise) {
        fi.push({
          bank: 'FED', source: c.source, item_date: c.date, title: c.title, url: c.url,
          is_statistical: false, hawk_pts: 0, dove_pts: 0, net_score: 0, label: 'neutral',
          word_count: (c.text || '').split(/\s+/).length, reasons: [verdict.reason],
          stat_metric: null, stat_value: null, stat_weight: 0,
          policy_dimensions: { relevance: verdict.relevance },
        });
      }

      // Layer 2 — semantic scoring with entity-level sub-dimensions
      const fedScorable = fedPart.scorable;
      if (fedScorable.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          fedScorable.map(({ doc: c }) => ({ title: c.title, text: c.text, bank: c.bank, source: c.source })),
          aiKey,
        );
        for (let i = 0; i < fedScorable.length; i++) {
          const { doc: c, verdict } = fedScorable[i];
          const s = scores[i];
          fi.push({
            bank: 'FED', source: c.source, item_date: c.date,
            title: c.title, url: c.url,
            is_statistical: false,
            hawk_pts: s.score > 0 ? Math.round(Math.abs(s.score) * 10) : 0,
            dove_pts: s.score < 0 ? Math.round(Math.abs(s.score) * 10) : 0,
            net_score: s.score,
            label: s.label,
            word_count: c.text.split(/\s+/).length,
            reasons: ['ai:' + s.reasoning, verdict.reason],
            stat_metric: null, stat_value: null, stat_weight: 0,
            policy_dimensions: { relevance: verdict.relevance, ...(s.dimensions || {}), ...(s.audit ? { scoring_audit: s.audit } : {}) },
          });
        }
      }

      // Persist new items, then aggregate from FULL DB
      let fiDedup = dedupItems(fi);
      if (fiDedup.length < fi.length) console.log('FED: deduped ' + fi.length + ' -> ' + fiDedup.length + ' items');
      fiDedup = await aiCrossLangDedup(fiDedup, aiKey);
      // Layer 3 — normalize each speaker against their own historical baseline
      fiDedup = await applySpeakerCalibration(fiDedup, 'FED', sbUrl, sbKey);
      if (fiDedup.length) {
        console.log('FED: persisting ' + fiDedup.length + ' items to DB');
        for (let i = 0; i < fiDedup.length; i += 50) {
          const batch = fiDedup.slice(i, i + 50);
          const resp = await fetch(sbUrl + '/rest/v1/sentiment_items?on_conflict=bank,source,title,item_date', {
            method: 'POST', headers: persistHd,
            body: JSON.stringify(batch.map(it => ({
              bank: it.bank, source: it.source, item_date: it.item_date, title: it.title,
              url: it.url || '', is_statistical: it.is_statistical,
              hawk_pts: it.hawk_pts, dove_pts: it.dove_pts, net_score: it.net_score,
              label: it.label, word_count: it.word_count, reasons: it.reasons,
              stat_metric: it.stat_metric, stat_value: it.stat_value, stat_weight: it.stat_weight,
              ...(it.policy_dimensions ? { policy_dimensions: it.policy_dimensions } : {}),
            }))),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => 'no body');
            console.error('FED persist error (batch ' + i + '): ' + resp.status + ' ' + errText);
          }
        }
      }
      await pruneDuplicateComms('FED', sbUrl, sbKey);
      await rescoreZeroPolicyDocs('FED', sbUrl, sbKey, aiKey);
      const allFedItems = await loadAllItemsForAggregation('FED', sbUrl, sbKey);
      // Layer 4 — α·S_text + (1−α)·S_stats
      const s1 = ag(allFedItems.filter(i => !i.is_statistical), 'FED');
      const s2 = blendedAggregate(allFedItems, 'FED');
      console.log('FED layer4: alpha=' + s2.alpha + ' text=' + s2.text.avg + ' stats=' + s2.stats.avg + ' blended=' + s2.avg);
      await fetch(sbUrl + '/rest/v1/sentiment_scores?on_conflict=bank', {
        method: 'POST', headers: { ...persistHd, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          bank: 'FED',
          score_1_avg: s1.avg, score_1_count: s1.n, score_1_label: s1.sentiment, score_1_dist: s1.dist,
          score_2_avg: s2.avg, score_2_count: s2.n, score_2_label: s2.sentiment, score_2_dist: s2.dist,
          fetched_at: new Date().toISOString(),
        }]),
      });
      result.fed = { items: allFedItems, score_1: s1, score_2: s2 };
      console.log('Fed: ' + allFedItems.length + ' items (comms: ' + s1.n + ', total: ' + s2.n + ')');
    }

    if (bank === 'both' || bank === 'ECB') {
      const [existing, existingStatItems] = await Promise.all([
        loadExistingItems('ECB', sbUrl, sbKey),
        loadExistingStatItems('ECB', sbUrl, sbKey),
      ]);
      console.log('ECB: ' + existing.size + ' existing items in DB, ' + existingStatItems.length + ' stat items for dedup');

      const [rawComms, st, ecbPressConf, ecbAccounts, mediaInterviews] = await Promise.allSettled([
        fetchRssRaw(cs, 'ECB'),
        fetchEcbStats(cs, existingStatItems),
        fetchEcbPressConferences(cs, aiKey),
        fetchEcbAccounts(cs),
        fetchMediaInterviews('ECB', aiKey, existing),
      ]);

      const ei: It[] = [];
      if (st.status === 'fulfilled') ei.push(...st.value);
      // Re-score macro prints as standardized surprises vs market consensus
      if (aiKey && ei.length) await applyConsensusSurprise(ei, aiKey);


      const allRawComms: RawComm[] = rawComms.status === 'fulfilled' ? rawComms.value : [];
      
      // Add ECB press conference transcripts
      if (ecbPressConf.status === 'fulfilled') {
        for (const pc of ecbPressConf.value) {
          allRawComms.push({ title: pc.title, text: pc.text, date: pc.date, url: pc.url, source: 'ECB Press Conf', bank: 'ECB' });
        }
      }

      // Add ECB meeting accounts (minutes equivalent)
      if (ecbAccounts.status === 'fulfilled') {
        for (const ac of ecbAccounts.value) {
          allRawComms.push({ title: ac.title, text: ac.text, date: ac.date, url: ac.url, source: 'ECB Monetary Policy Accounts', bank: 'ECB' });
        }
        console.log('ECB: ' + ecbAccounts.value.length + ' meeting accounts found');
      }

      // Add media interview remarks from GC members
      if (mediaInterviews.status === 'fulfilled' && mediaInterviews.value.length > 0) {
        allRawComms.push(...mediaInterviews.value);
        console.log('ECB: ' + mediaInterviews.value.length + ' media interview remarks found');
      }

      // Reclassify consumer expectations surveys and similar as statistical
      // But score them with AI since they contain policy-relevant textual content
      const actualComms: RawComm[] = [];
      const reclassifiedSurveys: RawComm[] = [];
      for (const c of allRawComms) {
        if (shouldReclassifyAsStatistical(c.title)) {
          console.log('Reclassifying as statistical (will AI-score): ' + c.title);
          reclassifiedSurveys.push(c);
        } else {
          actualComms.push(c);
        }
      }

      // AI-score reclassified surveys and add as statistical items
      if (reclassifiedSurveys.length > 0 && aiKey) {
        const surveyTexts: { title: string; text: string; bank: string }[] = [];
        for (const s of reclassifiedSurveys) {
          // Fetch page text if not already available
          let text = s.text;
          if (!text && s.url) text = await fetchPageText(s.url);
          surveyTexts.push({ title: s.title, text: text || s.title, bank: s.bank });
        }
        const surveyScores = await scoreBatchWithAI(surveyTexts, aiKey);
        for (let i = 0; i < reclassifiedSurveys.length; i++) {
          const c = reclassifiedSurveys[i];
          const sc = surveyScores[i];
          ei.push({
            bank: 'ECB', source: c.source, item_date: c.date,
            title: c.title, url: c.url,
            is_statistical: true,
            hawk_pts: sc.score > 0 ? Math.round(Math.abs(sc.score) * 10) : 0,
            dove_pts: sc.score < 0 ? Math.round(Math.abs(sc.score) * 10) : 0,
            net_score: sc.score,
            label: sc.label,
            word_count: surveyTexts[i].text.split(/\s+/).length,
            reasons: ['survey-reclassified-as-statistical', 'ai:' + sc.reasoning],
            stat_metric: 'Survey', stat_value: null, stat_weight: 1,
          });
        }
      } else {
        // No AI key — still add them but with 0 score
        for (const c of reclassifiedSurveys) {
          ei.push({
            bank: 'ECB', source: c.source, item_date: c.date,
            title: c.title, url: c.url,
            is_statistical: true,
            hawk_pts: 0, dove_pts: 0, net_score: 0,
            label: 'neutral', word_count: 0, reasons: ['survey-reclassified-as-statistical'],
            stat_metric: 'Survey', stat_value: null, stat_weight: 1,
          });
        }
      }

      const newComms = actualComms.filter(c => !existing.has(`${c.title}|${c.date}`));
      console.log('ECB: ' + actualComms.length + ' actual comms, ' + newComms.length + ' NEW to score with AI');

      // Layer 1 — drop administrative/operational noise before the NLP pass
      const ecbPart = partitionForScoring(newComms);
      console.log('ECB layer1: ' + ecbPart.scorable.length + ' scorable, ' + ecbPart.noise.length + ' filtered as noise');
      for (const { doc: c, verdict } of ecbPart.noise) {
        ei.push({
          bank: 'ECB', source: c.source, item_date: c.date, title: c.title, url: c.url,
          is_statistical: false, hawk_pts: 0, dove_pts: 0, net_score: 0, label: 'neutral',
          word_count: (c.text || '').split(/\s+/).length, reasons: [verdict.reason],
          stat_metric: null, stat_value: null, stat_weight: 0,
          policy_dimensions: { relevance: verdict.relevance },
        });
      }

      // Layer 2 — semantic scoring with entity-level sub-dimensions
      if (ecbPart.scorable.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          ecbPart.scorable.map(({ doc: c }) => ({ title: c.title, text: c.text, bank: c.bank, source: c.source })),
          aiKey,
        );
        for (let i = 0; i < ecbPart.scorable.length; i++) {
          const { doc: c, verdict } = ecbPart.scorable[i];
          const s = scores[i];
          ei.push({
            bank: 'ECB', source: c.source, item_date: c.date,
            title: c.title, url: c.url,
            is_statistical: false,
            hawk_pts: s.score > 0 ? Math.round(Math.abs(s.score) * 10) : 0,
            dove_pts: s.score < 0 ? Math.round(Math.abs(s.score) * 10) : 0,
            net_score: s.score,
            label: s.label,
            word_count: c.text.split(/\s+/).length,
            reasons: ['ai:' + s.reasoning, verdict.reason],
            stat_metric: null, stat_value: null, stat_weight: 0,
            policy_dimensions: { relevance: verdict.relevance, ...(s.dimensions || {}), ...(s.audit ? { scoring_audit: s.audit } : {}) },
          });
        }
      }

      // Persist new items, then aggregate from FULL DB
      // Deduplicate items by canonical URL / normalized title before persist
      let dedupEi = dedupItems(ei);
      if (dedupEi.length < ei.length) console.log('ECB: deduped ' + ei.length + ' -> ' + dedupEi.length + ' items');
      dedupEi = await aiCrossLangDedup(dedupEi, aiKey);
      // Layer 3 — normalize each speaker against their own historical baseline
      dedupEi = await applySpeakerCalibration(dedupEi, 'ECB', sbUrl, sbKey);
      if (dedupEi.length) {
        console.log('ECB: persisting ' + dedupEi.length + ' items to DB');
        for (let i = 0; i < dedupEi.length; i += 50) {
          const batch = dedupEi.slice(i, i + 50);
          const payload = batch.map(it => ({
            bank: it.bank, source: it.source, item_date: it.item_date, title: it.title,
            url: it.url || '', is_statistical: it.is_statistical,
            hawk_pts: it.hawk_pts, dove_pts: it.dove_pts, net_score: it.net_score,
            label: it.label, word_count: it.word_count, reasons: it.reasons,
            stat_metric: it.stat_metric, stat_value: it.stat_value, stat_weight: it.stat_weight,
            ...(it.policy_dimensions ? { policy_dimensions: it.policy_dimensions } : {}),
          }));
          // Log press conf items for debugging
          const pressConfInBatch = payload.filter(p => p.source === 'ECB Press Conf');
          if (pressConfInBatch.length) {
            console.log('ECB persist batch has ' + pressConfInBatch.length + ' press conf items: ' + pressConfInBatch.map(p => p.title).join(', '));
          }
          const resp = await fetch(sbUrl + '/rest/v1/sentiment_items?on_conflict=bank,source,title,item_date', {
            method: 'POST', headers: persistHd,
            body: JSON.stringify(payload),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => 'no body');
            console.error('ECB persist error (batch ' + i + '): ' + resp.status + ' ' + errText);
          }
        }
      }
      await pruneDuplicateComms('ECB', sbUrl, sbKey);
      await rescoreZeroPolicyDocs('ECB', sbUrl, sbKey, aiKey);
      const allEcbItems = await loadAllItemsForAggregation('ECB', sbUrl, sbKey);
      // Layer 4 — α·S_text + (1−α)·S_stats
      const s1 = ag(allEcbItems.filter(i => !i.is_statistical), 'ECB');
      const s2 = blendedAggregate(allEcbItems, 'ECB');
      console.log('ECB layer4: alpha=' + s2.alpha + ' text=' + s2.text.avg + ' stats=' + s2.stats.avg + ' blended=' + s2.avg);
      await fetch(sbUrl + '/rest/v1/sentiment_scores?on_conflict=bank', {
        method: 'POST', headers: { ...persistHd, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          bank: 'ECB',
          score_1_avg: s1.avg, score_1_count: s1.n, score_1_label: s1.sentiment, score_1_dist: s1.dist,
          score_2_avg: s2.avg, score_2_count: s2.n, score_2_label: s2.sentiment, score_2_dist: s2.dist,
          fetched_at: new Date().toISOString(),
        }]),
      });
      result.ecb = { items: allEcbItems, score_1: s1, score_2: s2 };
      console.log('ECB: ' + allEcbItems.length + ' items (comms: ' + s1.n + ', total: ' + s2.n + ')');
    }

    // Run SEP delta scoring (compare projections between meetings)
    if (aiKey) {
      try {
        console.log('Running SEP delta scoring...');
        const sepResult = await runSEPDeltaScoring(sbUrl, sbKey, aiKey);
        console.log('SEP delta scoring: updated=' + sepResult.updated);
        result.sep_delta = sepResult;
      } catch (e) { console.error('SEP delta scoring error:', e); }
    }

    // Auto-trigger topic analysis and taxonomy classification for new items
    console.log('Auto-triggering topic analysis and taxonomy classification...');
    try {
      const [topicResp, taxResp] = await Promise.allSettled([
        fetch(sbUrl + '/functions/v1/topic-analysis', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        fetch(sbUrl + '/functions/v1/policy-taxonomy', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ]);
      if (topicResp.status === 'fulfilled') {
        const td = await topicResp.value.json().catch(() => ({}));
        console.log('Topic analysis auto-run: tagged=' + (td.tagged || 0));
        result.topic_analysis = td;
      }
      if (taxResp.status === 'fulfilled') {
        const td2 = await taxResp.value.json().catch(() => ({}));
        console.log('Taxonomy auto-run: classified=' + (td2.classified || 0));
        result.taxonomy = td2;
      }
    } catch (e) { console.error('Auto-trigger error:', e); }

    return new Response(JSON.stringify(result), { headers: { ...CH, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Err:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), { status: 500, headers: { ...CH, 'Content-Type': 'application/json' } });
  }
});
