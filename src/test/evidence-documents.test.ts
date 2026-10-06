import { describe, expect, it } from 'vitest';
import { groupEvidenceDocuments } from '@/lib/evidence-documents';

const bis = {
  bank: 'FED', item_date: '2026-09-29', source: 'Member Speech (BIS)',
  title: 'John C Williams: Unwavering dedication', url: 'https://www.bis.org/speeches/20261005-unwavering-dedication',
  is_statistical: false, net_score: 0.775,
};
const fed = {
  ...bis, source: 'Member Speech (Fed site)', title: 'John C. Williams: Unwavering Dedication',
  url: 'https://www.newyorkfed.org/newsevents/speeches/2026/wil260929', net_score: 0.722,
};

describe('evidence document grouping', () => {
  it('groups the Williams BIS and Fed copies and retains their exact scores', () => {
    const groups = groupEvidenceDocuments([bis, fed]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(fed);
    expect(groups[0].copies.map(item => item.net_score)).toEqual([0.775, 0.722]);
    expect(groupEvidenceDocuments([fed, bis])[0].primary).toBe(fed);
  });
  it('keeps different speakers, dates, banks and titles separate', () => {
    expect(groupEvidenceDocuments([bis,
      { ...fed, title: 'Christopher Waller: Unwavering dedication' },
      { ...fed, item_date: '2026-09-30' },
      { ...fed, bank: 'ECB' },
      { ...fed, title: 'John C. Williams: Do You Remember?' },
    ])).toHaveLength(5);
  });
  it('does not merge minutes, statements, statistical releases or unnamed speeches', () => {
    for (const variant of [
      { source: 'FOMC Minutes' }, { source: 'FOMC Statement' },
      { is_statistical: true }, { title: 'Unwavering dedication' },
    ]) {
      const item = { ...bis, ...variant };
      expect(groupEvidenceDocuments([item, { ...item, url: fed.url }])).toHaveLength(2);
    }
  });
});