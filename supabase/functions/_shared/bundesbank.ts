// ─────────────────────────────────────────────────────────────────────────────
// Bundesbank feed filter. The Bundesbank's "speeches, interviews and contributions" feed covers
// its whole Executive Board and lists most items twice (English and German). Only the President
// sits on the ECB Governing Council, and the frozen scorer reads English only, so an item is kept
// only if it is in English and by the President. His speeches are taken from here, not from BIS,
// because this feed also carries his interviews and guest contributions.
//
// WHEN THE PRESIDENT CHANGES: update BUNDESBANK_PRESIDENT.
// ─────────────────────────────────────────────────────────────────────────────

export const BUNDESBANK_PRESIDENT = 'Joachim Nagel';
export const BUNDESBANK_SOURCE = 'Bundesbank Speech';
export const BUNDESBANK_FEED = 'https://www.bundesbank.de/service/rss/en/633296/feed.rss';
// A speech the Bundesbank lists only in German is taken from BIS when BIS publishes it in English
// (see sameTitle: the BIS copy is skipped when an English Bundesbank copy exists).

const DE = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'auf', 'eine', 'einer', 'einen', 'wir', 'sich',
  'den', 'dem', 'des', 'von', 'zu', 'im', 'bei', 'auch', 'wie', 'über', 'wird', 'werden', 'sind', 'noch', 'nach', 'aus', 'vor']);
const EN = new Set(['the', 'and', 'is', 'not', 'with', 'for', 'on', 'a', 'an', 'we', 'of', 'to', 'in', 'at', 'also', 'how',
  'about', 'will', 'are', 'still', 'after', 'from', 'before', 'that', 'this', 'it', 'be', 'by', 'as']);

/** German rather than English, by common function words in the title and the start of the text. */
export function isGerman(title: string, text: string): boolean {
  const words = `${title} ${text.slice(0, 3000)}`.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let de = 0, en = 0;
  for (const w of words) { if (DE.has(w)) de++; if (EN.has(w)) en++; }
  return de > en;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** By `president`: surname in the title, or full name (middle initial allowed) in the byline / interview
 *  introduction at the top of the text (first 400 characters), not a later mention in someone else's piece. */
export function byBundesbankPresident(title: string, text: string, president = BUNDESBANK_PRESIDENT): boolean {
  const parts = president.split(/\s+/);
  const first = parts[0], surname = parts[parts.length - 1];
  if (new RegExp(`\\b${esc(surname)}\\b`, 'i').test(title)) return true;
  return new RegExp(`\\b${esc(first)}(?:\\s+\\p{Lu}\\.)?\\s+${esc(surname)}\\b`, 'iu').test(text.slice(0, 400));
}

export function bundesbankVerdict(title: string, text: string): { keep: boolean; reason: string } {
  if (!text || text.split(/\s+/).length < 80) return { keep: false, reason: 'page could not be read' };
  if (isGerman(title, text)) return { keep: false, reason: 'German-language copy' };
  if (!byBundesbankPresident(title, text)) return { keep: false, reason: 'not by the Bundesbank President' };
  return { keep: true, reason: 'English, by the President' };
}

/** Same speech title regardless of word order, punctuation and a "Speaker:" prefix (80% of words shared). */
export function sameTitle(a: string, b: string, speaker = BUNDESBANK_PRESIDENT): boolean {
  const words = (t: string) => new Set(titleKey(t, speaker).split(' ').filter(w => w.length >= 3));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared) >= 0.8;
}

/** Comparable form of a title: the part before " | " (Bundesbank) or after "Speaker: " (BIS), no punctuation. */
export function titleKey(title: string, speaker?: string): string {
  let t = title.split(' | ')[0];
  if (speaker && t.toLowerCase().startsWith(speaker.toLowerCase() + ':')) t = t.slice(speaker.length + 1);
  return t.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
