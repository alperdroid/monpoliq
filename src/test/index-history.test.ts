import { describe, expect, it } from 'vitest';
import type { SentimentItem } from '@/lib/api/sentiment';
import { indexHistoryRows, monthlyAverages } from '@/lib/index-history';

const item = (bank: string, date: string): SentimentItem => ({
  bank, item_date: date, source: 'FOMC Statement', title: 'Policy statement',
  url: '', is_statistical: false, net_score: 0.4, hawk_pts: 4, dove_pts: 0,
  label: 'hawkish', word_count: 100, reasons: [], stat_metric: null,
  stat_value: null, stat_weight: 0,
});

describe('complete index history export', () => {
  it('includes available months older than the chart window and the latest month', () => {
    const items = [item('FED', '2020-01-29'), item('ECB', '2023-06-15'), item('FED', '2026-10-01')];
    const rows = indexHistoryRows(items);
    expect(rows.map(row => row[0])).toEqual(['2020-01', '2023-06', '2026-10']);
    expect(rows[0][1]).toBe(monthlyAverages(items, 'FED')[0].avg);
    expect(rows[0].slice(2)).toEqual([1, '', 0]);
    expect(rows[1][4]).toBe(1);
  });
});