import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================
// SENTIMENT WORDS
// ============================================================
const HAWKISH_DIRECT = new Set([
  'rate hike', 'rate increase', 'tightening', 'hawkish', 'restrictive',
  'above target', 'overheating', 'persistent inflation', 'price pressures',
  'upside risks to inflation', 'insufficiently restrictive', 'further tightening',
  'additional rate increases', 'need to raise', 'strong demand',
]);
const DOVISH_DIRECT = new Set([
  'rate cut', 'rate reduction', 'easing', 'dovish', 'accommodative',
  'below target', 'disinflation', 'slowing', 'weaker growth',
  'downside risks', 'disinflationary', 'progress on inflation',
  'cutting rates', 'lower rates', 'policy pivot',
  'sufficiently restrictive', 'well into restrictive territory',
]);
const DIRECTIONAL_PHRASES: Record<string, { hawk: string[]; dove: string[] }> = {
  'wage growth': {
    hawk: ['accelerat','rising','elevated','strong','above','picking up','remain high','persistently'],
    dove: ['moderat','eased','easing','slowing','soften','deceler','cool','coming down'],
  },
  'inflation': {
    hawk: ['above target','persistently','sticky','broad-based','underlying','accelerat','rebound','uptick'],
    dove: ['falling','declining','easing','retreating','moderat','approach.*target','path to','heading toward','lower','disinflation'],
  },
  'growth': {
    hawk: ['robust','strong','solid','resilient','accelerat','above trend','above potential'],
    dove: ['slowing','contract','recession','weak','stagnant','deteriorat','downturn','falter'],
  },
  'unemployment': {
    hawk: ['historic low','tight','below natural','labour shortage','record low'],
    dove: ['rising','elevated','increasing','higher','deteriorat','job losses'],
  },
  'credit': {
    hawk: ['accelerat','strong','expanding','excessive','overheating'],
    dove: ['tightening','restrictive','slow','contract','weak'],
  },
  'economic activity': {
    hawk: ['expanding','strong','above expect','robust','accelerat'],
    dove: ['contract','weak','below expect','deteriorat','slow'],
  },
};

// ============================================================
// FRED SERIES CONFIG
// ============================================================
interface FredSpec {
  series_id: string;
  metric: string;
  transform: string;
  hawkish_threshold: number;
  dovish_threshold: number;
  direction: string;
  weight: number;
}

const FRED_POLICY_SERIES: FredSpec[] = [
  { series_id: 'CPIAUCSL', metric: 'CPI Inflation (YoY)', transform: 'pct_change_12', hawkish_threshold: 3.0, dovish_threshold: 2.0, direction: 'high_hawk', weight: 3.0 },
  { series_id: 'PAYEMS', metric: 'Nonfarm Payrolls (MoM Δk)', transform: 'diff_1', hawkish_threshold: 200, dovish_threshold: 100, direction: 'high_hawk', weight: 3.0 },
  { series_id: 'UNRATE', metric: 'Unemployment Rate', transform: 'level', hawkish_threshold: 4.0, dovish_threshold: 5.0, direction: 'low_hawk', weight: 3.0 },
  { series_id: 'GDP', metric: 'Real GDP Growth (QoQ ann.)', transform: 'pct_change_1_ann', hawkish_threshold: 2.5, dovish_threshold: 1.0, direction: 'high_hawk', weight: 3.0 },
  { series_id: 'PCEPILFE', metric: 'Core PCE Inflation (YoY)', transform: 'pct_change_12', hawkish_threshold: 2.5, dovish_threshold: 2.0, direction: 'high_hawk', weight: 3.0 },
  { series_id: 'FEDFUNDS', metric: 'Fed Funds Rate', transform: 'level', hawkish_threshold: 5.0, dovish_threshold: 3.0, direction: 'high_hawk', weight: 1.0 },
  { series_id: 'RSAFS', metric: 'Retail Sales (MoM %)', transform: 'pct_change_1', hawkish_threshold: 0.5, dovish_threshold: -0.2, direction: 'high_hawk', weight: 2.0 },
  { series_id: 'INDPRO', metric: 'Industrial Production (MoM %)', transform: 'pct_change_1', hawkish_threshold: 0.3, dovish_threshold: -0.3, direction: 'high_hawk', weight: 2.0 },
];

// ============================================================
// STAT RELEASE RULES
// ============================================================
interface StatRule {
  pattern: string;
  metric: string;
  number_regex: string | null;
  hawkish_threshold: number | null;
  dovish_threshold: number | null;
  direction: string;
  weight: number;
}

const EUROSTAT_RULES: StatRule[] = [
  { pattern: 'inflation', metric: 'HICP inflation', number_regex: '(\\d+\\.?\\d*)\\s*%', hawkish_threshold: 2.5, dovish_threshold: 1.8, direction: 'high_hawk', weight: 3 },
  { pattern: 'gdp', metric: 'GDP growth', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.4, dovish_threshold: 0.1, direction: 'high_hawk', weight: 3 },
  { pattern: 'unemployment', metric: 'Unemployment rate', number_regex: '(\\d+\\.?\\d*)\\s*%', hawkish_threshold: 6.0, dovish_threshold: 7.5, direction: 'low_hawk', weight: 3 },
  { pattern: 'employment\\s+(?:up|down|grew|increased|decreased)', metric: 'Employment growth', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.3, dovish_threshold: 0.0, direction: 'high_hawk', weight: 3.0 },
  { pattern: 'industrial production', metric: 'Industrial production', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.5, dovish_threshold: -0.5, direction: 'high_hawk', weight: 2.0 },
  { pattern: 'retail trade', metric: 'Retail trade volume', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.5, dovish_threshold: -0.5, direction: 'high_hawk', weight: 2.0 },
  { pattern: 'services production', metric: 'Services production', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.5, dovish_threshold: -0.5, direction: 'high_hawk', weight: 2.0 },
  { pattern: 'producer prices', metric: 'PPI / Producer prices', number_regex: '(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 0.5, dovish_threshold: -0.3, direction: 'high_hawk', weight: 2.0 },
  { pattern: 'monetary developments', metric: 'M3 money supply growth', number_regex: 'M3.*?(\\-?\\d+\\.?\\d*)\\s*%', hawkish_threshold: 5.0, dovish_threshold: 2.0, direction: 'high_hawk', weight: 1.0 },
  { pattern: 'bank interest rate statistics', metric: 'Bank lending rates', number_regex: '(\\d+\\.?\\d*)\\s*%', hawkish_threshold: 4.0, dovish_threshold: 2.0, direction: 'high_hawk', weight: 1.0 },
  { pattern: 'trade in goods', metric: 'Trade balance', number_regex: '(\\-?\\d+\\.?\\d*)\\s*(?:bn|billion)', hawkish_threshold: 20.0, dovish_threshold: -5.0, direction: 'high_hawk', weight: 0.3 },
  { pattern: 'meeting of|minutes', metric: 'Meeting minutes sentiment', number_regex: null, hawkish_threshold: null, dovish_threshold: null, direction: 'text_only', weight: 2.0 },
];

const FED_STAT_RULES: StatRule[] = [
  { pattern: 'discount rate', metric: 'Discount rate minutes sentiment', number_regex: null, hawkish_threshold: null, dovish_threshold: null, direction: 'text_only', weight: 1.5 },
  { pattern: 'minutes.*(?:fomc|federal open market|meeting)|fomc\\s+minutes', metric: 'FOMC Minutes sentiment', number_regex: null, hawkish_threshold: null, dovish_threshold: null, direction: 'text_only', weight: 3.0 },
  { pattern: 'beige book|summary of commentary', metric: 'Beige Book sentiment', number_regex: null, hawkish_threshold: null, dovish_threshold: null, direction: 'text_only', weight: 2.5 },
];

const FED_SKIP_CATEGORIES = new Set([
  'enforcement actions', 'orders on banking applications',
  'other announcements', 'banking and consumer regulatory policy',
  'community development',
]);

const MIN_BOUNDARY_SCORE = 0.15;

// ============================================================
// SENTIMENT SCORER
// ============================================================
function scoreSentiment(text: string, title: string = ''): {
  hawk_pts: number; dove_pts: number; net_score: number; label: string; word_count: number; reasons: string[];
} {
  const combined = (title + ' ' + text).toLowerCase();
  let hawk_pts = 0, dove_pts = 0;
  const reasons: string[] = [];

  for (const w of HAWKISH_DIRECT) {
    if (combined.includes(w)) { hawk_pts += 1; reasons.push(`direct_hawk:${w}`); }
  }
  for (const w of DOVISH_DIRECT) {
    if (combined.includes(w)) { dove_pts += 1; reasons.push(`direct_dove:${w}`); }
  }

  for (const [phrase, mods] of Object.entries(DIRECTIONAL_PHRASES)) {
    let idx = combined.indexOf(phrase);
    while (idx !== -1) {
      const ws = Math.max(0, idx - 150);
      const we = Math.min(combined.length, idx + phrase.length + 150);
      const ctx = combined.slice(ws, we);
      const hasHawk = mods.hawk.some(h => ctx.includes(h));
      const hasDove = mods.dove.some(d => ctx.includes(d));
      if (hasHawk && !hasDove) {
        hawk_pts += 5;
        const hit = mods.hawk.find(h => ctx.includes(h))!;
        reasons.push(`directional_hawk:"${phrase}"+"${hit}"`);
      } else if (hasDove && !hasHawk) {
        dove_pts += 5;
        const hit = mods.dove.find(d => ctx.includes(d))!;
        reasons.push(`directional_dove:"${phrase}"+"${hit}"`);
      }
      idx = combined.indexOf(phrase, idx + 1);
    }
  }

  const wc = Math.max(combined.split(/\s+/).length, 1);
  const net = ((hawk_pts - dove_pts) / wc) * 100;
  const label = net > 0.05 ? 'hawkish' : (net < -0.05 ? 'dovish' : 'neutral');
  return { hawk_pts, dove_pts, net_score: Math.round(net * 1000) / 1000, label, word_count: wc, reasons };
}

// ============================================================
// SCORE FROM VALUE (shared by FRED and Stat Release)
// ============================================================
function scoreFromValue(val: number, ht: number, dt: number, direction: string, weight: number, metric: string) {
  let raw: number;
  let label: string;

  if (direction === 'low_hawk') {
    if (val <= ht) {
      raw = Math.max(Math.min((ht - val) / Math.max(Math.abs(ht), 1) * 2, 2.0), MIN_BOUNDARY_SCORE);
      label = 'hawkish';
    } else if (val >= dt) {
      raw = -Math.max(Math.min((val - dt) / Math.max(Math.abs(dt), 1) * 2, 2.0), MIN_BOUNDARY_SCORE);
      label = 'dovish';
    } else {
      raw = -(val - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1);
      label = raw > 0.05 ? 'hawkish' : (raw < -0.05 ? 'dovish' : 'neutral');
    }
  } else {
    if (val >= ht) {
      raw = Math.max(Math.min((val - ht) / Math.max(Math.abs(ht), 1) * 2, 2.0), MIN_BOUNDARY_SCORE);
      label = 'hawkish';
    } else if (val <= dt) {
      raw = -Math.max(Math.min(Math.abs(dt - val) / Math.max(Math.abs(dt), 1) * 2, 2.0), MIN_BOUNDARY_SCORE);
      label = 'dovish';
    } else {
      raw = (val - (ht + dt) / 2) / Math.max(Math.abs(ht - dt), 1);
      label = raw > 0.05 ? 'hawkish' : (raw < -0.05 ? 'dovish' : 'neutral');
    }
  }

  return {
    net_score: Math.round(raw * weight * 1000) / 1000,
    label,
    metric,
    value_found: Math.round(val * 100) / 100,
    weight,
  };
}

// ============================================================
// FRED DATA RETRIEVER
// ============================================================
async function fetchFredData(apiKey: string, daysCutoff: number = 90): Promise<SentimentItem[]> {
  const items: SentimentItem[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysCutoff);

  for (const spec of FRED_POLICY_SERIES) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${spec.series_id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=15`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      const obs = (data.observations || []).filter((o: any) => o.value !== '.');
      if (!obs.length) continue;

      const latestDate = new Date(obs[0].date);
      if (latestDate < cutoff) continue;

      const vals = obs.map((o: any) => parseFloat(o.value));
      let val: number | null = null;

      if (spec.transform === 'level') val = vals[0];
      else if (spec.transform === 'diff_1' && vals.length >= 2) val = vals[0] - vals[1];
      else if (spec.transform === 'pct_change_1' && vals.length >= 2 && vals[1] !== 0) val = ((vals[0] - vals[1]) / Math.abs(vals[1])) * 100;
      else if (spec.transform === 'pct_change_1_ann' && vals.length >= 2 && vals[1] !== 0) {
        const qoq = (vals[0] - vals[1]) / Math.abs(vals[1]);
        val = (Math.pow(1 + qoq, 4) - 1) * 100;
      }
      else if (spec.transform === 'pct_change_12' && vals.length >= 13 && vals[12] !== 0) val = ((vals[0] - vals[12]) / Math.abs(vals[12])) * 100;

      if (val === null) continue;

      const result = scoreFromValue(val, spec.hawkish_threshold, spec.dovish_threshold, spec.direction, spec.weight, spec.metric);
      items.push({
        bank: 'FED',
        source: 'FRED',
        item_date: obs[0].date,
        title: `${spec.metric}: ${val.toFixed(2)} (${spec.series_id})`,
        url: `https://fred.stlouisfed.org/series/${spec.series_id}`,
        is_statistical: true,
        hawk_pts: 0,
        dove_pts: 0,
        net_score: result.net_score,
        label: result.label,
        word_count: 0,
        reasons: ['fred_api'],
        stat_metric: result.metric,
        stat_value: result.value_found,
        stat_weight: result.weight,
      });
    } catch (e) {
      console.error(`FRED error [${spec.series_id}]:`, e);
    }
  }
  return items;
}

// ============================================================
// RSS PARSER (simple XML parsing for Deno)
// ============================================================
function parseXmlItems(xml: string): Array<{ title: string; link: string; pubDate: string; category: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; category: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s) || [])[1]?.trim() || '';
    const link = (block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/s) || [])[1]?.trim() || '';
    const category = (block.match(/<category>(.*?)<\/category>/s) || [])[1]?.trim().toLowerCase() || '';
    items.push({ title, link, pubDate, category });
  }
  return items;
}

function parseAtomEntries(xml: string): Array<{ title: string; link: string; updated: string; summary: string }> {
  const entries: Array<{ title: string; link: string; updated: string; summary: string }> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>(.*?)<\/title>/s) || [])[1]?.trim() || '';
    const linkMatch = block.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : '';
    const updated = (block.match(/<updated>(.*?)<\/updated>/s) || [])[1]?.trim() || '';
    const summary = (block.match(/<summary[^>]*>(.*?)<\/summary>/s) || [])[1]?.trim() || '';
    entries.push({ title, link, updated, summary });
  }
  return entries;
}

function parseRssDate(text: string): string | null {
  try {
    const d = new Date(text);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch { return null; }
}

// ============================================================
// HTML TEXT EXTRACTION (basic)
// ============================================================
function extractTextFromHtml(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 60000);
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CentralBankSentiment/2.2)' },
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return extractTextFromHtml(html);
  } catch { return ''; }
}

// ============================================================
// STAT RELEASE ANALYSIS
// ============================================================
function matchRule(title: string, rules: StatRule[]): StatRule | null {
  const tl = title.toLowerCase();
  for (const rule of rules) {
    if (new RegExp(rule.pattern, 'i').test(tl)) return rule;
  }
  return null;
}

function extractNumberFromTitle(title: string): number | null {
  const tl = title.toLowerCase();
  const m = tl.match(/(\-?\d+\.?\d*)\s*%/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (isNaN(val)) return null;

  const prefix = tl.slice(Math.max(0, m.index! - 40), m.index!);
  const levelPhrases = ['down to', 'fell to', 'decreased to', 'declined to', 'dropped to', 'up to', 'rose to', 'increased to'];
  if (levelPhrases.some(lp => prefix.includes(lp))) return Math.abs(val);

  const negChange = ['down by', 'down ', 'fell by', 'fell ', 'decreased by', 'decreased ', 'declined by', 'declined ', 'dropped by', 'dropped ', 'contraction'];
  const posChange = ['up by', 'up ', 'grew by', 'grew ', 'increased by', 'increased ', 'rose by', 'rose '];
  const hasNeg = negChange.some(nc => prefix.includes(nc));
  const hasPos = posChange.some(pc => prefix.includes(pc));
  if (hasNeg && !hasPos) val = -Math.abs(val);
  else if (hasPos && !hasNeg) val = Math.abs(val);
  return val;
}

async function analyzeStatRelease(title: string, url: string, summary: string, rules: StatRule[]): Promise<{
  net_score: number; label: string; metric: string; value_found: number | null; weight: number; method: string;
}> {
  const rule = matchRule(title, rules);

  // Step 1: extract from title
  if (rule && rule.number_regex && rule.direction !== 'text_only') {
    const titleVal = extractNumberFromTitle(title);
    if (titleVal !== null) {
      const r = scoreFromValue(titleVal, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric);
      return { ...r, method: 'numeric' };
    }
  }

  // Step 2: extract from summary/title combined
  if (rule && rule.number_regex && rule.direction !== 'text_only') {
    const combined = title + ' ' + summary;
    const numMatch = combined.match(new RegExp(rule.number_regex, 'i'));
    if (numMatch) {
      const val = parseFloat(numMatch[1]);
      if (!isNaN(val)) {
        const r = scoreFromValue(val, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric);
        return { ...r, method: 'numeric' };
      }
    }
  }

  // Step 3: fetch page for numbers
  if (rule && rule.number_regex && rule.direction !== 'text_only' && url) {
    const pageText = await fetchPageText(url);
    if (pageText) {
      const numMatch = pageText.match(new RegExp(rule.number_regex, 'i'));
      if (numMatch) {
        const val = parseFloat(numMatch[1]);
        if (!isNaN(val)) {
          const r = scoreFromValue(val, rule.hawkish_threshold!, rule.dovish_threshold!, rule.direction, rule.weight, rule.metric);
          return { ...r, method: 'numeric' };
        }
      }
    }
  }

  // Step 4: text-only (minutes, beige book)
  if (rule && rule.direction === 'text_only' && url) {
    const pageText = await fetchPageText(url);
    if (pageText) {
      const s = scoreSentiment(pageText, title);
      return {
        net_score: Math.round(s.net_score * rule.weight * 1000) / 1000,
        label: s.label, metric: rule.metric, value_found: null, weight: rule.weight, method: 'text',
      };
    }
  }

  // Step 5: fallback
  if (url) {
    const pageText = await fetchPageText(url);
    if (pageText) {
      const s = scoreSentiment(pageText, title);
      return {
        net_score: Math.round(s.net_score * 0.5 * 1000) / 1000,
        label: s.label, metric: 'unclassified', value_found: null, weight: 0.5, method: 'text_fallback',
      };
    }
  }

  return { net_score: 0, label: 'neutral', metric: 'unavailable', value_found: null, weight: 0, method: 'none' };
}

// ============================================================
// ITEM TYPE
// ============================================================
interface SentimentItem {
  bank: string;
  source: string;
  item_date: string;
  title: string;
  url: string;
  is_statistical: boolean;
  hawk_pts: number;
  dove_pts: number;
  net_score: number;
  label: string;
  word_count: number;
  reasons: string[];
  stat_metric: string | null;
  stat_value: number | null;
  stat_weight: number;
}

// ============================================================
// ECB RETRIEVER
// ============================================================
async function fetchEcbData(daysBack: number = 60, fetchText: boolean = true): Promise<SentimentItem[]> {
  const items: SentimentItem[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // ECB RSS feeds
  const feeds: Array<{ url: string; label: string; key: string }> = [
    { url: 'https://www.ecb.europa.eu/rss/press.html', label: 'ECB Press', key: 'press' },
    { url: 'https://www.ecb.europa.eu/rss/blog.html', label: 'ECB Blog', key: 'blog' },
    { url: 'https://www.ecb.europa.eu/rss/statpress.html', label: 'ECB Stats', key: 'stats' },
  ];

  for (const feed of feeds) {
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CentralBankSentiment/2.2)' },
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const rssItems = parseXmlItems(xml);

      for (const ri of rssItems.slice(0, 20)) {
        const pub = parseRssDate(ri.pubDate);
        if (!pub || pub < cutoffStr) continue;

        if (feed.key === 'stats') {
          const sa = await analyzeStatRelease(ri.title, ri.link, '', EUROSTAT_RULES);
          items.push({
            bank: 'ECB', source: feed.label, item_date: pub, title: ri.title, url: ri.link,
            is_statistical: true, hawk_pts: 0, dove_pts: 0,
            net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method],
            stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight,
          });
        } else {
          let text = '';
          if (fetchText && ri.link) text = await fetchPageText(ri.link);
          const score = scoreSentiment(text, ri.title);
          items.push({
            bank: 'ECB', source: feed.label, item_date: pub, title: ri.title, url: ri.link,
            is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0,
          });
        }
      }
    } catch (e) {
      console.error(`ECB feed error [${feed.label}]:`, e);
    }
  }

  // Eurostat Atom feed
  try {
    const eurostatUrl = 'https://ec.europa.eu/eurostat/web/main/news/euro-indicators?p_p_id=estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=atom&p_p_cacheability=cacheLevelPage&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageNumber=1&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_pageSize=20&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_sort=lastUpdateDate&_estatsearchportlet_WAR_estatsearchportlet_INSTANCE_OaTpFrwlabNK_collection=CAT_PREREL';
    const resp = await fetch(eurostatUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CentralBankSentiment/2.2)' },
    });
    if (resp.ok) {
      const xml = await resp.text();
      const entries = parseAtomEntries(xml);
      for (const entry of entries) {
        const pub = entry.updated ? new Date(entry.updated).toISOString().split('T')[0] : null;
        if (!pub || pub < cutoffStr) continue;
        const sa = await analyzeStatRelease(entry.title, entry.link, entry.summary, EUROSTAT_RULES);
        items.push({
          bank: 'ECB', source: 'Eurostat', item_date: pub, title: entry.title, url: entry.link,
          is_statistical: true, hawk_pts: 0, dove_pts: 0,
          net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method],
          stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight,
        });
      }
    }
  } catch (e) {
    console.error('Eurostat error:', e);
  }

  return items;
}

// ============================================================
// FED RETRIEVER
// ============================================================
async function fetchFedData(daysBack: number = 60, fetchText: boolean = true): Promise<SentimentItem[]> {
  const items: SentimentItem[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Fed RSS feeds
  const feeds: Array<{ url: string; label: string; key: string }> = [
    { url: 'https://www.federalreserve.gov/feeds/speeches.xml', label: 'Fed Speech', key: 'speeches' },
    { url: 'https://www.federalreserve.gov/feeds/press_all.xml', label: 'Fed Press', key: 'press' },
  ];

  for (const feed of feeds) {
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CentralBankSentiment/2.2)' },
      });
      if (!resp.ok) continue;
      let xml = await resp.text();
      // Fix invalid XML
      xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
      const rssItems = parseXmlItems(xml);

      for (const ri of rssItems.slice(0, 20)) {
        const pub = parseRssDate(ri.pubDate);
        if (!pub || pub < cutoffStr) continue;

        if (feed.key === 'press') {
          if (FED_SKIP_CATEGORIES.has(ri.category)) continue;

          const tl = ri.title.toLowerCase();
          if (tl.includes('minutes of the federal open market') || tl.includes('fomc minutes')) {
            const sa = await analyzeStatRelease(ri.title, ri.link, '', FED_STAT_RULES);
            items.push({
              bank: 'FED', source: 'FOMC Minutes (press)', item_date: pub, title: ri.title, url: ri.link,
              is_statistical: true, hawk_pts: 0, dove_pts: 0,
              net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method],
              stat_metric: sa.metric, stat_value: sa.value_found, stat_weight: sa.weight,
            });
            continue;
          }
          if (tl.includes('discount rate') && tl.includes('minutes')) {
            const sa = await analyzeStatRelease(ri.title, ri.link, '', FED_STAT_RULES);
            items.push({
              bank: 'FED', source: 'Fed Discount Rate Minutes', item_date: pub, title: ri.title, url: ri.link,
              is_statistical: true, hawk_pts: 0, dove_pts: 0,
              net_score: sa.net_score, label: sa.label, word_count: 0, reasons: [sa.method],
              stat_metric: 'Discount rate minutes sentiment', stat_value: sa.value_found, stat_weight: 1.5,
            });
            continue;
          }
        }

        let text = '';
        if (fetchText && ri.link) text = await fetchPageText(ri.link);
        const score = scoreSentiment(text, ri.title);
        items.push({
          bank: 'FED', source: feed.label, item_date: pub, title: ri.title, url: ri.link,
          is_statistical: false, ...score, stat_metric: null, stat_value: null, stat_weight: 0,
        });
      }
    } catch (e) {
      console.error(`Fed feed error [${feed.label}]:`, e);
    }
  }

  return items;
}

// ============================================================
// DUAL SCORE AGGREGATION
// ============================================================
function computeDualScores(items: SentimentItem[]) {
  const comms = items.filter(i => !i.is_statistical);
  const full = items;

  function agg(sub: SentimentItem[]) {
    if (!sub.length) return { avg: 0, n: 0, dist: {} as Record<string, number>, sentiment: '⚖️ NEUTRAL' };
    const avg = Math.round(sub.reduce((s, i) => s + i.net_score, 0) / sub.length * 1000) / 1000;
    let sentiment: string;
    if (avg <= -0.5) sentiment = '🕊️🕊️ STRONGLY DOVISH';
    else if (avg < -0.1) sentiment = '🕊️ DOVISH';
    else if (avg >= 0.5) sentiment = '🦅🦅 STRONGLY HAWKISH';
    else if (avg > 0.1) sentiment = '🦅 HAWKISH';
    else sentiment = '⚖️ NEUTRAL';

    const dist: Record<string, number> = {};
    for (const i of sub) {
      dist[i.label] = (dist[i.label] || 0) + 1;
    }
    return { avg, n: sub.length, dist, sentiment };
  }

  return { score_1: agg(comms), score_2: agg(full) };
}

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const bank = url.searchParams.get('bank') || 'both';
    const daysBack = parseInt(url.searchParams.get('days') || '60');
    const fetchText = url.searchParams.get('fetch_text') !== 'false';

    const FRED_KEY = Deno.env.get('FRED_API_KEY') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const result: Record<string, any> = {};

    if (bank === 'both' || bank === 'FED') {
      console.log('Fetching Fed data...');
      const fedItems = await fetchFedData(daysBack, fetchText);
      // Add FRED data
      if (FRED_KEY) {
        const fredItems = await fetchFredData(FRED_KEY, daysBack + 30);
        fedItems.push(...fredItems);
      }
      // Deduplicate by title
      const seen = new Set<string>();
      const dedupedFed = fedItems.filter(i => {
        if (seen.has(i.title)) return false;
        seen.add(i.title);
        return true;
      });
      dedupedFed.sort((a, b) => b.item_date.localeCompare(a.item_date));
      const fedScores = computeDualScores(dedupedFed);
      result.fed = { items: dedupedFed, ...fedScores };

      // Store in DB
      try {
        await supabase.from('sentiment_items').delete().eq('bank', 'FED');
        if (dedupedFed.length > 0) {
          await supabase.from('sentiment_items').insert(dedupedFed.map(i => ({
            bank: i.bank, source: i.source, item_date: i.item_date, title: i.title,
            url: i.url, is_statistical: i.is_statistical, hawk_pts: i.hawk_pts, dove_pts: i.dove_pts,
            net_score: i.net_score, label: i.label, word_count: i.word_count, reasons: i.reasons,
            stat_metric: i.stat_metric, stat_value: i.stat_value, stat_weight: i.stat_weight,
          })));
        }
        await supabase.from('sentiment_scores').insert({
          bank: 'FED',
          score_1_avg: fedScores.score_1.avg, score_1_count: fedScores.score_1.n,
          score_1_label: fedScores.score_1.sentiment, score_1_dist: fedScores.score_1.dist,
          score_2_avg: fedScores.score_2.avg, score_2_count: fedScores.score_2.n,
          score_2_label: fedScores.score_2.sentiment, score_2_dist: fedScores.score_2.dist,
        });
      } catch (e) { console.error('DB store error (FED):', e); }
    }

    if (bank === 'both' || bank === 'ECB') {
      console.log('Fetching ECB data...');
      const ecbItems = await fetchEcbData(daysBack, fetchText);
      const seen = new Set<string>();
      const dedupedEcb = ecbItems.filter(i => {
        if (seen.has(i.title)) return false;
        seen.add(i.title);
        return true;
      });
      dedupedEcb.sort((a, b) => b.item_date.localeCompare(a.item_date));
      const ecbScores = computeDualScores(dedupedEcb);
      result.ecb = { items: dedupedEcb, ...ecbScores };

      // Store in DB
      try {
        await supabase.from('sentiment_items').delete().eq('bank', 'ECB');
        if (dedupedEcb.length > 0) {
          await supabase.from('sentiment_items').insert(dedupedEcb.map(i => ({
            bank: i.bank, source: i.source, item_date: i.item_date, title: i.title,
            url: i.url, is_statistical: i.is_statistical, hawk_pts: i.hawk_pts, dove_pts: i.dove_pts,
            net_score: i.net_score, label: i.label, word_count: i.word_count, reasons: i.reasons,
            stat_metric: i.stat_metric, stat_value: i.stat_value, stat_weight: i.stat_weight,
          })));
        }
        await supabase.from('sentiment_scores').insert({
          bank: 'ECB',
          score_1_avg: ecbScores.score_1.avg, score_1_count: ecbScores.score_1.n,
          score_1_label: ecbScores.score_1.sentiment, score_1_dist: ecbScores.score_1.dist,
          score_2_avg: ecbScores.score_2.avg, score_2_count: ecbScores.score_2.n,
          score_2_label: ecbScores.score_2.sentiment, score_2_dist: ecbScores.score_2.dist,
        });
      } catch (e) { console.error('DB store error (ECB):', e); }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
