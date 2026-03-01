// ── Fed Sentiment Analysis — fed-sentiment ──
// Handles FED data: RSS feeds, FOMC calendar, FRED API, DB persistence

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const HAWKISH_DIRECT = new Set(['rate hike','rate increase','tightening','hawkish','restrictive','above target','overheating','persistent inflation','price pressures','upside risks to inflation','insufficiently restrictive','further tightening','additional rate increases','need to raise','strong demand']);
const DOVISH_DIRECT = new Set(['rate cut','rate reduction','easing','dovish','accommodative','below target','disinflation','slowing','weaker growth','downside risks','disinflationary','progress on inflation','cutting rates','lower rates','policy pivot','sufficiently restrictive','well into restrictive territory']);
const DIRECTIONAL_PHRASES: Record<string, {hawk:string[];dove:string[]}> = {
  'wage growth':{hawk:['accelerat','rising','elevated','strong','above','picking up','remain high','persistently'],dove:['moderat','eased','easing','slowing','soften','deceler','cool','coming down']},
  'inflation':{hawk:['above target','persistently','sticky','broad-based','underlying','accelerat','rebound','uptick'],dove:['falling','declining','easing','retreating','moderat','path to','heading toward','lower','disinflation']},
  'growth':{hawk:['robust','strong','solid','resilient','accelerat','above trend','above potential'],dove:['slowing','contract','recession','weak','stagnant','deteriorat','downturn','falter']},
  'unemployment':{hawk:['historic low','tight','below natural','labour shortage','record low'],dove:['rising','elevated','increasing','higher','deteriorat','job losses']},
  'credit':{hawk:['accelerat','strong','expanding','excessive','overheating'],dove:['tightening','restrictive','slow','contract','weak']},
  'economic activity':{hawk:['expanding','strong','above expect','robust','accelerat'],dove:['contract','weak','below expect','deteriorat','slow']},
};

interface FredSpec { series_id:string; metric:string; transform:string; hawkish_threshold:number; dovish_threshold:number; direction:string; weight:number; }
const FRED_POLICY_SERIES: FredSpec[] = [
  {series_id:'CPIAUCSL',metric:'CPI Inflation (YoY)',transform:'pct_change_12',hawkish_threshold:3.0,dovish_threshold:2.0,direction:'high_hawk',weight:3.0},
  {series_id:'PAYEMS',metric:'Nonfarm Payrolls (MoM)',transform:'diff_1',hawkish_threshold:200,dovish_threshold:100,direction:'high_hawk',weight:3.0},
  {series_id:'UNRATE',metric:'Unemployment Rate',transform:'level',hawkish_threshold:4.0,dovish_threshold:5.0,direction:'low_hawk',weight:3.0},
  {series_id:'GDP',metric:'Real GDP Growth (QoQ ann.)',transform:'pct_change_1_ann',hawkish_threshold:2.5,dovish_threshold:1.0,direction:'high_hawk',weight:3.0},
  {series_id:'PCEPILFE',metric:'Core PCE Inflation (YoY)',transform:'pct_change_12',hawkish_threshold:2.5,dovish_threshold:2.0,direction:'high_hawk',weight:3.0},
  {series_id:'FEDFUNDS',metric:'Fed Funds Rate',transform:'level',hawkish_threshold:5.0,dovish_threshold:3.0,direction:'high_hawk',weight:1.0},
  {series_id:'RSAFS',metric:'Retail Sales (MoM %)',transform:'pct_change_1',hawkish_threshold:0.5,dovish_threshold:-0.2,direction:'high_hawk',weight:2.0},
  {series_id:'INDPRO',metric:'Industrial Production (MoM %)',transform:'pct_change_1',hawkish_threshold:0.3,dovish_threshold:-0.3,direction:'high_hawk',weight:2.0},
];

interface StatRule { pattern:string; metric:string; number_regex:string|null; hawkish_threshold:number|null; dovish_threshold:number|null; direction:string; weight:number; }
const FED_STAT_RULES: StatRule[] = [
  {pattern:'discount rate',metric:'Discount rate minutes sentiment',number_regex:null,hawkish_threshold:null,dovish_threshold:null,direction:'text_only',weight:1.5},
  {pattern:'minutes.*(?:fomc|federal open market|meeting)|fomc\\s+minutes',metric:'FOMC Minutes sentiment',number_regex:null,hawkish_threshold:null,dovish_threshold:null,direction:'text_only',weight:3.0},
  {pattern:'beige book|summary of commentary',metric:'Beige Book sentiment',number_regex:null,hawkish_threshold:null,dovish_threshold:null,direction:'text_only',weight:2.5},
];
const FED_SKIP_CATEGORIES = new Set(['enforcement actions','orders on banking applications','other announcements','banking and consumer regulatory policy','community development']);
const MIN_BOUNDARY_SCORE = 0.15;

interface SentimentItem {
  bank:string; source:string; item_date:string; title:string; url:string;
  is_statistical:boolean; hawk_pts:number; dove_pts:number; net_score:number;
  label:string; word_count:number; reasons:string[];
  stat_metric:string|null; stat_value:number|null; stat_weight:number;
}

function scoreSentiment(text:string, title='') {
  const combined = (title + ' ' + text).toLowerCase();
  let hawk_pts = 0, dove_pts = 0;
  const reasons:string[] = [];
  for (const w of HAWKISH_DIRECT) { if (combined.includes(w)) { hawk_pts += 1; reasons.push('hawk:' + w); } }
  for (const w of DOVISH_DIRECT) { if (combined.includes(w)) { dove_pts += 1; reasons.push('dove:' + w); } }
  for (const [phrase, mods] of Object.entries(DIRECTIONAL_PHRASES)) {
    let idx = combined.indexOf(phrase);
    while (idx !== -1) {
      const ctx = combined.slice(Math.max(0, idx - 150), Math.min(combined.length, idx + phrase.length + 150));
      const hasH = mods.hawk.some(h => ctx.includes(h));
      const hasD = mods.dove.some(d => ctx.includes(d));
      if (hasH && !hasD) { hawk_pts += 5; reasons.push('dir_hawk:' + phrase); }
      else if (hasD && !hasH) { dove_pts += 5; reasons.push('dir_dove:' + phrase); }
      idx = combined.indexOf(phrase, idx + 1);
    }
  }
  const wc = Math.max(combined.split(/\s+/).length, 1);
  const net = ((hawk_pts - dove_pts) / wc) * 100;
  const label = net > 0.05 ? 'hawkish' : (net < -0.05 ? 'dovish' : 'neutral');
  return { hawk_pts, dove_pts, net_score: Math.round(net * 1000) / 1000, label, word_count: wc, reasons };
}

function scoreFromValue(val:number, ht:number, dt:number, direction:string, weight:number, metric:string) {
  let raw:number, label:string;
  if (direction === 'low_hawk') {
    if (val <= ht) { raw = Math.max(Math.min((ht - val) / Math.max(Math.abs(ht), 1) * 2, 2.0), MIN_BOUNDARY_SCORE); label = 'hawkish'; }
    else if (val >= dt) { raw = -Math.max(Math.min((val - dt) / Math.max(Math.abs(dt), 1) * 2, 2.0), MIN_BOUNDARY_SCORE); label = 'dovish'; }
    else { raw = -(val - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1); label = raw > 0.05 ? 'hawkish' : (raw < -0.05 ? 'dovish' : 'neutral'); }
  } else {
    if (val >= ht) { raw = Math.max(Math.min((val - ht) / Math.max(Math.abs(ht), 1) * 2, 2.0), MIN_BOUNDARY_SCORE); label = 'hawkish'; }
    else if (val <= dt) { raw = -Math.max(Math.min(Math.abs(dt - val) / Math.max(Math.abs(dt), 1) * 2, 2.0), MIN_BOUNDARY_SCORE); label = 'dovish'; }
    else { raw = (val - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1); label = raw > 0.05 ? 'hawkish' : (raw < -0.05 ? 'dovish' : 'neutral'); }
  }
  return { net_score: Math.round(raw * weight * 1000) / 1000, label, metric, value_found: Math.round(val * 100) / 100, weight };
}

function extractNum(title:string):number|null {
  const tl = title.toLowerCase();
  const m = tl.match(new RegExp('(-?\\d+\\.?\\d*)\\s*%'));
  if (!m || m.index === undefined) return null;
  let val = parseFloat(m[1]);
  if (isNaN(val)) return null;
  const prefix = tl.slice(Math.max(0, m.index - 40), m.index);
  const neg = ['down by','down ','fell by','fell ','decreased by','decreased ','declined by','declined ','dropped by','dropped ','contraction'];
  const pos = ['up by','up ','grew by','grew ','increased by','increased ','rose by','rose '];
  if (neg.some(n => prefix.includes(n)) && !pos.some(p => prefix.includes(p))) val = -Math.abs(val);
  else if (pos.some(p => prefix.includes(p)) && !neg.some(n => prefix.includes(n))) val = Math.abs(val);
  return val;
}

function extractCdata(xmlFragment:string, tagName:string):string {
  const re = new RegExp('<' + tagName + '[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + tagName + '>', 'i');
  const m = xmlFragment.match(re);
  return m ? m[1].trim() : '';
}

function parseXmlItems(xml:string):{title:string;link:string;pubDate:string;category:string;description:string}[] {
  const items:{title:string;link:string;pubDate:string;category:string;description:string}[] = [];
  const re = new RegExp('<item>([\\s\\S]*?)</item>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push({ title: extractCdata(m[1], 'title'), link: extractCdata(m[1], 'link') || extractCdata(m[1], 'guid'), pubDate: extractCdata(m[1], 'pubDate'), category: extractCdata(m[1], 'category').toLowerCase(), description: extractCdata(m[1], 'description') });
  }
  return items;
}

function parseRssDate(text:string):string|null {
  if (!text) return null;
  try { const d = new Date(text); return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]; } catch(_e) { return null; }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function safeFetch(url:string, timeoutMs=12000):Promise<Response|null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, { headers: {'User-Agent': UA}, signal: controller.signal });
    clearTimeout(timer);
    return r;
  } catch(_e) { return null; }
}

function extractMainContent(html:string):string {
  const patterns = [
    new RegExp('<div[^>]+id=["\']article["\'][^>]*>([\\s\\S]*?)</div>\\s*(?:<div[^>]+class=["\'](?:footer|row)|</main>|$)', 'i'),
    new RegExp('<main[^>]*>([\\s\\S]*?)</main>', 'i'),
    new RegExp('<article[^>]*>([\\s\\S]*?)</article>', 'i'),
  ];
  let content = '';
  for (const pat of patterns) { const m = html.match(pat); if (m && m[1] && m[1].length > 200) { content = m[1]; break; } }
  if (!content) content = html;
  content = content.replace(new RegExp('<script[\\s\\S]*?</script>', 'gi'), '');
  content = content.replace(new RegExp('<style[\\s\\S]*?</style>', 'gi'), '');
  content = content.replace(new RegExp('<[^>]+>', 'g'), ' ');
  content = content.replace(new RegExp('&amp;', 'g'), '&').replace(new RegExp('&lt;', 'g'), '<').replace(new RegExp('&gt;', 'g'), '>').replace(new RegExp('&nbsp;', 'g'), ' ').replace(new RegExp('&#\\d+;', 'g'), ' ');
  return content.replace(new RegExp('\\s+', 'g'), ' ').trim().slice(0, 60000);
}

async function fetchPageText(url:string):Promise<string> {
  const resp = await safeFetch(url);
  if (!resp || !resp.ok) return '';
  return extractMainContent(await resp.text());
}

async function batchFetchTexts(urls:string[], concurrency=5):Promise<Map<string,string>> {
  const results = new Map<string,string>();
  for (let i = 0; i < urls.length; i += concurrency) {
    const settled = await Promise.allSettled(urls.slice(i, i + concurrency).map(async (url) => ({ url, text: await fetchPageText(url) })));
    for (const r of settled) { if (r.status === 'fulfilled') results.set(r.value.url, r.value.text); }
  }
  return results;
}

async function analyzeStatRelease(title:string, url:string, summary:string, rules:StatRule[]) {
  const tl = title.toLowerCase();
  let rule: StatRule|null = null;
  for (const r of rules) { if (new RegExp(r.pattern, 'i').test(tl)) { rule = r; break; } }
  if (rule && rule.direction === 'text_only' && url) {
    const pt = await fetchPageText(url);
    if (pt) { const s = scoreSentiment(pt, title); return { net_score: Math.round(s.net_score * rule.weight * 1000) / 1000, label: s.label, metric: rule.metric, value_found: null, weight: rule.weight, method: 'text' }; }
  }
  return { net_score: 0, label: 'neutral', metric: rule?.metric || 'unavailable', value_found: null, weight: rule?.weight || 0, method: 'none' };
}

async function fetchFredData(apiKey:string, daysCutoff=90):Promise<SentimentItem[]> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysCutoff);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const results = await Promise.allSettled(FRED_POLICY_SERIES.map(async (spec) => {
    const resp = await safeFetch('https://api.stlouisfed.org/fred/series/observations?series_id=' + spec.series_id + '&api_key=' + apiKey + '&file_type=json&sort_order=desc&limit=15');
    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    const obs = (data.observations || []).filter((o:any) => o.value !== '.');
    if (!obs.length || obs[0].date < cutoffStr) return null;
    const vals = obs.map((o:any) => parseFloat(o.value));
    let val:number|null = null;
    if (spec.transform === 'level') val = vals[0];
    else if (spec.transform === 'diff_1' && vals.length >= 2) val = vals[0] - vals[1];
    else if (spec.transform === 'pct_change_1' && vals.length >= 2 && vals[1] !== 0) val = ((vals[0] - vals[1]) / Math.abs(vals[1])) * 100;
    else if (spec.transform === 'pct_change_1_ann' && vals.length >= 2 && vals[1] !== 0) { const q = (vals[0] - vals[1]) / Math.abs(vals[1]); val = (Math.pow(1 + q, 4) - 1) * 100; }
    else if (spec.transform === 'pct_change_12' && vals.length >= 13 && vals[12] !== 0) val = ((vals[0] - vals[12]) / Math.abs(vals[12])) * 100;
    if (val === null) return null;
    const r = scoreFromValue(val, spec.hawkish_threshold, spec.dovish_threshold, spec.direction, spec.weight, spec.metric);
    return { bank:'FED', source:'FRED', item_date:obs[0].date, title: spec.metric + ': ' + val.toFixed(2) + ' (' + spec.series_id + ')', url:'https://fred.stlouisfed.org/series/' + spec.series_id, is_statistical:true, hawk_pts:0, dove_pts:0, net_score:r.net_score, label:r.label, word_count:0, reasons:['fred_api'], stat_metric:r.metric, stat_value:r.value_found, stat_weight:r.weight } as SentimentItem;
  }));
  const items:SentimentItem[] = [];
  for (const r of results) { if (r.status === 'fulfilled' && r.value) items.push(r.value); }
  return items;
}

const FOMC_BASE = 'https://www.federalreserve.gov';

function parseFomcLinks(html:string, pattern:RegExp):{date:string;url:string}[] {
  const links:{date:string;url:string}[] = [];
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const href = m[1].startsWith('http') ? m[1] : FOMC_BASE + m[1];
    const dm = href.match(new RegExp('(?:monetary|fomcminutes|fomcpresconf)(\\d{8})'));
    if (dm) { const d = dm[1]; links.push({ date: d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8), url: href }); }
  }
  links.sort((a, b) => b.date.localeCompare(a.date));
  return links;
}

async function parseBoardRss(feedUrl:string, sourceLabel:string, key:string, cutoffStr:string, limit:number, fetchText:boolean):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  const resp = await safeFetch(feedUrl);
  if (!resp || !resp.ok) return items;
  let xml = await resp.text();
  xml = xml.replace(new RegExp('&(?!amp;|lt;|gt;|quot;|apos;|#)', 'g'), '&amp;');
  const rssItems = parseXmlItems(xml);
  const valid = rssItems.filter(ri => { const p = parseRssDate(ri.pubDate); return p && p >= cutoffStr; }).slice(0, limit);
  const textUrls:string[] = [];
  const statItems:{ri:typeof rssItems[0];pub:string}[] = [];
  const commItems:{ri:typeof rssItems[0];pub:string}[] = [];
  for (const ri of valid) {
    const pub = parseRssDate(ri.pubDate)!;
    if (key === 'press') {
      if (FED_SKIP_CATEGORIES.has(ri.category)) continue;
      const tl = ri.title.toLowerCase();
      if (tl.includes('minutes of the federal open market') || tl.includes('fomc minutes') || (tl.includes('discount rate') && tl.includes('minutes'))) { statItems.push({ri,pub}); continue; }
    }
    commItems.push({ri,pub});
    if (fetchText && ri.link) textUrls.push(ri.link);
  }
  const textMap = fetchText ? await batchFetchTexts(textUrls, 5) : new Map<string,string>();
  for (const {ri,pub} of statItems) {
    const sa = await analyzeStatRelease(ri.title, ri.link, '', FED_STAT_RULES);
    items.push({ bank:'FED', source: ri.title.toLowerCase().includes('discount rate') ? 'Fed Discount Rate Minutes' : 'FOMC Minutes (press)', item_date:pub, title:ri.title, url:ri.link, is_statistical:true, hawk_pts:0, dove_pts:0, net_score:sa.net_score, label:sa.label, word_count:0, reasons:[sa.method], stat_metric:sa.metric, stat_value:sa.value_found, stat_weight:sa.weight });
  }
  for (const {ri,pub} of commItems) {
    const score = scoreSentiment(textMap.get(ri.link) || '', ri.title);
    items.push({ bank:'FED', source:sourceLabel, item_date:pub, title:ri.title, url:ri.link, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 });
  }
  return items;
}

async function parseRegionalFed(cutoffStr:string, fetchText:boolean):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  try {
    const resp = await safeFetch('https://www.frbsf.org/feed/', 8000);
    if (!resp || !resp.ok) return items;
    let xml = await resp.text();
    xml = xml.replace(new RegExp('&(?!amp;|lt;|gt;|quot;|apos;|#)', 'g'), '&amp;');
    const rssItems = parseXmlItems(xml).filter(ri => { const p = parseRssDate(ri.pubDate); return p && p >= cutoffStr; }).slice(0, 5);
    const textMap = fetchText ? await batchFetchTexts(rssItems.map(ri => ri.link).filter(Boolean), 3) : new Map<string,string>();
    for (const ri of rssItems) {
      const pub = parseRssDate(ri.pubDate)!;
      const score = scoreSentiment(textMap.get(ri.link) || '', ri.title);
      items.push({ bank:'FED', source:'SF Fed Speech', item_date:pub, title:'[SF Fed] '+ri.title, url:ri.link, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 });
    }
  } catch(_e) { /* skip */ }
  return items;
}

async function fetchFedData(daysBack=60, fetchText=true):Promise<SentimentItem[]> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const items:SentimentItem[] = [];
  console.log('Fed: fetching FOMC calendar + RSS...');
  const [calR, spR, teR, prR, rgR] = await Promise.allSettled([
    (async () => { const r = await safeFetch(FOMC_BASE+'/monetarypolicy/fomccalendars.htm'); return r && r.ok ? await r.text() : ''; })(),
    parseBoardRss('https://www.federalreserve.gov/feeds/speeches.xml', 'Fed Speech', 'speeches', cutoffStr, 20, fetchText),
    parseBoardRss('https://www.federalreserve.gov/feeds/testimony.xml', 'Fed Testimony', 'testimony', cutoffStr, 15, fetchText),
    parseBoardRss('https://www.federalreserve.gov/feeds/press_all.xml', 'Fed Press', 'press', cutoffStr, 20, fetchText),
    parseRegionalFed(cutoffStr, fetchText),
  ]);
  if (spR.status === 'fulfilled') { items.push(...spR.value); console.log('Speeches: '+spR.value.length); }
  if (teR.status === 'fulfilled') { items.push(...teR.value); console.log('Testimony: '+teR.value.length); }
  if (prR.status === 'fulfilled') { items.push(...prR.value); console.log('Press: '+prR.value.length); }
  if (rgR.status === 'fulfilled') { items.push(...rgR.value); console.log('Regional: '+rgR.value.length); }
  const calHtml = calR.status === 'fulfilled' ? calR.value : '';
  if (calHtml) {
    const stmtLinks = parseFomcLinks(calHtml, new RegExp('href="([^"]*newsevents\\/pressreleases\\/monetary\\d{8}[^"]*)"', 'gi'));
    const recentStmts = stmtLinks.filter(l => l.date >= cutoffStr).slice(0, 3);
    if (recentStmts.length) {
      const stmtTexts = await batchFetchTexts(recentStmts.map(s => s.url), 3);
      for (const {date,url} of recentStmts) { const score = scoreSentiment(stmtTexts.get(url)||'', 'FOMC Statement'); items.push({ bank:'FED', source:'FOMC Statement', item_date:date, title:'FOMC Statement - '+date, url, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 }); }
    }
    const minLinks = parseFomcLinks(calHtml, new RegExp('href="([^"]*fomcminutes\\d{8}[^"]*)"', 'gi'));
    for (const {date,url} of minLinks.filter(l => l.date >= cutoffStr).slice(0, 2)) {
      const sa = await analyzeStatRelease('Minutes of the FOMC meeting '+date, url, '', FED_STAT_RULES);
      items.push({ bank:'FED', source:'FOMC Minutes', item_date:date, title:'FOMC Minutes - '+date, url, is_statistical:true, hawk_pts:0, dove_pts:0, net_score:sa.net_score, label:sa.label, word_count:0, reasons:[sa.method], stat_metric:sa.metric, stat_value:sa.value_found, stat_weight:sa.weight });
    }
    const pcLinks = parseFomcLinks(calHtml, new RegExp('href="([^"]*fomcpresconf\\d{8}[^"]*)"', 'gi'));
    const recentPc = pcLinks.filter(l => l.date >= cutoffStr).slice(0, 2);
    if (recentPc.length) {
      const pcTexts = await batchFetchTexts(recentPc.map(p => p.url), 2);
      for (const {date,url} of recentPc) { const text = pcTexts.get(url)||''; if (text.length < 200) continue; const score = scoreSentiment(text, 'FOMC Press Conference '+date+' (Powell)'); items.push({ bank:'FED', source:'FOMC Press Conference', item_date:date, title:'FOMC Press Conference - '+date+' (Powell)', url, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 }); }
    }
  }
  return items;
}

function computeDualScores(items:SentimentItem[]) {
  const comms = items.filter(i => !i.is_statistical);
  function agg(sub:SentimentItem[]) {
    if (!sub.length) return { avg:0, n:0, dist:{} as Record<string,number>, sentiment:'NEUTRAL' };
    const avg = Math.round(sub.reduce((s, i) => s + i.net_score, 0) / sub.length * 1000) / 1000;
    const sentiment = avg <= -0.5 ? 'STRONGLY DOVISH' : avg < -0.1 ? 'DOVISH' : avg >= 0.5 ? 'STRONGLY HAWKISH' : avg > 0.1 ? 'HAWKISH' : 'NEUTRAL';
    const dist:Record<string,number> = {};
    for (const i of sub) dist[i.label] = (dist[i.label] || 0) + 1;
    return { avg, n:sub.length, dist, sentiment };
  }
  return { score_1: agg(comms), score_2: agg(items) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const daysBack = parseInt(url.searchParams.get('days') || '60');
    const fetchText = url.searchParams.get('fetch_text') !== 'false';
    const FRED_KEY = Deno.env.get('FRED_API_KEY') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log('=== Fed Sentiment Analysis ===');
    const fedItems = await fetchFedData(daysBack, fetchText);
    if (FRED_KEY) { const fr = await fetchFredData(FRED_KEY, daysBack + 30); fedItems.push(...fr); console.log('FRED: '+fr.length); }
    const seen = new Set<string>();
    const deduped = fedItems.filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true; }).sort((a,b) => b.item_date.localeCompare(a.item_date));
    const scores = computeDualScores(deduped);
    console.log('Fed: '+deduped.length+' items, S1='+scores.score_1.avg+', S2='+scores.score_2.avg);
    try {
      await supabase.from('sentiment_items').delete().eq('bank', 'FED');
      for (let i = 0; i < deduped.length; i += 50) await supabase.from('sentiment_items').insert(deduped.slice(i, i + 50).map(it => ({ bank:it.bank, source:it.source, item_date:it.item_date, title:it.title, url:it.url, is_statistical:it.is_statistical, hawk_pts:it.hawk_pts, dove_pts:it.dove_pts, net_score:it.net_score, label:it.label, word_count:it.word_count, reasons:it.reasons, stat_metric:it.stat_metric, stat_value:it.stat_value, stat_weight:it.stat_weight })));
      await supabase.from('sentiment_scores').insert({ bank:'FED', score_1_avg:scores.score_1.avg, score_1_count:scores.score_1.n, score_1_label:scores.score_1.sentiment, score_1_dist:scores.score_1.dist, score_2_avg:scores.score_2.avg, score_2_count:scores.score_2.n, score_2_label:scores.score_2.sentiment, score_2_dist:scores.score_2.dist });
    } catch(e) { console.error('DB FED:', e); }

    return new Response(JSON.stringify({ fed: { items: deduped, ...scores } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch(error) {
    console.error('Fed error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
