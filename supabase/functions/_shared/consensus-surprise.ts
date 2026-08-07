// ─────────────────────────────────────────────────────────────────────────────
// Statistical Data Surprise Index
// A macro print only moves policy expectations to the extent it deviates from
// what was already expected. We therefore re-score statistical items as a
// standardized surprise: z = (actual - consensus) / sigma, signed by whether a
// higher reading is hawkish or dovish for that metric.
// Consensus figures are reported by the AI model (Bloomberg/Reuters style
// survey medians), anchored to the actual print we scraped.
// ─────────────────────────────────────────────────────────────────────────────

export interface SurprisableItem {
  bank: string;
  item_date: string;
  title: string;
  is_statistical: boolean;
  net_score: number;
  label: string;
  reasons: string[];
  stat_metric: string | null;
  stat_value: number | null;
  stat_weight: number;
}

// Direction of the policy reaction: 'hh' = higher reading is hawkish,
// 'lh' = lower reading is hawkish (slack metrics).
const METRIC_DIRECTION: Record<string, 'hh' | 'lh'> = {
  CPI: 'hh', 'Core CPI': 'hh', HICP: 'hh', 'Core HICP': 'hh', PCE: 'hh', 'Core PCE': 'hh',
  PPI: 'hh', Wages: 'hh', 'Wage Growth': 'hh', 'Negotiated Wages': 'hh',
  GDP: 'hh', Retail: 'hh', PMI: 'hh', 'Industrial Production': 'hh', Payrolls: 'hh',
  Unemployment: 'lh', 'Jobless Claims': 'lh', Claims: 'lh', 'Credit Spread': 'lh',
};

function directionFor(metric: string): 'hh' | 'lh' {
  if (METRIC_DIRECTION[metric]) return METRIC_DIRECTION[metric];
  const m = metric.toLowerCase();
  if (/unemploy|claims|slack|spread|vacan/.test(m)) return 'lh';
  return 'hh';
}

interface ConsensusRow { i: number; consensus: number | null; sigma: number | null }

async function fetchConsensus(
  rows: { i: number; metric: string; value: number; date: string; title: string }[],
  apiKey: string,
): Promise<Map<number, { consensus: number; sigma: number }>> {
  const out = new Map<number, { consensus: number; sigma: number }>();
  if (!rows.length || !apiKey) return out;

  const listed = rows
    .map(r => `${r.i}: metric=${r.metric} | release_date=${r.date} | actual=${r.value} | headline="${r.title}"`)
    .join('\n');

  const prompt = `You are a macro data desk. For each economic release below, report the market CONSENSUS (survey median expectation, Bloomberg/Reuters style) that was published BEFORE the release, and SIGMA: the typical absolute surprise (standard deviation of actual-minus-consensus) for that indicator in the same units.

Rules:
- Use the same units as the "actual" value shown (e.g. percent for inflation, index points for PMI).
- If you do not know the consensus for a release, return null for it. Never guess wildly.
- Typical sigma reference: headline CPI/HICP y/y ~0.15, core inflation ~0.12, unemployment rate ~0.1, PMI ~1.2, GDP q/q ~0.15, retail sales m/m ~0.5, wage growth ~0.3.

Releases:
${listed}

Reply ONLY with a JSON array: [{"i":0,"consensus":2.1,"sigma":0.15}, ...]`;

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3.6-flash',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) {
      console.error('consensus fetch failed:', resp.status, await resp.text().catch(() => ''));
      return out;
    }
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return out;
    const parsed: ConsensusRow[] = JSON.parse(match[0]);
    for (const p of parsed) {
      if (typeof p?.i !== 'number') continue;
      if (p.consensus === null || p.consensus === undefined || !Number.isFinite(Number(p.consensus))) continue;
      const sigma = Number(p.sigma);
      out.set(p.i, {
        consensus: Number(p.consensus),
        sigma: Number.isFinite(sigma) && sigma > 0 ? sigma : 0.2,
      });
    }
  } catch (e) {
    console.error('consensus parse error:', e instanceof Error ? e.message : e);
  }
  return out;
}

/**
 * Re-scores statistical items as standardized surprises where a consensus is
 * available. The final score blends the level signal (already computed by the
 * metric bands) with the surprise signal, which dominates:
 *   score = 0.35 * level + 0.65 * surprise
 * Items without a usable consensus keep their level score untouched.
 */
export async function applyConsensusSurprise<T extends SurprisableItem>(
  items: T[],
  apiKey: string,
): Promise<T[]> {
  const candidates: { i: number; metric: string; value: number; date: string; title: string }[] = [];
  items.forEach((it, i) => {
    if (!it.is_statistical) return;
    if (!it.stat_metric || it.stat_metric === 'Survey') return;
    if (it.stat_value === null || !Number.isFinite(it.stat_value)) return;
    if ((it.reasons || []).some(r => r.startsWith('duplicate:'))) return;
    candidates.push({ i, metric: it.stat_metric, value: it.stat_value as number, date: it.item_date, title: it.title });
  });
  if (!candidates.length) return items;

  const consensus = new Map<number, { consensus: number; sigma: number }>();
  for (let c = 0; c < candidates.length; c += 25) {
    const chunk = candidates.slice(c, c + 25);
    const res = await fetchConsensus(chunk, apiKey);
    for (const [k, v] of res) consensus.set(k, v);
  }
  if (!consensus.size) {
    console.log('surprise index: no consensus figures returned, keeping level scores');
    return items;
  }

  let applied = 0;
  for (const [i, c] of consensus) {
    const it = items[i];
    if (!it) continue;
    const actual = it.stat_value as number;
    const dir = directionFor(it.stat_metric || '');
    const rawDelta = actual - c.consensus;
    const z = rawDelta / c.sigma;
    // tanh squash keeps extreme prints inside [-1, 1] with diminishing returns
    const surprise = Math.tanh(z / 2) * (dir === 'lh' ? -1 : 1);
    const blended = 0.35 * it.net_score + 0.65 * surprise;
    const score = Math.round(Math.max(-1, Math.min(1, blended)) * 1000) / 1000;
    it.net_score = score;
    it.label = score > 0.1 ? 'hawkish' : score < -0.1 ? 'dovish' : 'neutral';
    it.reasons = [
      ...(it.reasons || []).filter(r => !r.startsWith('surprise:')),
      `surprise: actual ${actual} vs consensus ${c.consensus} (z=${(Math.round(z * 100) / 100)}, sigma=${c.sigma})`,
    ];
    // A large surprise is a more reliable policy signal than a routine print.
    const conviction = Math.min(1.5, 1 + Math.abs(z) / 4);
    it.stat_weight = Math.round(Math.max(0.5, (it.stat_weight || 1) * conviction) * 100) / 100;
    applied++;
  }
  console.log(`surprise index: re-scored ${applied}/${candidates.length} statistical items vs consensus`);
  return items;
}
