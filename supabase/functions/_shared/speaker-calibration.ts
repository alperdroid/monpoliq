// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — Signal normalization: speaker calibration
// A known hawk sounding neutral is a dovish signal. Every individual's score is
// standardized against their own historical baseline so that what enters the
// aggregate is the DEVIATION from their personal bias, not the raw tone.
// ─────────────────────────────────────────────────────────────────────────────

export interface CalibratableItem {
  bank: string;
  source: string;
  item_date: string;
  title: string;
  is_statistical: boolean;
  net_score: number;
  label: string;
  reasons: string[];
  policy_dimensions?: Record<string, unknown> | null;
}

const CHAIRS = /powell|lagarde/i;

/** Pull the speaker out of a communication title ("Nagel: Act now …", "Lagarde, Vujčić: …"). */
export function extractSpeaker(title: string): string | null {
  const t = (title || '').trim();
  const colon = t.indexOf(':');
  if (colon > 1 && colon < 60) {
    const head = t.slice(0, colon);
    // Reject headline fragments that are clearly not names.
    if (/\b(the|and|for|report|statement|minutes|account|update|review)\b/i.test(head)) return null;
    const first = head.split(/,|&| and /i)[0].trim();
    if (first.length >= 3 && first.length <= 40 && /^[\p{L}\s.'-]+$/u.test(first)) {
      return first.replace(/\s+/g, ' ');
    }
  }
  const by = t.match(/\bby ([\p{L}][\p{L}\s.'-]{2,38})$/u);
  if (by) return by[1].trim();
  return null;
}

export interface SpeakerBaseline {
  speaker: string;
  mean: number;
  sd: number;
  n: number;
}

/** Build per-speaker baselines from the bank's scored communication history. */
export async function loadSpeakerBaselines(
  bank: string,
  sbUrl: string,
  sbKey: string,
): Promise<Map<string, SpeakerBaseline>> {
  const out = new Map<string, SpeakerBaseline>();
  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/sentiment_items?select=title,net_score&bank=eq.${bank}&is_statistical=eq.false&order=item_date.desc&limit=1500`,
      { headers: { Authorization: 'Bearer ' + sbKey, apikey: sbKey } },
    );
    if (!resp.ok) return out;
    const rows: { title: string; net_score: number }[] = await resp.json();
    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      const sp = extractSpeaker(r.title);
      if (!sp) continue;
      const key = sp.toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(Number(r.net_score) || 0);
    }
    for (const [key, vals] of buckets) {
      if (vals.length < 4) continue; // too thin to be a baseline
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      out.set(key, {
        speaker: key,
        mean: Math.round(mean * 1000) / 1000,
        sd: Math.max(0.05, Math.sqrt(variance)),
        n: vals.length,
      });
    }
  } catch (e) {
    console.log('speaker baselines unavailable:', e instanceof Error ? e.message : e);
  }
  return out;
}

/**
 * Calibrated score = 0.6 · raw + 0.4 · (personal deviation, in tanh-compressed sigmas).
 * Chairs/Presidents are calibrated more gently (0.75/0.25) because their tone IS
 * the committee line rather than a personal stance.
 */
export function calibrateItem<T extends CalibratableItem>(
  it: T,
  baselines: Map<string, SpeakerBaseline>,
): T {
  if (it.is_statistical) return it;
  const speaker = extractSpeaker(it.title);
  if (!speaker) return it;
  const base = baselines.get(speaker.toLowerCase());
  if (!base) return it;

  const wRaw = CHAIRS.test(speaker) ? 0.75 : 0.6;
  const z = (it.net_score - base.mean) / base.sd;
  const deviation = Math.tanh(z / 2);
  const calibrated = Math.max(-1, Math.min(1, wRaw * it.net_score + (1 - wRaw) * deviation));
  const rounded = Math.round(calibrated * 1000) / 1000;

  it.policy_dimensions = {
    ...(it.policy_dimensions || {}),
    speaker,
    speaker_baseline: base.mean,
    speaker_sd: Math.round(base.sd * 1000) / 1000,
    speaker_n: base.n,
    raw_score: it.net_score,
    deviation: Math.round(deviation * 1000) / 1000,
    calibrated_score: rounded,
  };
  it.net_score = rounded;
  it.label = rounded > 0.1 ? 'hawkish' : rounded < -0.1 ? 'dovish' : 'neutral';
  it.reasons = [...(it.reasons || []), `layer3:speaker-calibrated(base ${base.mean}, n=${base.n})`];
  return it;
}

export async function applySpeakerCalibration<T extends CalibratableItem>(
  items: T[],
  bank: string,
  sbUrl: string,
  sbKey: string,
): Promise<T[]> {
  const baselines = await loadSpeakerBaselines(bank, sbUrl, sbKey);
  if (!baselines.size) return items;
  let n = 0;
  for (const it of items) {
    const before = it.net_score;
    calibrateItem(it, baselines);
    if (it.net_score !== before) n++;
  }
  console.log(`Layer3 ${bank}: calibrated ${n}/${items.length} items against ${baselines.size} speaker baselines`);
  return items;
}
