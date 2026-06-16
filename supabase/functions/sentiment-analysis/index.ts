// ── Sentiment Analysis v4.0 — AI-Powered + Press Conferences + Dedup ──
// Communication items scored by Gemini AI for contextual understanding.
// Statistical items use numeric formula scoring.
// Consumer Expectations Surveys → reclassified as statistical.
// Fed Funds excluded (it's the target variable, not a predictor).
// Duplicate inflation prints within same month → counted once.
// FOMC & ECB press conference transcripts now scraped and analyzed.

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
  u = u.replace(/\/(en|de|fr|es|it|nl|pt)\//g, '/__lang__/');
  u = u.replace(/-\d{5,}$/, '');
  u = u.replace(/\.(en|de|fr|es|it|nl|pt)\.(html?|pdf)$/i, '.$2');
  return u;
}
function normalizedTitle(t: string): string {
  return htmlDecode(t).toLowerCase()
    .replace(/\(with q&a\)/g, '')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupKey(it: { bank: string; source: string; item_date: string; title: string; url: string }): string {
  const urlKey = canonicalUrl(it.url);
  if (urlKey) return `${it.bank}|${it.source}|${it.item_date}|U:${urlKey}`;
  return `${it.bank}|${it.source}|${it.item_date}|T:${normalizedTitle(it.title)}`;
}
function preferItem(a: It, b: It): It {
  const aEn = /\/en\//.test(a.url || '') || /\.en\.(html?|pdf)/i.test(a.url || '');
  const bEn = /\/en\//.test(b.url || '') || /\.en\.(html?|pdf)/i.test(b.url || '');
  if (aEn !== bEn) return aEn ? a : b;
  const aQA = /q&amp;a|q&a|q & a/i.test(a.title);
  const bQA = /q&amp;a|q&a|q & a/i.test(b.title);
  if (aQA !== bQA) return aQA ? a : b;
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
- DOVISH signals (-0.2 to -1.0): rate cuts, easing, weak growth concerns, disinflation, labor softening, dissent favoring cuts, downside risks, weaker activity, falling inflation forecasts
- HAWKISH signals (+0.2 to +1.0): rate hikes, tightening, inflation persistence, strong economy, labor tightness, upside risks to inflation, supply-side threats to price stability
- NEUTRAL (near 0.0): administrative matters, non-monetary topics (digital euro, climate structural reform, banking supervision, counterfeit notes, appointments, green transition without policy implications)
- Government deficit/fiscal policy discussions: score near 0.0 unless they explicitly discuss monetary policy responses
- If the speech is NOT about monetary policy, score 0.0
- Pay attention to DISSENT: if a speaker dissented in favor of cutting, that's very dovish
- Pay attention to NUANCE: "data-dependent" alone is neutral; "data-dependent and we see progress" leans dovish

Respond with ONLY a JSON object (no markdown):
{"score": <number>, "label": "hawkish"|"dovish"|"neutral", "reasoning": "<1 sentence>"}`;
interface AIScore {
  score: number;
  label: string;
  reasoning: string;
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
  let truncated: string;
  if (text.length <= 6000) {
    truncated = text;
  } else {
    // For long documents (press conferences, minutes), sample beginning + middle + end
    // Beginning needs to be large enough to capture rate decisions (typically 1500-2500 chars in)
    const beginLen = isPolicy ? 4000 : 3000;
    const midLen = isPolicy ? 2000 : 1500;
    const endLen = isPolicy ? 2000 : 1500;
    const mid = Math.floor(text.length / 2);
    truncated = text.slice(0, beginLen) +
      '\n...[early section truncated]...\n' +
      text.slice(mid - Math.floor(midLen / 2), mid + Math.floor(midLen / 2)) +
      '\n...[late section truncated]...\n' +
      text.slice(-endLen);
  }

  // Add special instructions for policy documents
  let policyPreamble = '';
  if (isPolicy) {
    policyPreamble = `\n\nIMPORTANT: This is an official central bank policy document. It CANNOT be neutral — it always contains policy signals. Read the full text carefully for:
- Rate decisions (cut/hold/hike)
- Forward guidance language ("appropriate stance", "data-dependent", "further adjustment")
- Risk assessments (upside/downside)
- Dissent or disagreement among members
- Inflation/growth outlook changes
Score this firmly — policy documents should typically score ±0.2 to ±0.8.`;
  }

  const userMsg = `Bank: ${bank}
Title: ${title}${policyPreamble}
Content: ${truncated}`;

  // Use stronger model for policy documents, lighter model for routine items
  const model = isPolicy ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash-lite';

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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
    const policySourceKeywords = ['minutes', 'press conf', 'statement', 'accounts', 'account'];
    return new Set((data || [])
      .filter((d: any) => {
        const src = (d.source || '').toLowerCase();
        // FOMC SEP items are scored by delta, never re-score with generic AI
        if (src.includes('fomc sep')) return true;
        const isPolicyDoc = policySourceKeywords.some(k => src.includes(k));
        // If it's a policy doc with 0 score, don't mark as existing so it gets re-fetched
        if (isPolicyDoc && Math.abs(Number(d.net_score) || 0) < 0.001) return false;
        return true;
      })
      .map((d: any) => `${d.title}|${d.item_date}`));
  } catch { return new Set(); }
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
  { id: 'PAYEMS', met: 'Payrolls MoM', tr: 'd1', ht: 200, dt: 100, dir: 'hh', w: 3 },
  { id: 'UNRATE', met: 'Unemployment', tr: 'lv', ht: 4, dt: 5, dir: 'lh', w: 3 },
  { id: 'PCEPILFE', met: 'Core PCE YoY', tr: 'p12', ht: 2.5, dt: 2, dir: 'hh', w: 3 },
  // FEDFUNDS removed — it's what we're trying to predict, not a leading indicator
  { id: 'RSAFS', met: 'Retail Sales', tr: 'p1', ht: 0.5, dt: -0.2, dir: 'hh', w: 2 },
  { id: 'INDPRO', met: 'Ind Prod', tr: 'p1', ht: 0.3, dt: -0.3, dir: 'hh', w: 2 },
  { id: 'MANEMP', met: 'Mfg Employment Trend', tr: 'p1', ht: 0.3, dt: -0.3, dir: 'hh', w: 2 },
];

async function fetchFred(key: string, days: number): Promise<It[]> {
  const co = new Date(); co.setDate(co.getDate() - days);
  const cs = co.toISOString().split('T')[0];
  // Deduplicate by series ID to avoid fetching same series twice (e.g. CPI YoY + CPI MoM)
  const uniqueSeriesIds = [...new Set(FR.map(s => s.id))];
  const seriesCache: Record<string, any[]> = {};
  
  // Fetch each unique series once
  await Promise.allSettled(uniqueSeriesIds.map(async id => {
    const r = await sf('https://api.stlouisfed.org/fred/series/observations?series_id=' + id + '&api_key=' + key + '&file_type=json&sort_order=desc&limit=15');
    if (!r || !r.ok) return;
    const d = await r.json();
    seriesCache[id] = (d.observations || []).filter((o: any) => o.value !== '.');
  }));
  
  const results: It[] = [];
  for (const s of FR) {
    const obs = seriesCache[s.id];
    if (!obs || !obs.length || obs[0].date < cs) continue;
    const v = obs.map((o: any) => parseFloat(o.value));
    let val: number | null = null;
    if (s.tr === 'lv') val = v[0];
    else if (s.tr === 'd1' && v.length >= 2) val = v[0] - v[1];
    else if (s.tr === 'p1' && v.length >= 2 && v[1] !== 0) val = ((v[0] - v[1]) / Math.abs(v[1])) * 100;
    else if (s.tr === 'p12' && v.length >= 13 && v[12] !== 0) val = ((v[0] - v[12]) / Math.abs(v[12])) * 100;
    if (val === null) continue;
    const r2 = sv(val, s.ht, s.dt, s.dir, s.w, s.met);
    results.push({
      bank: 'FED', source: 'FRED', item_date: obs[0].date,
      title: s.met + ': ' + val.toFixed(2) + ' (' + s.id + ')',
      url: 'https://fred.stlouisfed.org/series/' + s.id,
      is_statistical: true, hawk_pts: 0, dove_pts: 0,
      net_score: r2.net_score, label: r2.label, word_count: 0,
      reasons: ['fred'], stat_metric: r2.metric, stat_value: r2.value, stat_weight: s.w,
    } as It);
  }
  return results;
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

    // 2. Try the press conference transcript PDF
    const pdfUrl = 'https://www.federalreserve.gov/mediacenter/files/FOMCpresconf' + dateStr + '.pdf';
    const pdfResp = await sf(pdfUrl, 15000);
    if (pdfResp && pdfResp.ok) {
      const ct = pdfResp.headers.get('content-type') || '';
      if (ct.includes('pdf')) {
        // Extract text from PDF binary
        const buf = await pdfResp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Simple PDF text extraction: find text between BT/ET operators and parentheses
        let pdfText = '';
        const decoder = new TextDecoder('latin1');
        const raw = decoder.decode(bytes);
        const parenRe = /\(([^)]*)\)/g;
        let pm;
        while ((pm = parenRe.exec(raw)) !== null) {
          const t = pm[1].replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
          if (t.length > 1) pdfText += t + ' ';
        }
        pdfText = pdfText.replace(/\s+/g, ' ').trim();
        if (pdfText.length > 500) {
          console.log('FOMC Press Conf PDF found: ' + dateStr + ' (' + pdfText.length + ' chars)');
          foundItems.push({ title: 'FOMC Press Conference Transcript — ' + m + '/' + day + '/' + y, text: pdfText, date: y + '-' + m + '-' + day, url: pdfUrl });
        } else {
          console.log('FOMC Press Conf PDF too short after extraction: ' + dateStr + ' (' + pdfText.length + ' chars)');
        }
      }
    }

    // 3. Try the press conference HTML page as fallback
    if (foundItems.length < 2) {
      const pcUrl = 'https://www.federalreserve.gov/monetarypolicy/fomcpressconf' + dateStr + '.htm';
      const pcResp = await sf(pcUrl, 12000);
      if (pcResp && pcResp.ok) {
        const pcHtml = await pcResp.text();
        if (!pcHtml.toLowerCase().includes('page not found') && pcHtml.length > 2000) {
          const pcText = extractText(pcHtml);
          if (pcText.length > 1000 && !foundItems.some(f => f.title.includes('Transcript'))) {
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
            const buf = await sepResp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const decoder = new TextDecoder('latin1');
            const raw = decoder.decode(bytes);
            const parenRe2 = /\(([^)]*)\)/g;
            let pm2;
            while ((pm2 = parenRe2.exec(raw)) !== null) {
              const t = pm2[1].replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
              if (t.length > 1) sepText += t + ' ';
            }
            sepText = sepText.replace(/\s+/g, ' ').trim();
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
    console.log('SA v4.0 (AI+PressConf+Dedup): bank=' + bank + ' days=' + days);
    const co = new Date(); co.setDate(co.getDate() - days);
    const cs = co.toISOString().split('T')[0];
    const fk = Deno.env.get('FRED_API_KEY') || '';
    const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const result: Record<string, any> = {};

    const persistHd = { 'Authorization': 'Bearer ' + sbKey, 'apikey': sbKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };

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

      // Score new items with AI
      if (newComms.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          newComms.map(c => ({ title: c.title, text: c.text, bank: c.bank, source: c.source })),
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

      // Persist new items, then aggregate from FULL DB
      const fiDedup = dedupItems(fi);
      if (fiDedup.length < fi.length) console.log('FED: deduped ' + fi.length + ' -> ' + fiDedup.length + ' items');
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
            }))),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => 'no body');
            console.error('FED persist error (batch ' + i + '): ' + resp.status + ' ' + errText);
          }
        }
      }
      const allFedItems = await loadAllItemsForAggregation('FED', sbUrl, sbKey);
      const s1 = ag(allFedItems.filter(i => !i.is_statistical)), s2 = ag(allFedItems);
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

      if (newComms.length > 0 && aiKey) {
        const scores = await scoreBatchWithAI(
          newComms.map(c => ({ title: c.title, text: c.text, bank: c.bank, source: c.source })),
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

      // Persist new items, then aggregate from FULL DB
      // Deduplicate items by (bank, source, title, item_date) before persist
      const dedupKey = (it: It) => `${it.bank}|${it.source}|${it.title}|${it.item_date}`;
      const dedupSet = new Set<string>();
      const dedupEi: It[] = [];
      for (const it of ei) {
        const k = dedupKey(it);
        if (!dedupSet.has(k)) { dedupSet.add(k); dedupEi.push(it); }
      }
      if (dedupEi.length < ei.length) console.log('ECB: deduped ' + ei.length + ' -> ' + dedupEi.length + ' items');
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
      const allEcbItems = await loadAllItemsForAggregation('ECB', sbUrl, sbKey);
      const s1 = ag(allEcbItems.filter(i => !i.is_statistical)), s2 = ag(allEcbItems);
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
