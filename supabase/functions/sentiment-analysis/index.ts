// ── Sentiment Analysis v3.0 — AI-Powered (Gemini) + Cached Scoring ──
// Communication items are scored by Gemini AI for contextual understanding.
// Statistical items use numeric formula scoring (unchanged).
// Already-scored items are loaded from DB and skipped.

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
}

// ── Statistical value scoring (unchanged) ──
function sv(v:number, ht:number, dt:number, dir:string, w:number, met:string) {
  let raw: number, lb: string;
  const B = 0.15;
  if (dir === 'lh') {
    if (v <= ht) { raw = Math.max(Math.min((ht - v) / Math.max(Math.abs(ht), 1) * 2, 2), B); lb = 'hawkish'; }
    else if (v >= dt) { raw = -Math.max(Math.min((v - dt) / Math.max(Math.abs(dt), 1) * 2, 2), B); lb = 'dovish'; }
    else { raw = -(v - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1); lb = raw > 0.05 ? 'hawkish' : raw < -0.05 ? 'dovish' : 'neutral'; }
  } else {
    if (v >= ht) { raw = Math.max(Math.min((v - ht) / Math.max(Math.abs(ht), 1) * 2, 2), B); lb = 'hawkish'; }
    else if (v <= dt) { raw = -Math.max(Math.min(Math.abs(dt - v) / Math.max(Math.abs(dt), 1) * 2, 2), B); lb = 'dovish'; }
    else { raw = (v - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1); lb = raw > 0.05 ? 'hawkish' : raw < -0.05 ? 'dovish' : 'neutral'; }
  }
  return { net_score: Math.round(raw * w * 1000) / 1000, label: lb, metric: met, value: Math.round(v * 100) / 100 };
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

async function fetchPageText(url: string): Promise<string> {
  try {
    const r = await sf(url, 12000);
    if (!r || !r.ok) return '';
    const html = await r.text();
    return extractText(html);
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
  if (v > 0 && /\b(down|fell|drop|decrease|decline|contract)\b/.test(tl)) v = -v;
  return v;
}

// ══════════════════════════════════════════════════════════════
// ── AI-POWERED SCORING via Gemini (Lovable AI Gateway) ──
// ══════════════════════════════════════════════════════════════

const AI_SCORING_PROMPT = `You are a senior monetary policy analyst. Score this central bank communication on the hawkish-dovish spectrum.

SCORING RULES:
- Score from -1.0 (extremely dovish) to +1.0 (extremely hawkish), with 0.0 being neutral
- DOVISH signals: rate cuts, easing, weak growth concerns, disinflation progress, labor market softening, dissent favoring cuts, downside risks
- HAWKISH signals: rate hikes, tightening, inflation persistence, strong economy, labor market tightness, upside risks to inflation
- NEUTRAL: administrative matters, non-monetary topics (digital euro, climate, banking supervision, counterfeit notes, appointments)
- If the speech is NOT about monetary policy (structural reforms, digital currency, climate), score near 0.0
- Pay attention to CONTEXT: "inflation is falling" is dovish, "inflation is persistent" is hawkish
- Pay attention to DISSENT: if a speaker dissented in favor of cutting, that's very dovish even if they're traditionally hawkish
- Pay attention to NUANCE: "data-dependent" alone is neutral; "data-dependent and we see progress" leans dovish

Respond with ONLY a JSON object (no markdown):
{"score": <number>, "label": "hawkish"|"dovish"|"neutral", "reasoning": "<1 sentence>"}`;

interface AIScore {
  score: number;
  label: string;
  reasoning: string;
}

async function scoreWithAI(
  title: string,
  text: string,
  bank: string,
  apiKey: string,
): Promise<AIScore> {
  // Truncate text to ~3000 chars to save tokens while preserving key content
  const truncated = text.length > 3000 ? text.slice(0, 1500) + '\n...[middle truncated]...\n' + text.slice(-1500) : text;

  const userMsg = `Bank: ${bank}
Title: ${title}
Content: ${truncated}`;

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: AI_SCORING_PROMPT },
          { role: 'user', content: userMsg },
        ],
      }),
    });

    if (!resp.ok) {
      console.error('AI scoring failed:', resp.status);
      return { score: 0, label: 'neutral', reasoning: 'AI scoring unavailable' };
    }

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const parsed = JSON.parse(content);
    const score = Math.max(-1, Math.min(1, Number(parsed.score) || 0));
    const label = score > 0.05 ? 'hawkish' : score < -0.05 ? 'dovish' : 'neutral';

    return {
      score: Math.round(score * 1000) / 1000,
      label,
      reasoning: parsed.reasoning || '',
    };
  } catch (e) {
    console.error('AI score parse error:', e);
    return { score: 0, label: 'neutral', reasoning: 'AI scoring error' };
  }
}

// Score a batch of communication items with AI (sequential to respect rate limits)
async function scoreBatchWithAI(
  items: { title: string; text: string; bank: string }[],
  apiKey: string,
): Promise<AIScore[]> {
  const results: AIScore[] = [];
  // Process in batches of 3 with small delays between batches
  for (let i = 0; i < items.length; i += 3) {
    const batch = items.slice(i, i + 3);
    const batchResults = await Promise.allSettled(
      batch.map(item => scoreWithAI(item.title, item.text, item.bank, apiKey))
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { score: 0, label: 'neutral', reasoning: 'error' });
    }
    // Small delay between batches to avoid rate limiting
    if (i + 3 < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
}

// ── Load existing scored items from DB to skip re-scoring ──
async function loadExistingItems(bank: string, sbUrl: string, sbKey: string): Promise<Set<string>> {
  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=title,item_date&bank=eq.${bank}&is_statistical=eq.false&limit=1000`,
      { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
    );
    if (!resp.ok) return new Set();
    const data = await resp.json();
    // Create a set of "title|date" keys for deduplication
    return new Set((data || []).map((d: any) => `${d.title}|${d.item_date}`));
  } catch { return new Set(); }
}

// ── FRED ──
interface FS { id: string; met: string; tr: string; ht: number; dt: number; dir: string; w: number }
const FR: FS[] = [
  { id: 'CPIAUCSL', met: 'CPI YoY', tr: 'p12', ht: 3, dt: 2, dir: 'hh', w: 3 },
  { id: 'PAYEMS', met: 'Payrolls MoM', tr: 'd1', ht: 200, dt: 100, dir: 'hh', w: 3 },
  { id: 'UNRATE', met: 'Unemployment', tr: 'lv', ht: 4, dt: 5, dir: 'lh', w: 3 },
  { id: 'PCEPILFE', met: 'Core PCE YoY', tr: 'p12', ht: 2.5, dt: 2, dir: 'hh', w: 3 },
  { id: 'FEDFUNDS', met: 'Fed Funds', tr: 'lv', ht: 5, dt: 3, dir: 'hh', w: 1 },
  { id: 'RSAFS', met: 'Retail Sales', tr: 'p1', ht: 0.5, dt: -0.2, dir: 'hh', w: 2 },
  { id: 'INDPRO', met: 'Ind Prod', tr: 'p1', ht: 0.3, dt: -0.3, dir: 'hh', w: 2 },
];

async function fetchFred(key: string, days: number): Promise<It[]> {
  const co = new Date(); co.setDate(co.getDate() - days);
  const cs = co.toISOString().split('T')[0];
  const res = await Promise.allSettled(FR.map(async s => {
    const r = await sf('https://api.stlouisfed.org/fred/series/observations?series_id=' + s.id + '&api_key=' + key + '&file_type=json&sort_order=desc&limit=15');
    if (!r || !r.ok) return null;
    const d = await r.json();
    const obs = (d.observations || []).filter((o: any) => o.value !== '.');
    if (!obs.length || obs[0].date < cs) return null;
    const v = obs.map((o: any) => parseFloat(o.value));
    let val: number | null = null;
    if (s.tr === 'lv') val = v[0];
    else if (s.tr === 'd1' && v.length >= 2) val = v[0] - v[1];
    else if (s.tr === 'p1' && v.length >= 2 && v[1] !== 0) val = ((v[0] - v[1]) / Math.abs(v[1])) * 100;
    else if (s.tr === 'p12' && v.length >= 13 && v[12] !== 0) val = ((v[0] - v[12]) / Math.abs(v[12])) * 100;
    if (val === null) return null;
    const r2 = sv(val, s.ht, s.dt, s.dir, s.w, s.met);
    return {
      bank: 'FED', source: 'FRED', item_date: obs[0].date,
      title: s.met + ': ' + val.toFixed(2) + ' (' + s.id + ')',
      url: 'https://fred.stlouisfed.org/series/' + s.id,
      is_statistical: true, hawk_pts: 0, dove_pts: 0,
      net_score: r2.net_score, label: r2.label, word_count: 0,
      reasons: ['fred'], stat_metric: r2.metric, stat_value: r2.value, stat_weight: s.w,
    } as It;
  }));
  return res.filter(r => r.status === 'fulfilled' && r.value).map(r => (r as PromiseFulfilledResult<It>).value);
}

// ── FOMC Minutes ──
async function fetchFomcMinutes(cutoffDate: string): Promise<{ title: string; text: string; date: string; url: string }[]> {
  const items: { title: string; text: string; date: string; url: string }[] = [];
  const now = new Date();
  const cutoff = new Date(cutoffDate);
  const knownDates = [
    '20260128','20260318','20260506','20260617','20260729','20260917','20261028','20261216',
    '20250129','20250319','20250507','20250618','20250730','20250917','20251029','20251210',
  ];
  const relevantDates = knownDates.filter(ds => {
    const y = parseInt(ds.slice(0, 4)), m = parseInt(ds.slice(4, 6)) - 1, day = parseInt(ds.slice(6, 8));
    const meetDate = new Date(y, m, day);
    return meetDate >= cutoff && meetDate <= now;
  });
  console.log('FOMC: checking ' + relevantDates.length + ' known meeting dates');
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

// ── RSS feeds — returns raw items with text (scoring happens later via AI) ──
const SKIP = new Set(['enforcement actions', 'orders on banking applications', 'other announcements', 'banking and consumer regulatory policy', 'community development']);
const MINUTES_SKIP = /minutes/i;

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
        { url: 'https://www.ecb.europa.eu/rss/speeches.html', lbl: 'ECB Speech' },
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

// ── ECB Stats + Eurostat (unchanged — formula scoring) ──
interface SR { pattern: string; met: string; ht: number | null; dt: number | null; dir: string; w: number }
const EU: SR[] = [
  { pattern: 'inflation', met: 'HICP', ht: 2.5, dt: 1.8, dir: 'hh', w: 3 },
  { pattern: 'gdp', met: 'GDP', ht: 0.4, dt: 0.1, dir: 'hh', w: 3 },
  { pattern: 'unemployment', met: 'Unemployment', ht: 6, dt: 7.5, dir: 'lh', w: 3 },
  { pattern: 'industrial production', met: 'Ind Prod', ht: 0.5, dt: -0.5, dir: 'hh', w: 2 },
  { pattern: 'production in construction', met: 'Construction', ht: 0.5, dt: -0.5, dir: 'hh', w: 2 },
  { pattern: 'producer prices', met: 'PPI', ht: 0.5, dt: -0.3, dir: 'hh', w: 2 },
  { pattern: 'retail trade', met: 'Retail', ht: 0.5, dt: -0.3, dir: 'hh', w: 2 },
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

async function fetchEcbStats(cs: string): Promise<It[]> {
  const items: It[] = [];
  try {
    const r = await sf('https://www.ecb.europa.eu/rss/statpress.html');
    if (r && r.ok) {
      let xml = await r.text();
      xml = xml.replace(new RegExp('&(?!amp;|lt;|gt;|quot;|apos;|#)', 'g'), '&amp;');
      for (const ri of pi(xml).filter(ri => { const p = td(ri.pubDate); return p && p >= cs; }).slice(0, 50)) {
        const pub = td(ri.pubDate)!;
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
  return items;
}

// ── Aggregation (excludes zero-score neutral items) ──
function ag(sub: It[]) {
  const scored = sub.filter(i => Math.abs(i.net_score) > 0.001);
  if (!scored.length) return { avg: 0, n: 0, dist: {} as Record<string, number>, sentiment: 'NEUTRAL' };
  const avg = Math.round(scored.reduce((s, i) => s + i.net_score, 0) / scored.length * 1000) / 1000;
  const sentiment = avg <= -0.5 ? 'STRONGLY DOVISH' : avg < -0.1 ? 'DOVISH' : avg >= 0.5 ? 'STRONGLY HAWKISH' : avg > 0.1 ? 'HAWKISH' : 'NEUTRAL';
  const dist: Record<string, number> = {};
  for (const i of scored) dist[i.label] = (dist[i.label] || 0) + 1;
  return { avg, n: scored.length, dist, sentiment };
}

// ── DB persistence ──
async function persist(bank: string, items: It[], s1: ReturnType<typeof ag>, s2: ReturnType<typeof ag>) {
  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const hd = { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
  if (items.length) {
    await fetch(sbUrl + '/rest/v1/sentiment_items', {
      method: 'POST', headers: hd,
      body: JSON.stringify(items.map(i => ({
        bank: i.bank, source: i.source, item_date: i.item_date, title: i.title,
        url: i.url || '', is_statistical: i.is_statistical,
        hawk_pts: i.hawk_pts, dove_pts: i.dove_pts, net_score: i.net_score,
        label: i.label, word_count: i.word_count, reasons: i.reasons,
        stat_metric: i.stat_metric, stat_value: i.stat_value, stat_weight: i.stat_weight,
      }))),
    }).then(r => r.text()).catch(e => console.error('DB:', e));
  }
  await fetch(sbUrl + '/rest/v1/sentiment_scores', {
    method: 'POST', headers: { ...hd, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      bank,
      score_1_avg: s1.avg, score_1_count: s1.n, score_1_label: s1.sentiment, score_1_dist: s1.dist,
      score_2_avg: s2.avg, score_2_count: s2.n, score_2_label: s2.sentiment, score_2_dist: s2.dist,
      fetched_at: new Date().toISOString(),
    }]),
  }).then(r => r.text()).catch(e => console.error('DB:', e));
}

// ── Handler ──
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CH });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const bank = body.bank || 'both';
    const days = body.days || 365;
    console.log('SA v3.0 (AI-scored): bank=' + bank + ' days=' + days);
    const co = new Date(); co.setDate(co.getDate() - days);
    const cs = co.toISOString().split('T')[0];
    const fk = Deno.env.get('FRED_API_KEY') || '';
    const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const result: Record<string, any> = {};

    if (bank === 'both' || bank === 'FED') {
      // Load existing items from DB
      const existing = await loadExistingItems('FED', sbUrl, sbKey);
      console.log('FED: ' + existing.size + ' existing items in DB');

      const [fr, rawComms, fomcRaw] = await Promise.allSettled([
        fk ? fetchFred(fk, days) : Promise.resolve([]),
        fetchRssRaw(cs, 'FED'),
        fetchFomcMinutes(cs),
      ]);

      const fi: It[] = [];
      if (fr.status === 'fulfilled') fi.push(...fr.value);

      // Filter to only NEW communication items (not already in DB)
      const allRawComms: RawComm[] = [];
      if (rawComms.status === 'fulfilled') allRawComms.push(...rawComms.value);
      if (fomcRaw.status === 'fulfilled') {
        for (const m of fomcRaw.value) {
          allRawComms.push({ title: m.title, text: m.text, date: m.date, url: m.url, source: 'FOMC Minutes', bank: 'FED' });
        }
      }

      const newComms = allRawComms.filter(c => !existing.has(`${c.title}|${c.date}`));
      console.log('FED: ' + allRawComms.length + ' total comms, ' + newComms.length + ' NEW to score with AI');

      // Score new items with AI
      if (newComms.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          newComms.map(c => ({ title: c.title, text: c.text, bank: c.bank })),
          aiKey,
        );
        for (let i = 0; i < newComms.length; i++) {
          const c = newComms[i];
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
            reasons: ['ai:' + s.reasoning],
            stat_metric: null, stat_value: null, stat_weight: 0,
          });
        }
      }

      const s1 = ag(fi.filter(i => !i.is_statistical)), s2 = ag(fi);
      await persist('FED', fi, s1, s2);
      result.fed = { items: fi, score_1: s1, score_2: s2 };
      console.log('Fed: ' + fi.length + ' items (comms: ' + s1.n + ', total: ' + s2.n + ')');
    }

    if (bank === 'both' || bank === 'ECB') {
      const existing = await loadExistingItems('ECB', sbUrl, sbKey);
      console.log('ECB: ' + existing.size + ' existing items in DB');

      const [rawComms, st] = await Promise.allSettled([fetchRssRaw(cs, 'ECB'), fetchEcbStats(cs)]);
      const ei: It[] = [];
      if (st.status === 'fulfilled') ei.push(...st.value);

      const allRawComms: RawComm[] = rawComms.status === 'fulfilled' ? rawComms.value : [];
      const newComms = allRawComms.filter(c => !existing.has(`${c.title}|${c.date}`));
      console.log('ECB: ' + allRawComms.length + ' total comms, ' + newComms.length + ' NEW to score with AI');

      if (newComms.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          newComms.map(c => ({ title: c.title, text: c.text, bank: c.bank })),
          aiKey,
        );
        for (let i = 0; i < newComms.length; i++) {
          const c = newComms[i];
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
            reasons: ['ai:' + s.reasoning],
            stat_metric: null, stat_value: null, stat_weight: 0,
          });
        }
      }

      const s1 = ag(ei.filter(i => !i.is_statistical)), s2 = ag(ei);
      await persist('ECB', ei, s1, s2);
      result.ecb = { items: ei, score_1: s1, score_2: s2 };
      console.log('ECB: ' + ei.length + ' items (comms: ' + s1.n + ', total: ' + s2.n + ')');
    }

    return new Response(JSON.stringify(result), { headers: { ...CH, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Err:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), { status: 500, headers: { ...CH, 'Content-Type': 'application/json' } });
  }
});
