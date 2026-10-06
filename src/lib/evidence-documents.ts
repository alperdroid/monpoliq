interface EvidenceDocument {
  bank: string;
  item_date: string;
  source: string;
  title: string;
  url: string;
  is_statistical: boolean;
}

export interface EvidenceDocumentGroup<T> {
  primary: T;
  copies: T[];
}

function speechKey(item: EvidenceDocument): string | null {
  // Only match named speeches on the same date; never combine distinct genres,
  // unnamed documents, different speakers or repeat deliveries on another date.
  if (item.is_statistical || !/speech/i.test(item.source)) return null;
  const colon = item.title.indexOf(':');
  if (colon < 2 || colon > 60) return null;
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const speaker = normalize(item.title.slice(0, colon));
  const title = normalize(item.title.slice(colon + 1));
  return title ? `${item.bank}|${item.item_date}|${speaker}|${title}` : null;
}

function isOriginalPublisher(item: EvidenceDocument): boolean {
  try {
    const host = new URL(item.url).hostname.toLowerCase();
    return item.bank === 'FED'
      ? host === 'federalreserve.gov' || host.endsWith('.federalreserve.gov') ||
        /(^|\.)(newyorkfed|bostonfed|philadelphiafed|clevelandfed|richmondfed|atlantafed|chicagofed|stlouisfed|minneapolisfed|kansascityfed|dallasfed|frbsf)\.(org|com)$/.test(host)
      : host === 'ecb.europa.eu' || host.endsWith('.ecb.europa.eu');
  } catch {
    return false;
  }
}

/** Presentation-only grouping: retain every source's score and evidence unchanged. */
export function groupEvidenceDocuments<T extends EvidenceDocument>(items: T[]): EvidenceDocumentGroup<T>[] {
  const groups: EvidenceDocumentGroup<T>[] = [];
  const bySpeech = new Map<string, EvidenceDocumentGroup<T>>();
  for (const item of items) {
    const key = speechKey(item);
    const existing = key ? bySpeech.get(key) : undefined;
    if (existing) {
      existing.copies.push(item);
      if (isOriginalPublisher(item) && !isOriginalPublisher(existing.primary)) existing.primary = item;
    } else {
      const group = { primary: item, copies: [item] };
      groups.push(group);
      if (key) bySpeech.set(key, group);
    }
  }
  return groups;
}