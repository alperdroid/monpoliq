import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const HAWKISH_DIRECT = new Set(['rate hike','rate increase','tightening','hawkish','restrictive','above target','overheating','persistent inflation','price pressures','upside risks to inflation','insufficiently restrictive','further tightening','additional rate increases','need to raise','strong demand']);
const DOVISH_DIRECT = new Set(['rate cut','rate reduction','easing','dovish','accommodative','below target','disinflation','slowing','weaker growth','downside risks','disinflationary','progress on inflation','cutting rates','lower rates','policy pivot','sufficiently restrictive','well into restrictive territory']);
const DIRECTIONAL_PHRASES: Record<string, {hawk:string[];dove:string[]}> = {
  'wage growth':{hawk:['accelerat','rising','elevated','strong','above','picking up','remain high','persistently'],dove:['moderat','eased','easing','slowing','soften','deceler','cool','coming down']},
  'inflation':{hawk:['above target','persistently','sticky','broad-based','underlying','accelerat','rebound','uptick'],dove:['falling','declining','easing','retreating','moderat','approach.*target','path to','heading toward','lower','disinflation']},
  'growth':{hawk:['robust','strong','solid','resilient','accelerat','above trend','above potential'],dove:['slowing','contract','recession','weak','stagnant','deteriorat','downturn','falter']},
  'unemployment':{hawk:['historic low','tight','below natural','labour shortage','record low'],dove:['rising','elevated','increasing','higher','deteriorat','job losses']},
  'credit':{hawk:['accelerat','strong','expanding','excessive','overheating'],dove:['tightening','restrictive','slow','contract','weak']},
  'economic activity':{hawk:['expanding','strong','above expect','robust','accelerat'],dove:['contract','weak','below expect','deteriorat','slow']},
};

interface FredSpec { series_id:string; metric:string; transform:string; hawkish_threshold:number; dovish_threshold:number; direction:string; weight:number; }
const FRED_POLICY_SERIES: FredSpec[] = [
  {series_id:'CPIAUCSL',metric:'CPI Inflation (YoY)',transform:'pct_change_12',hawkish_threshold:3.0,dovish_threshold:2.0,direction:'high_hawk',weight:3.0},
  {series_id:'PAYEMS',metric:'Nonfarm Payrolls (MoM \u0394k)',transform:'diff_1',hawkish_threshold:200,dovish_threshold:100,direction:'high_hawk',weight:3.0},
  {series_id:'UNRATE',metric:'Unemployment Rate',transform:'level',hawkish_threshold:4.0,dovish_threshold:5.0,direction:'low_hawk',weight:3.0},
  {series_id:'GDP',metric:'Real GDP Growth (QoQ ann.)',transform:'pct_change_1_ann',hawkish_threshold:2.5,dovish_threshold:1.0,direction:'high_hawk',weight:3.0},
  {series_id:'PCEPILFE',metric:'Core PCE Inflation (YoY)',transform:'pct_change_12',hawkish_threshold:2.5,dovish_threshold:2.0,direction:'high_hawk',weight:3.0},
  {series_id:'FEDFUNDS',metric:'Fed Funds Rate',transform:'level',hawkish_threshold:5.0,dovish_threshold:3.0,direction:'high_hawk',weight:1.0},
  {series_id:'RSAFS',metric:'Retail Sales (MoM %)',transform:'pct_change_1',hawkish_threshold:0.5,dovish_threshold:-0.2,direction:'high_hawk',weight:2.0},
  {series_id:'INDPRO',metric:'Industrial Production (MoM %)',transform:'pct_change_1',hawkish_threshold:0.3,dovish_threshold:-0.3,direction:'high_hawk',weight:2.0},
];

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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function safeFetch(url:string, timeoutMs:number=12000):Promise<Response|null> {
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
    /<div[^>]+id=["']article["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]+class=["'](?:footer|row)|<\/main>|$)/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];
  let content = '';
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1] && m[1].length > 200) { content = m[1]; break; }
  }
  if (!content) content = html;
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<[^>]+>/g, ' ');
  content = content.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,' ');
  return content.replace(/\s+/g, ' ').trim().slice(0, 60000);
}

async function fetchPageText(url:string):Promise<string> {
  const resp = await safeFetch(url);
  if (!resp || !resp.ok) return '';
  const html = await resp.text();
  return extractMainContent(html);
}

function extractCdata(xmlFragment:string, tagName:string):string {
  const re = new RegExp(`<${tagName}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tagName}>`, 'i');
  const m = xmlFragment.match(re);
  return m ? m[1].trim() : '';
}

function extractAttr(xmlFragment:string, tagName:string, attrName:string):string {
  const re = new RegExp(`<${tagName}[^>]+${attrName}=["']([^"']+)["']`, 'i');
  const m = xmlFragment.match(re);
  return m ? m[1].trim() : '';
}

function parseXmlItems(xml:string):{title:string;link:string;pubDate:string;category:string;description:string}[] {
  const items:{title:string;link:string;pubDate:string;category:string;description:string}[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: extractCdata(block, 'title'),
      link: extractCdata(block, 'link') || extractCdata(block, 'guid'),
      pubDate: extractCdata(block, 'pubDate'),
      category: extractCdata(block, 'category').toLowerCase(),
      description: extractCdata(block, 'description'),
    });
  }
  return items;
}

function parseAtomEntries(xml:string):{title:string;link:string;updated:string;summary:string}[] {
  const entries:{title:string;link:string;updated:string;summary:string}[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    entries.push({
      title: extractCdata(block, 'title'),
      link: extractAttr(block, 'link', 'href'),
      updated: extractCdata(block, 'updated'),
      summary: extractCdata(block, 'summary'),
    });
  }
  return entries;
}

function parseRssDate(text:string):string|null {
  if (!text) return null;
  try {
    const d = new Date(text);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch(_e) { return null; }
}

function scoreSentiment(text:string, title:string='') {
  const combined = (title + ' ' + text).toLowerCase();
  let hawk_pts = 0, dove_pts = 0;
  const reasons:string[] = [];
  for (const w of HAWKISH_DIRECT) { if (combined.includes(w)) { hawk_pts += 1; reasons.push('direct_hawk:' + w); } }
  for (const w of DOVISH_DIRECT) { if (combined.includes(w)) { dove_pts += 1; reasons.push('direct_dove:' + w); } }
  for (const [phrase, mods] of Object.entries(DIRECTIONAL_PHRASES)) {
    let idx = combined.indexOf(phrase);
    while (idx !== -1) {
      const ws = Math.max(0, idx - 150), we = Math.min(combined.length, idx + phrase.length + 150);
      const ctx = combined.slice(ws, we);
      const hasH = mods.hawk.some(h => ctx.includes(h));
      const hasD = mods.dove.some(d => ctx.includes(d));
      if (hasH && !hasD) { hawk_pts += 5; const hit = mods.hawk.find(h => ctx.includes(h))!; reasons.push(`directional_hawk:"${phrase}"+"${hit}"`); }
      else if (hasD && !hasH) { dove_pts += 5; const hit = mods.dove.find(d => ctx.includes(d))!; reasons.push(`directional_dove:"${phrase}"+"${hit}"`); }
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
  const m = tl.match(/(-?\d+\.?\d*)\s*%/);
  if (!m || m.index === undefined) return null;
  let val = parseFloat(m[1]);
  if (isNaN(val)) return null;
  const prefix = tl.slice(Math.max(0, m.index - 40), m.index);
  const levelPhrases = ['down to','fell to','decreased to','declined to','dropped to','up to','rose to','increased to'];
  if (levelPhrases.some(lp => prefix.includes(lp))) return Math.abs(val);
  const neg = ['down by','down ','fell by','fell ','decreased by','decreased ','declined by','declined ','dropped by','dropped ','contraction'];
  const pos = ['up by','up ','grew by','grew ','increased by','increased ','rose by','rose '];
  const hasNeg = neg.some(n => prefix.includes(n));
  const hasPos = pos.some(p => prefix.includes(p));
  if (hasNeg && !hasPos) val = -Math.abs(val);
  else if (hasPos && !hasNeg) val = Math.abs(val);
  return val;
}

function matchRule(title:string, rules:StatRule[]):StatRule|null {
  const tl = title.toLowerCase();
  for (const r of rules) { if (new RegExp(r.pattern, 'i').test(tl)) return r; }
  return null;
}

async function analyzeStatRelease(title:string, url:string, summary:string, rules:StatRule[]) {
  const rule = matchRule(title, rules);
  if (rule && rule.number_regex && rule.direction !== 'text_only') {
    const tv = extractNum(title);
    if (tv !== null) { const r = scoreFromValue(tv, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric); return { ...r, method: 'numeric' }; }
    const combo = title + ' ' + summary;
    const nm = combo.match(new RegExp(rule.number_regex, 'i'));
    if (nm) { const v = parseFloat(nm[1]); if (!isNaN(v)) { const r = scoreFromValue(v, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric); return { ...r, method: 'numeric' }; } }
    if (url) {
      const pt = await fetchPageText(url);
      if (pt) {
        const nm2 = pt.match(new RegExp(rule.number_regex, 'i'));
        if (nm2) { const v = parseFloat(nm2[1]); if (!isNaN(v)) { const r = scoreFromValue(v, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric); return { ...r, method: 'numeric' }; } }
      }
    }
  }
  if (rule && rule.direction === 'text_only' && url) {
    const pt = await fetchPageText(url);
    if (pt) { const s = scoreSentiment(pt, title); return { net_score: Math.round(s.net_score * rule.weight * 1000) / 1000, label: s.label, metric: rule.metric, value_found: null, weight: rule.weight, method: 'text' }; }
  }
  if (url) {
    const pt = await fetchPageText(url);
    if (pt) { const s = scoreSentiment(pt, title); return { net_score: Math.round(s.net_score * 0.5 * 1000) / 1000, label: s.label, metric: 'unclassified', value_found: null, weight: 0.5, method: 'text_fallback' }; }
  }
  return { net_score: 0, label: 'neutral', metric: 'unavailable', value_found: null, weight: 0, method: 'none' };
}

async function fetchFredData(apiKey:string, daysCutoff:number=90):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysCutoff);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const results = await Promise.allSettled(
    FRED_POLICY_SERIES.map(async (spec) => {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${spec.series_id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=15`;
      const resp = await safeFetch(url);
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
      const result = scoreFromValue(val, spec.hawkish_threshold, spec.dovish_threshold, spec.direction, spec.weight, spec.metric);
      return { bank: 'FED', source: 'FRED', item_date: obs[0].date, title: `${spec.metric}: ${val.toFixed(2)} (${spec.series_id})`, url: `https://fred.stlouisfed.org/series/${spec.series_id}`, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: result.net_score, label: result.label, word_count: 0, reasons: ['fred_api'], stat_metric: result.metric, stat_value: result.value_found, stat_weight: result.weight } as SentimentItem;
    })
  );
  for (const r of results) { if (r.status === 'fulfilled' && r.value) items.push(r.value); }
  return items;
}

async function batchFetchTexts(urls:string[], concurrency:number=5):Promise<Map<string,string>> {
  const results = new Map<string,string>();
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        const text = await fetchPageText(url);
        return { url, text };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.set(r.value.url, r.value.text);
    }
  }
  return results;
}

const FOMC_BASE = 'https://www.federalreserve.gov';

async function fetchFomcCalendarHtml():Promise<string> {
  const resp = await safeFetch(FOMC_BASE + '/monetarypolicy/fomccalendars.htm');
  if (!resp || !resp.ok) return '';
  return await resp.text();
}

function parseFomcLinks(html:string, pattern:RegExp):{date:string;url:string}[] {
  const links:{date:string;url:string}[] = [];
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const href = m[1].startsWith('http') ? m[1] : FOMC_BASE + m[1];
    const dm = href.match(/(?:monetary|fomcminutes|fomcpresconf)(\d{8})/);
    if (dm) {
      const d = dm[1];
      links.push({ date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`, url: href });
    }
  }
  links.sort((a, b) => b.date.localeCompare(a.date));
  return links;
}

async function parseBoardRss(feedUrl:string, sourceLabel:string, key:string, cutoffStr:string, limit:number, fetchText:boolean):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  const resp = await safeFetch(feedUrl);
  if (!resp || !resp.ok) return items;
  let xml = await resp.text();
  xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
  const rssItems = parseXmlItems(xml);
  const validItems = rssItems.filter(ri => {
    const pub = parseRssDate(ri.pubDate);
    return pub && pub >= cutoffStr;
  }).slice(0, limit);

  const textUrls:string[] = [];
  const statItems:{ri:typeof rssItems[0];pub:string}[] = [];
  const commItems:{ri:typeof rssItems[0];pub:string}[] = [];

  for (const ri of validItems) {
    const pub = parseRssDate(ri.pubDate)!;
    if (key === 'press') {
      if (FED_SKIP_CATEGORIES.has(ri.category)) continue;
      const tl = ri.title.toLowerCase();
      if (tl.includes('minutes of the federal open market') || tl.includes('fomc minutes') ||
          (tl.includes('discount rate') && tl.includes('minutes'))) {
        statItems.push({ ri, pub });
        continue;
      }
    }
    commItems.push({ ri, pub });
    if (fetchText && ri.link) textUrls.push(ri.link);
  }

  const textMap = fetchText ? await batchFetchTexts(textUrls, 5) : new Map<string,string>();

  for (const { ri, pub } of statItems) {
    const tl = ri.title.toLowerCase();
    if (tl.includes('minutes of the federal open market') || tl.includes('fomc minutes')) {
      const sa = await analyzeStatRelease(ri.title, ri.link, '', FED_STAT_RULES);
      items.push({ bank: 'FED', source: 'FOMC Minutes (press)', item_date: pub, title: ri.title, url: ri.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method], stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight });
    } else {
      const sa = await analyzeStatRelease(ri.title, ri.link, '', FED_STAT_RULES);
      items.push({ bank: 'FED', source: 'Fed Discount Rate Minutes', item_date: pub, title: ri.title, url: ri.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method], stat_metric: 'Discount rate minutes sentiment', stat_value: sa.value_found, stat_weight: 1.5 });
    }
  }

  for (const { ri, pub } of commItems) {
    const text = textMap.get(ri.link) || '';
    const score = scoreSentiment(text, ri.title);
    items.push({ bank: 'FED', source: sourceLabel, item_date: pub, title: ri.title, url: ri.link, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
  }
  return items;
}

const REGIONAL_FED_FEEDS: [string,string][] = [
  ['SF Fed', 'https://www.frbsf.org/feed/'],
];

async function parseRegionalFed(cutoffStr:string, fetchText:boolean):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  for (const [fedName, feedUrl] of REGIONAL_FED_FEEDS) {
    try {
      const resp = await safeFetch(feedUrl, 8000);
      if (!resp || !resp.ok) continue;
      let xml = await resp.text();
      xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
      const rssItems = parseXmlItems(xml).filter(ri => {
        const pub = parseRssDate(ri.pubDate);
        return pub && pub >= cutoffStr;
      }).slice(0, 5);
      const urls = fetchText ? rssItems.map(ri => ri.link).filter(Boolean) : [];
      const textMap = await batchFetchTexts(urls, 3);
      for (const ri of rssItems) {
        const pub = parseRssDate(ri.pubDate)!;
        const text = textMap.get(ri.link) || '';
        const score = scoreSentiment(text, ri.title);
        items.push({ bank: 'FED', source: fedName + ' Speech', item_date: pub, title: `[${fedName}] ${ri.title}`, url: ri.link, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
      }
    } catch(_e) { /* skip */ }
  }
  return items;
}

async function fetchFedData(daysBack:number=60, fetchText:boolean=true):Promise<SentimentItem[]> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const items:SentimentItem[] = [];

  console.log('Fed: fetching FOMC calendar...');
  const calHtml = await fetchFomcCalendarHtml();

  console.log('Fed: fetching RSS feeds in parallel...');
  const [speechesResult, testimonyResult, pressResult, regionalResult] = await Promise.allSettled([
    parseBoardRss('https://www.federalreserve.gov/feeds/speeches.xml', 'Fed Speech', 'speeches', cutoffStr, 20, fetchText),
    parseBoardRss('https://www.federalreserve.gov/feeds/testimony.xml', 'Fed Testimony', 'testimony', cutoffStr, 15, fetchText),
    parseBoardRss('https://www.federalreserve.gov/feeds/press_all.xml', 'Fed Press', 'press', cutoffStr, 20, fetchText),
    parseRegionalFed(cutoffStr, fetchText),
  ]);
  if (speechesResult.status === 'fulfilled') { items.push(...speechesResult.value); console.log(`Fed: ${speechesResult.value.length} speeches`); }
  if (testimonyResult.status === 'fulfilled') { items.push(...testimonyResult.value); console.log(`Fed: ${testimonyResult.value.length} testimony`); }
  if (pressResult.status === 'fulfilled') { items.push(...pressResult.value); console.log(`Fed: ${pressResult.value.length} press`); }
  if (regionalResult.status === 'fulfilled') { items.push(...regionalResult.value); console.log(`Fed: ${regionalResult.value.length} regional`); }

  if (calHtml) {
    const stmtLinks = parseFomcLinks(calHtml, /href="([^"]*newsevents\/pressreleases\/monetary\d{8}[^"]*)"/gi);
    const recentStmts = stmtLinks.filter(l => l.date >= cutoffStr).slice(0, 3);
    if (recentStmts.length > 0) {
      const stmtTexts = await batchFetchTexts(recentStmts.map(s => s.url), 3);
      for (const { date, url } of recentStmts) {
        const text = stmtTexts.get(url) || '';
        const score = scoreSentiment(text, 'FOMC Statement');
        items.push({ bank: 'FED', source: 'FOMC Statement', item_date: date, title: `FOMC Statement - ${date}`, url, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
      }
      console.log(`Fed: ${recentStmts.length} FOMC statements`);
    }

    const minLinks = parseFomcLinks(calHtml, /href="([^"]*fomcminutes\d{8}[^"]*)"/gi);
    const recentMins = minLinks.filter(l => l.date >= cutoffStr).slice(0, 2);
    for (const { date, url } of recentMins) {
      const sa = await analyzeStatRelease(`Minutes of the FOMC meeting ${date}`, url, '', FED_STAT_RULES);
      items.push({ bank: 'FED', source: 'FOMC Minutes', item_date: date, title: `FOMC Minutes - ${date}`, url, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method], stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight });
    }
    console.log(`Fed: ${recentMins.length} FOMC minutes`);

    const pcLinks = parseFomcLinks(calHtml, /href="([^"]*fomcpresconf\d{8}[^"]*)"/gi);
    const recentPc = pcLinks.filter(l => l.date >= cutoffStr).slice(0, 2);
    if (recentPc.length > 0) {
      const pcTexts = await batchFetchTexts(recentPc.map(p => p.url), 2);
      for (const { date, url } of recentPc) {
        const text = pcTexts.get(url) || '';
        if (text.length < 200) continue;
        const score = scoreSentiment(text, `FOMC Press Conference ${date} (Powell)`);
        items.push({ bank: 'FED', source: 'FOMC Press Conference', item_date: date, title: `FOMC Press Conference - ${date} (Powell)`, url, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
      }
      console.log(`Fed: ${recentPc.length} press conferences`);
    }
  }

  return items;
}

async function fetchEcbData(daysBack:number=60, fetchText:boolean=true):Promise<SentimentItem[]> {
  const items:SentimentItem[] = [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const feeds = [
    { url: 'https://www.ecb.europa.eu/rss/press.html', label: 'ECB Press', key: 'press' },
    { url: 'https://www.ecb.europa.eu/rss/blog.html', label: 'ECB Blog', key: 'blog' },
    { url: 'https://www.ecb.europa.eu/rss/statpress.html', label: 'ECB Stats', key: 'stats' },
  ];

  const feedResults = await Promise.allSettled(
    feeds.map(async (feed) => {
      const resp = await safeFetch(feed.url);
      if (!resp || !resp.ok) return { feed, xml: '' };
      return { feed, xml: await resp.text() };
    })
  );

  for (const fr of feedResults) {
    if (fr.status !== 'fulfilled' || !fr.value.xml) continue;
    const { feed, xml } = fr.value;
    const rssItems = parseXmlItems(xml).filter(ri => {
      const pub = parseRssDate(ri.pubDate);
      return pub && pub >= cutoffStr;
    }).slice(0, 20);

    if (feed.key === 'stats') {
      for (const ri of rssItems) {
        const pub = parseRssDate(ri.pubDate)!;
        const sa = await analyzeStatRelease(ri.title, ri.link, '', EUROSTAT_RULES);
        items.push({ bank: 'ECB', source: feed.label, item_date: pub, title: ri.title, url: ri.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method], stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight });
      }
    } else {
      const urls = fetchText ? rssItems.map(ri => ri.link).filter(Boolean) : [];
      const textMap = await batchFetchTexts(urls, 5);
      for (const ri of rssItems) {
        const pub = parseRssDate(ri.pubDate)!;
        const text = textMap.get(ri.link) || '';
        const score = scoreSentiment(text, ri.title);
        items.push({ bank: 'ECB', source: feed.label, item_date: pub, title: ri.title, url: ri.link, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
      }
    }
  }

  try {
    const euroUrl = 'https://ec.europa.eu/eurostat/web/main/news/euro-indicators?p_p_id=estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=atom&p_p_cacheability=cacheLevelPage&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageNumber=1&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageSize=20&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_sort=lastUpdateDate&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_collection=CAT_PREREL';
    const resp = await safeFetch(euroUrl);
    if (resp && resp.ok) {
      const xml = await resp.text();
      const entries = parseAtomEntries(xml);
      for (const entry of entries) {
        const pub = entry.updated ? new Date(entry.updated).toISOString().split('T')[0] : null;
        if (!pub || pub < cutoffStr) continue;
        const sa = await analyzeStatRelease(entry.title, entry.link, entry.summary, EUROSTAT_RULES);
        items.push({ bank: 'ECB', source: 'Eurostat', item_date: pub, title: entry.title, url: entry.link, is_statistical: true, hawk_pts: 0, dove_pts: 0, net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method], stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight });
      }
    }
  } catch(e) { console.error('Eurostat error:', e); }

  try {
    const stmtResp = await safeFetch('https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/html/index.en.html');
    if (stmtResp && stmtResp.ok) {
      const html = await stmtResp.text();
      const linkRe = /href="([^"]*(?:ecb\.is|ecb\.mp)[^"]*\.en\.html)"/gi;
      const stmtLinks:{date:string;url:string;title:string}[] = [];
      let lm;
      while ((lm = linkRe.exec(html)) !== null) {
        const href = lm[1].startsWith('http') ? lm[1] : 'https://www.ecb.europa.eu' + lm[1];
        const dm = href.match(/(?:is|mp)(\d{2})(\d{2})(\d{2})/);
        if (dm) {
          const d = `20${dm[1]}-${dm[2]}-${dm[3]}`;
          stmtLinks.push({ date: d, url: href, title: 'ECB Monetary Policy Statement' });
        }
      }
      stmtLinks.sort((a, b) => b.date.localeCompare(a.date));
      if (stmtLinks.length > 0 && stmtLinks[0].date >= cutoffStr) {
        const { date, url, title } = stmtLinks[0];
        const text = await fetchPageText(url);
        const score = scoreSentiment(text, title);
        items.push({ bank: 'ECB', source: 'ECB Monetary Policy Statement', item_date: date, title, url, is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0 });
      }
    }
  } catch(e) { console.error('ECB statement error:', e); }

  return items;
}

function computeDualScores(items:SentimentItem[]) {
  const comms = items.filter(i => !i.is_statistical);
  function agg(sub:SentimentItem[]) {
    if (!sub.length) return { avg: 0, n: 0, dist: {} as Record<string,number>, sentiment: 'NEUTRAL' };
    const avg = Math.round(sub.reduce((s, i) => s + i.net_score, 0) / sub.length * 1000) / 1000;
    let sentiment:string;
    if (avg <= -0.5) sentiment = 'STRONGLY DOVISH';
    else if (avg < -0.1) sentiment = 'DOVISH';
    else if (avg >= 0.5) sentiment = 'STRONGLY HAWKISH';
    else if (avg > 0.1) sentiment = 'HAWKISH';
    else sentiment = 'NEUTRAL';
    const dist:Record<string,number> = {};
    for (const i of sub) dist[i.label] = (dist[i.label] || 0) + 1;
    return { avg, n: sub.length, dist, sentiment };
  }
  return { score_1: agg(comms), score_2: agg(items) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const bank = url.searchParams.get('bank') || 'both';
    const daysBack = parseInt(url.searchParams.get('days') || '60');
    const fetchText = url.searchParams.get('fetch_text') !== 'false';
    const FRED_KEY = Deno.env.get('FRED_API_KEY') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const result:Record<string,any> = {};

    if (bank === 'both' || bank === 'FED') {
      console.log('=== Fetching Fed data ===');
      const fedItems = await fetchFedData(daysBack, fetchText);
      if (FRED_KEY) {
        console.log('Fetching FRED data...');
        const fredItems = await fetchFredData(FRED_KEY, daysBack + 30);
        fedItems.push(...fredItems);
        console.log(`FRED: ${fredItems.length} series`);
      }
      const seen = new Set<string>();
      const deduped = fedItems.filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true; });
      deduped.sort((a, b) => b.item_date.localeCompare(a.item_date));
      const fedScores = computeDualScores(deduped);
      result.fed = { items: deduped, ...fedScores };
      console.log(`Fed total: ${deduped.length} items, Score1=${fedScores.score_1.avg}, Score2=${fedScores.score_2.avg}`);

      try {
        await supabase.from('sentiment_items').delete().eq('bank', 'FED');
        if (deduped.length > 0) {
          for (let i = 0; i < deduped.length; i += 50) {
            await supabase.from('sentiment_items').insert(
              deduped.slice(i, i + 50).map(item => ({
                bank: item.bank, source: item.source, item_date: item.item_date,
                title: item.title, url: item.url, is_statistical: item.is_statistical,
                hawk_pts: item.hawk_pts, dove_pts: item.dove_pts, net_score: item.net_score,
                label: item.label, word_count: item.word_count, reasons: item.reasons,
                stat_metric: item.stat_metric, stat_value: item.stat_value, stat_weight: item.stat_weight,
              }))
            );
          }
        }
        await supabase.from('sentiment_scores').insert({
          bank: 'FED', score_1_avg: fedScores.score_1.avg, score_1_count: fedScores.score_1.n,
          score_1_label: fedScores.score_1.sentiment, score_1_dist: fedScores.score_1.dist,
          score_2_avg: fedScores.score_2.avg, score_2_count: fedScores.score_2.n,
          score_2_label: fedScores.score_2.sentiment, score_2_dist: fedScores.score_2.dist,
        });
      } catch(e) { console.error('DB store error (FED):', e); }
    }

    if (bank === 'both' || bank === 'ECB') {
      console.log('=== Fetching ECB data ===');
      const ecbItems = await fetchEcbData(daysBack, fetchText);
      const seen = new Set<string>();
      const deduped = ecbItems.filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true; });
      deduped.sort((a, b) => b.item_date.localeCompare(a.item_date));
      const ecbScores = computeDualScores(deduped);
      result.ecb = { items: deduped, ...ecbScores };
      console.log(`ECB total: ${deduped.length} items, Score1=${ecbScores.score_1.avg}, Score2=${ecbScores.score_2.avg}`);

      try {
        await supabase.from('sentiment_items').delete().eq('bank', 'ECB');
        if (deduped.length > 0) {
          for (let i = 0; i < deduped.length; i += 50) {
            await supabase.from('sentiment_items').insert(
              deduped.slice(i, i + 50).map(item => ({
                bank: item.bank, source: item.source, item_date: item.item_date,
                title: item.title, url: item.url, is_statistical: item.is_statistical,
                hawk_pts: item.hawk_pts, dove_pts: item.dove_pts, net_score: item.net_score,
                label: item.label, word_count: item.word_count, reasons: item.reasons,
                stat_metric: item.stat_metric, stat_value: item.stat_value, stat_weight: item.stat_weight,
              }))
            );
          }
        }
        await supabase.from('sentiment_scores').insert({
          bank: 'ECB', score_1_avg: ecbScores.score_1.avg, score_1_count: ecbScores.score_1.n,
          score_1_label: ecbScores.score_1.sentiment, score_1_dist: ecbScores.score_1.dist,
          score_2_avg: ecbScores.score_2.avg, score_2_count: ecbScores.score_2.n,
          score_2_label: ecbScores.score_2.sentiment, score_2_dist: ecbScores.score_2.dist,
        });
      } catch(e) { console.error('DB store error (ECB):', e); }
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch(error) {
    console.error('Sentiment analysis error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
