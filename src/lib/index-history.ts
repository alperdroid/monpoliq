import { blendedAggregate, type WeightableItem } from '@/lib/scoring-weights';

/** Use the chart's existing monthly calculation without limiting history. */
export function monthlyAverages(items: WeightableItem[], bank?: string) {
  const filtered = (bank ? items.filter(i => i.bank === bank) : items).filter(i => Math.abs(i.net_score) > 0.001);
  const byMonth: Record<string, WeightableItem[]> = {};
  for (const it of filtered) {
    const month = it.item_date.slice(0, 7);
    (byMonth[month] ||= []).push(it);
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthItems]) => {
      const asOf = new Date(`${month}-01T00:00:00Z`);
      asOf.setUTCMonth(asOf.getUTCMonth() + 1);
      const blended = blendedAggregate(monthItems, bank, asOf);
      return { month, avg: blended.avg, count: monthItems.length };
    });
}

export function indexHistoryRows(items: WeightableItem[]) {
  const fed = new Map(monthlyAverages(items, 'FED').map(m => [m.month, m]));
  const ecb = new Map(monthlyAverages(items, 'ECB').map(m => [m.month, m]));
  return [...new Set([...fed.keys(), ...ecb.keys()])].sort().map(month => [
    month,
    fed.get(month)?.avg ?? '',
    fed.get(month)?.count ?? 0,
    ecb.get(month)?.avg ?? '',
    ecb.get(month)?.count ?? 0,
  ]);
}