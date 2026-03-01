// ── Sentiment Analysis v2.3 — Full Monolithic (POST-based) ──
// CRITICAL: Do NOT use new URL(req.url) — crashes this edge runtime.
const CH = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Hawkish / Dovish keyword lists ──
const HW = ['rate hike','tightening','hawkish','restrictive','overheating','persistent inflation','price pressures','strong demand','upside risks to inflation','insufficiently restrictive','further tightening','remain vigilant','data dependent','not yet convinced','more work to do','premature to','too early to declare victory'];
const DW = ['rate cut','easing','dovish','accommodative','disinflation','slowing','weaker growth','downside risks','disinflationary','progress on inflation','cutting rates','lower rates','policy pivot','sufficiently restrictive','confident','well positioned','normalization','recalibrate','appropriate to reduce','gradual reduction'];

// ── Directional phrase scoring (context-aware, ±5 pts) ──
const DP: Record<string,{h:string[];d:string[]}> = {
  'wage growth':{h:['accelerat','rising','elevated','strong','above','persistent','robust'],d:['moderat','eased','easing','slowing','soften','deceler','cooling']},
  'inflation':{h:['above target','persistently','sticky','broad-based','accelerat','elevated','upside'],d:['falling','declining','easing','retreating','moderat','lower','disinflation','progress','moving toward']},
  'growth':{h:['robust','strong','solid','resilient','accelerat','above trend'],d:['slowing','contract','recession','weak','stagnant','deteriorat','modest','below trend']},
  'unemployment':{h:['historic low','tight','below natural','record low','strong labor'],d:['rising','elevated','increasing','higher','deteriorat','softening','loosening']},
  'labor market':{h:['tight','strong','robust','resilient','demand exceeds'],d:['cooling','softening','rebalancing','easing','normalizing','loosening']},
  'financial conditions':{h:['loose','accommodative','easy','stimulative'],d:['tight','restrictive','tightened','constraining']},
};

interface It {
  bank:string; source:string; item_date:string; title:string; url:string;
  is_statistical:boolean; hawk_pts:number; dove_pts:number; net_score:number;
  label:string; word_count:number; reasons:string[];
  stat_metric:string|null; stat_value:number|null; stat_weight:number;
}

// ── Non-monetary-policy topic keywords — speeches about these are structural, not policy signals ──
const NON_MONETARY_TOPICS = /\b(digital euro|cbdc|cyber|climate change|sustainability|green bond|financial stability|banking supervision|prudential|payment system|market infrastructure|competition|competitiveness|turning size into scale|single market|capital markets union|european model|geopolit|defence|sovereignty|enlargement|education|innovation ecosystem)\b/i;

// ── Sentiment scoring function — works on full text ──
function sc(text: string, title = '') {
  const c = (title + ' ' + text).toLowerCase();

  // If the speech is primarily about non-monetary structural topics, apply a large dampening factor
  const isStructural = NON_MONETARY_TOPICS.test(title.toLowerCase());
  // Check how much monetary-policy content is actually present
  const monetarySignals = ['interest rate','monetary policy','inflation target','price stability','rate decision','policy stance','rate path','quantitative','balance sheet','forward guidance'];
  const monetaryHits = monetarySignals.filter(s => c.includes(s)).length;
  // Structural speech with few monetary references → dampen heavily
  const dampening = isStructural && monetaryHits < 3 ? 0.15 : 1.0;

  let hp = 0, dp = 0;
  const rs: string[] = [];
  for (const w of HW) if (c.includes(w)) { hp++; rs.push('h:' + w); }
  for (const w of DW) if (c.includes(w)) { dp++; rs.push('d:' + w); }
  for (const [p, m] of Object.entries(DP)) {
    let i = c.indexOf(p);
    while (i !== -1) {
      const ctx = c.slice(Math.max(0, i - 120), Math.min(c.length, i + p.length + 120));
      const hh = m.h.some(x => ctx.includes(x)), dd = m.d.some(x => ctx.includes(x));
      if (hh && !dd) { hp += 5; rs.push('dh:' + p); }
      else if (dd && !hh) { dp += 5; rs.push('dd:' + p); }
      i = c.indexOf(p, i + 1);
    }
  }
  const wc = Math.max(c.split(/\s+/).length, 1);
  const rawNet = ((hp - dp) / wc) * 100;
  const net = rawNet * dampening;
  if (isStructural && dampening < 1) rs.push('dampened:structural-topic');
  return {
    hawk_pts: hp, dove_pts: dp,
    net_score: Math.round(net * 1000) / 1000,
    label: net > 0.05 ? 'hawkish' : net < -0.05 ? 'dovish' : 'neutral',
    word_count: wc, reasons: rs,
  };
}

// ── Statistical value scoring ──
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
// Uses index-based extraction to handle nested divs properly
function extractText(html: string): string {
  // Remove script/style tags
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Try to find main content by locating the start tag and tracking nesting
  const contentMarkers = [
    { pattern: /<div[^>]*id="article"[^>]*>/i, tag: 'div' },
    { pattern: /<div[^>]*id="content"[^>]*>/i, tag: 'div' },
    { pattern: /<article[^>]*>/i, tag: 'article' },
    { pattern: /<main[^>]*>/i, tag: 'main' },
  ];

  for (const marker of contentMarkers) {
    const startMatch = t.match(marker.pattern);
    if (!startMatch || startMatch.index === undefined) continue;

    // Find the matching closing tag by tracking nesting depth
    const startIdx = startMatch.index + startMatch[0].length;
    const openRe = new RegExp(`<${marker.tag}[\\s>]`, 'gi');
    const closeRe = new RegExp(`</${marker.tag}>`, 'gi');
    let depth = 1;
    let pos = startIdx;
    const sub = t.slice(startIdx);
    
    // Walk through all open/close tags to find the matching close
    const allTags: { idx: number; isOpen: boolean }[] = [];
    let m2;
    openRe.lastIndex = 0;
    closeRe.lastIndex = 0;
    while ((m2 = openRe.exec(sub)) !== null) allTags.push({ idx: m2.index, isOpen: true });
    while ((m2 = closeRe.exec(sub)) !== null) allTags.push({ idx: m2.index, isOpen: false });
    allTags.sort((a, b) => a.idx - b.idx);
    
    for (const tag of allTags) {
      if (tag.isOpen) depth++;
      else {
        depth--;
        if (depth === 0) {
          const content = sub.slice(0, tag.idx);
          if (content.length > 200) {
            t = content;
            break;
          }
        }
      }
    }
    if (depth === 0 || t.length < html.length / 2) break;
  }

  // Strip remaining HTML tags
  t = t.replace(/<[^>]+>/g, ' ');
  // Decode entities
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Normalize whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ── Fetch page text content ──
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
  // If title says "down by X%" or "fell by X%", make the value negative
  if (v > 0 && /\b(down|fell|drop|decrease|decline|contract)\b/.test(tl)) v = -v;
  return v;
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

// ── FOMC Minutes — iterate through known meeting dates ──
async function fetchFomcMinutes(cutoffDate: string): Promise<It[]> {
  const items: It[] = [];
  const now = new Date();
  const cutoff = new Date(cutoffDate);
  
  // Generate potential FOMC meeting dates (typically every 6 weeks, Tue-Wed)
  // We check every Wednesday in the lookback period
  const candidates: Date[] = [];
  const d = new Date(now);
  while (d >= cutoff) {
    // FOMC meets ~8 times/year. Check all dates.
    candidates.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  
  // Known FOMC meeting end-dates for 2025-2026 (public schedule)
  const knownDates = [
    '20260128','20260318','20260506','20260617','20260729','20260917','20261028','20261216',
    '20250129','20250319','20250507','20250618','20250730','20250917','20251029','20251210',
  ];
  
  // Filter to dates within our lookback window
  const relevantDates = knownDates.filter(ds => {
    const y = parseInt(ds.slice(0, 4)), m = parseInt(ds.slice(4, 6)) - 1, day = parseInt(ds.slice(6, 8));
    const meetDate = new Date(y, m, day);
    return meetDate >= cutoff && meetDate <= now;
  });

  console.log('FOMC: checking ' + relevantDates.length + ' known meeting dates');

  // Try each date — minutes are published ~3 weeks after meeting
  const results = await Promise.allSettled(relevantDates.map(async (dateStr) => {
    const url = 'https://www.federalreserve.gov/monetarypolicy/fomcminutes' + dateStr + '.htm';
    const r = await sf(url, 12000);
    if (!r || !r.ok) return null;
    const html = await r.text();
    if (html.toLowerCase().includes('page not found') || html.length < 2000) return null;
    
    const text = extractText(html);
    if (text.length < 500) return null;
    
    console.log('FOMC Minutes found: ' + dateStr + ' (' + text.length + ' chars)');
    const s = sc(text, 'FOMC Minutes ' + dateStr);
    const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), day = dateStr.slice(6, 8);
    
    return {
      bank: 'FED', source: 'FOMC Minutes', item_date: y + '-' + m + '-' + day,
      title: 'FOMC Minutes — ' + m + '/' + day + '/' + y, url,
      is_statistical: false, ...s,
      stat_metric: null, stat_value: null, stat_weight: 0,
    } as It;
  }));

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) items.push(r.value);
  }
  return items;
}

// ── RSS feeds with full text fetching ──
const SKIP = new Set(['enforcement actions', 'orders on banking applications', 'other announcements', 'banking and consumer regulatory policy', 'community development']);
// Skip non-FOMC minutes items that contain "minutes" in the title (e.g. advisory committee minutes)
const MINUTES_SKIP = /minutes/i;

async function fetchRss(cs: string, bank: string): Promise<It[]> {
  const items: It[] = [];
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
    // Parse as RSS first, fallback to Atom (ECB speeches use Atom format)
    let rssItems = pi(xml).map(ri => ({ title: ri.title, link: ri.link, pubDate: ri.pubDate, cat: ri.cat }));
    if (!rssItems.length) {
      rssItems = ae(xml).map(e => ({ title: e.title, link: e.link, pubDate: e.updated, cat: '' }));
    }
    const filtered = rssItems.filter(ri => {
      const p = td(ri.pubDate);
      if (!p || p < cs) return false;
      if (f.lbl === 'Fed Press' && SKIP.has(ri.cat)) return false;
      // Exclude any non-FOMC "minutes" items (advisory council minutes etc.)
      if (bank === 'FED' && MINUTES_SKIP.test(ri.title)) return false;
      return true;
    }).slice(0, 50); // increased for 1-year lookback

    // Fetch full text for each item (in batches of 5 to avoid overwhelming)
    const scored: It[] = [];
    for (let i = 0; i < filtered.length; i += 5) {
      const batch = filtered.slice(i, i + 5);
      const textResults = await Promise.allSettled(
        batch.map(ri => ri.link ? fetchPageText(ri.link) : Promise.resolve(''))
      );
      for (let j = 0; j < batch.length; j++) {
        const ri = batch[j];
        const pub = td(ri.pubDate)!;
        const pageText = textResults[j].status === 'fulfilled' ? textResults[j].value : '';
        const s = sc(pageText, ri.title);
        scored.push({
          bank, source: f.lbl, item_date: pub,
          title: ri.title, url: ri.link,
          is_statistical: false, ...s,
          stat_metric: null, stat_value: null, stat_weight: 0,
        } as It);
      }
    }
    return scored;
  }));

  for (const r of res) if (r.status === 'fulfilled') items.push(...r.value);
  return items;
}

// ── ECB Stats + Eurostat ──
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
  // Filter out items with exactly 0.000 net_score — they add noise without signal
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
    console.log('SA v2.3: bank=' + bank + ' days=' + days);
    const co = new Date(); co.setDate(co.getDate() - days);
    const cs = co.toISOString().split('T')[0];
    const fk = Deno.env.get('FRED_API_KEY') || '';
    const result: Record<string, any> = {};

    if (bank === 'both' || bank === 'FED') {
      const [fr, rs, fomc] = await Promise.allSettled([
        fk ? fetchFred(fk, days) : Promise.resolve([]),
        fetchRss(cs, 'FED'),
        fetchFomcMinutes(cs),
      ]);
      const fi: It[] = [];
      if (fr.status === 'fulfilled') fi.push(...fr.value);
      if (rs.status === 'fulfilled') fi.push(...rs.value);
      if (fomc.status === 'fulfilled') fi.push(...fomc.value);
      const s1 = ag(fi.filter(i => !i.is_statistical)), s2 = ag(fi);
      await persist('FED', fi, s1, s2);
      result.fed = { items: fi, score_1: s1, score_2: s2 };
      console.log('Fed: ' + fi.length + ' items (comms: ' + s1.n + ', total: ' + s2.n + ')');
    }

    if (bank === 'both' || bank === 'ECB') {
      const [er, st] = await Promise.allSettled([fetchRss(cs, 'ECB'), fetchEcbStats(cs)]);
      const ei: It[] = [];
      if (er.status === 'fulfilled') ei.push(...er.value);
      if (st.status === 'fulfilled') ei.push(...st.value);
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
