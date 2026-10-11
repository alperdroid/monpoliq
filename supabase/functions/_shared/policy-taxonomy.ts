export const TAXONOMY_DIMENSIONS = {
  reaction_function: ['inflation_priority', 'growth_priority', 'financial_stability_priority'],
  forward_guidance: ['firm', 'conditional', 'open_ended'],
  risk_balance: ['upside_inflation', 'downside_growth', 'balanced'],
  terminal_rate: ['restrictive_enough', 'more_to_do', 'neutral_framing'],
  time_horizon: ['near_term', 'medium_term', 'mixed'],
  balance_sheet: ['qt_continuing', 'qt_slowing', 'reinvestment_change', 'not_discussed'],
} as const;

export interface TaxonomyDocument {
  bank: string;
  item_date: string;
  source: string;
  title: string;
  url?: string | null;
  is_statistical: boolean;
  policy_dimensions?: unknown;
}

export function isOfficialMeetingStatement(item: TaxonomyDocument): boolean {
  if (item.is_statistical || !item.url) return false;
  let url: URL;
  try { url = new URL(item.url); } catch { return false; }
  const text = `${item.source} ${item.title}`.toLowerCase();
  if (item.bank === 'FED') {
    return url.hostname === 'www.federalreserve.gov' &&
      /fomc statement|fed statement/.test(text) &&
      !/minutes|projections|press conference/.test(text);
  }
  return item.bank === 'ECB' && url.hostname === 'www.ecb.europa.eu' &&
    (/monetary policy decisions|monetary policy statement/.test(text) ||
      url.pathname.includes('/press_conference/monetary-policy-statement/'));
}

export function hasTaxonomyDimensions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.entries(TAXONOMY_DIMENSIONS).every(([key, allowed]) =>
    typeof record[key] === 'string' && (allowed as readonly string[]).includes(record[key] as string));
}

export function statementItemsForMeeting<T extends TaxonomyDocument>(
  items: T[], meeting: { bank: string; date: string }, today: string,
): T[] {
  if (meeting.date >= today) return [];
  const candidates = items.filter(item => item.bank === meeting.bank &&
    item.item_date === meeting.date && isOfficialMeetingStatement(item));
  // ECB's opening monetary policy statement is richer than the decision notice.
  const opening = candidates.filter(item => item.bank === 'ECB' &&
    item.url?.includes('/press_conference/monetary-policy-statement/'));
  const selected = opening.length ? opening : candidates;
  const seen = new Set<string>();
  return selected.filter(item => {
    const key = item.url?.replace(/\/+$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 1);
}

export function taxonomyCacheKey(item: TaxonomyDocument): string {
  return `statement-v1:${item.item_date}:${item.url}`;
}