// ── ECB Sentiment Analysis — ecb-sentiment ──
// Handles ECB data: RSS feeds, Eurostat, ECB statements, DB persistence

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

interface StatRule { pattern:string; metric:string; number_regex:string|null; hawkish_threshold:number|null; dovish_threshold:number|null; direction:string; weight:number; }
const EUROSTAT_RULES: StatRule[] = [
  {pattern:'inflation',metric:'HICP inflation',number_regex:'(\\d+\\.?\\d*)\\s*%',hawkish_threshold:2.5,dovish_threshold:1.8,direction:'high_hawk',weight:3},
  {pattern:'gdp',metric:'GDP growth',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.4,dovish_threshold:0.1,direction:'high_hawk',weight:3},
  {pattern:'unemployment',metric:'Unemployment rate',number_regex:'(\\d+\\.?\\d*)\\s*%',hawkish_threshold:6.0,dovish_threshold:7.5,direction:'low_hawk',weight:3},
  {pattern:'employment\\s+(?:up|down|grew|increased|decreased)',metric:'Employment growth',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.3,dovish_threshold:0.0,direction:'high_hawk',weight:3.0},
  {pattern:'industrial production',metric:'Industrial production',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.5,dovish_threshold:-0.5,direction:'high_hawk',weight:2.0},
  {pattern:'retail trade',metric:'Retail trade volume',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.5,dovish_threshold:-0.5,direction:'high_hawk',weight:2.0},
  {pattern:'services production',metric:'Services production',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.5,dovish_threshold:-0.5,direction:'high_hawk',weight:2.0},
  {pattern:'producer prices',metric:'PPI / Producer prices',number_regex:'(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:0.5,dovish_threshold:-0.3,direction:'high_hawk',weight:2.0},
  {pattern:'monetary developments',metric:'M3 money supply growth',number_regex:'M3.*?(\\-?\\d+\\.?\\d*)\\s*%',hawkish_threshold:5.0,dovish_threshold:2.0,direction:'high_hawk',weight:1.0},
  {pattern:'bank interest rate statistics',metric:'Bank lending rates',number_regex:'(\\d+\\.?\\d*)\\s*%',hawkish_threshold:4.0,dovish_threshold:2.0,direction:'high_hawk',weight:1.0},
  {pattern:'trade in goods',metric:'Trade balance',number_regex:'(\\-?\\d+\\.?\\d*)\\s*(?:bn|billion)',hawkish_threshold:20.0,dovish_threshold:-5.0,direction:'high_hawk',weight:0.3},
  {pattern:'meeting of|minutes',metric:'Meeting minutes sentiment',number_regex:null,hawkish_threshold:null,dovish_threshold:null,direction:'text_only',weight:2.0},
];
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

function extractAttr(xmlFragment:string, tagName:string, attrName:string):string {
  const re = new RegExp('<' + tagName + '[^>]+' + attrName + '=["\']([^"\']+)["\']', 'i');
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

function parseAtomEntries(xml:string):{title:string;link:string;updated:string;summary:string}[] {
  const entries:{title:string;link:string;updated:string;summary:string}[] = [];
  const re = new RegExp('<entry>([\\s\\S]*?)</entry>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    entries.push({ title: extractCdata(m[1], 'title'), link: extractAttr(m[1], 'link', 'href'), updated: extractCdata(m[1], 'updated'), summary: extractCdata(m[1], 'summary') });
  }
  return entries;
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
  if (rule && rule.number_regex && rule.direction !== 'text_only') {
    const tv = extractNum(title);
    if (tv !== null) return { ...scoreFromValue(tv, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric), method: 'numeric' };
    const nm = (title + ' ' + summary).match(new RegExp(rule.number_regex, 'i'));
    if (nm) { const v = parseFloat(nm[1]); if (!isNaN(v)) return { ...scoreFromValue(v, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric), method: 'numeric' }; }
  }
  if (rule && rule.direction === 'text_only' && url) {
    const pt = await fetchPageText(url);
    if (pt) { const s = scoreSentiment(pt, title); return { net_score: Math.round(s.net_score * rule.weight * 1000) / 1000, label: s.label, metric: rule.metric, value_found: null, weight: rule.weight, method: 'text' }; }
  }
  return { net_score: 0, label: 'neutral', metric: rule?.metric || 'unavailable', value_found: null, weight: rule?.weight || 0, method: 'none' };
}

async function fetchEcbData(daysBack=60, fetchText=true):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const feeds = [
    {url:'https://www.ecb.europa.eu/rss/press.html',label:'ECB Press',key:'press'},
    {url:'https://www.ecb.europa.eu/rss/blog.html',label:'ECB Blog',key:'blog'},
    {url:'https://www.ecb.europa.eu/rss/statpress.html',label:'ECB Stats',key:'stats'},
  ];
  const feedResults = await Promise.allSettled(feeds.map(async (f) => { const r = await safeFetch(f.url); return r && r.ok ? {feed:f, xml: await r.text()} : {feed:f, xml:''}; }));
  for (const fr of feedResults) {
    if (fr.status !== 'fulfilled' || !fr.value.xml) continue;
    const {feed, xml} = fr.value;
    const rssItems = parseXmlItems(xml).filter(ri => { const p = parseRssDate(ri.pubDate); return p && p >= cutoffStr; }).slice(0, 20);
    if (feed.key === 'stats') {
      for (const ri of rssItems) { const pub = parseRssDate(ri.pubDate)!; const sa = await analyzeStatRelease(ri.title, ri.link, '', EUROSTAT_RULES); items.push({ bank:'ECB', source:feed.label, item_date:pub, title:ri.title, url:ri.link, is_statistical:true, hawk_pts:0, dove_pts:0, net_score:sa.net_score, label:sa.label, word_count:0, reasons:[sa.method], stat_metric:sa.metric, stat_value:sa.value_found, stat_weight:sa.weight }); }
    } else {
      const textMap = fetchText ? await batchFetchTexts(rssItems.map(ri => ri.link).filter(Boolean), 5) : new Map<string,string>();
      for (const ri of rssItems) { const pub = parseRssDate(ri.pubDate)!; const score = scoreSentiment(textMap.get(ri.link)||'', ri.title); items.push({ bank:'ECB', source:feed.label, item_date:pub, title:ri.title, url:ri.link, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 }); }
    }
  }
  try {
    const euroUrl = 'https://ec.europa.eu/eurostat/web/main/news/euro-indicators?p_p_id=estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=atom&p_p_cacheability=cacheLevelPage&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageNumber=1&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageSize=20&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_sort=lastUpdateDate&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_collection=CAT_PREREL';
    const resp = await safeFetch(euroUrl);
    if (resp && resp.ok) {
      const entries = parseAtomEntries(await resp.text());
      for (const entry of entries) { const pub = entry.updated ? new Date(entry.updated).toISOString().split('T')[0] : null; if (!pub || pub < cutoffStr) continue; const sa = await analyzeStatRelease(entry.title, entry.link, entry.summary, EUROSTAT_RULES); items.push({ bank:'ECB', source:'Eurostat', item_date:pub, title:entry.title, url:entry.link, is_statistical:true, hawk_pts:0, dove_pts:0, net_score:sa.net_score, label:sa.label, word_count:0, reasons:[sa.method], stat_metric:sa.metric, stat_value:sa.value_found, stat_weight:sa.weight }); }
    }
  } catch(e) { console.error('Eurostat:', e); }
  try {
    const stmtResp = await safeFetch('https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/html/index.en.html');
    if (stmtResp && stmtResp.ok) {
      const html = await stmtResp.text();
      const linkRe = new RegExp('href="([^"]*(?:ecb\\.is|ecb\\.mp)[^"]*\\.en\\.html)"', 'gi');
      const stmtLinks:{date:string;url:string}[] = [];
      let lm;
      while ((lm = linkRe.exec(html)) !== null) { const href = lm[1].startsWith('http') ? lm[1] : 'https://www.ecb.europa.eu'+lm[1]; const dm = href.match(new RegExp('(?:is|mp)(\\d{2})(\\d{2})(\\d{2})')); if (dm) stmtLinks.push({date:'20'+dm[1]+'-'+dm[2]+'-'+dm[3], url:href}); }
      stmtLinks.sort((a,b) => b.date.localeCompare(a.date));
      if (stmtLinks.length && stmtLinks[0].date >= cutoffStr) { const {date,url} = stmtLinks[0]; const score = scoreSentiment(await fetchPageText(url), 'ECB Monetary Policy Statement'); items.push({ bank:'ECB', source:'ECB Monetary Policy Statement', item_date:date, title:'ECB Monetary Policy Statement', url, is_statistical:false, ...score, stat_metric:null, stat_value:null, stat_weight:0 }); }
    }
  } catch(e) { console.error('ECB stmt:', e); }
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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log('=== ECB Sentiment Analysis ===');
    const ecbItems = await fetchEcbData(daysBack, fetchText);
    const seen = new Set<string>();
    const deduped = ecbItems.filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true; }).sort((a,b) => b.item_date.localeCompare(a.item_date));
    const scores = computeDualScores(deduped);
    console.log('ECB: '+deduped.length+' items, S1='+scores.score_1.avg+', S2='+scores.score_2.avg);
    try {
      await supabase.from('sentiment_items').delete().eq('bank', 'ECB');
      for (let i = 0; i < deduped.length; i += 50) await supabase.from('sentiment_items').insert(deduped.slice(i, i + 50).map(it => ({ bank:it.bank, source:it.source, item_date:it.item_date, title:it.title, url:it.url, is_statistical:it.is_statistical, hawk_pts:it.hawk_pts, dove_pts:it.dove_pts, net_score:it.net_score, label:it.label, word_count:it.word_count, reasons:it.reasons, stat_metric:it.stat_metric, stat_value:it.stat_value, stat_weight:it.stat_weight })));
      await supabase.from('sentiment_scores').insert({ bank:'ECB', score_1_avg:scores.score_1.avg, score_1_count:scores.score_1.n, score_1_label:scores.score_1.sentiment, score_1_dist:scores.score_1.dist, score_2_avg:scores.score_2.avg, score_2_count:scores.score_2.n, score_2_label:scores.score_2.sentiment, score_2_dist:scores.score_2.dist });
    } catch(e) { console.error('DB ECB:', e); }

    return new Response(JSON.stringify({ ecb: { items: deduped, ...scores } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch(error) {
    console.error('ECB error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
