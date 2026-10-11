import { describe, expect, it } from 'vitest';
import { hasTaxonomyDimensions, statementItemsForMeeting, TAXONOMY_DIMENSIONS } from '../../supabase/functions/_shared/policy-taxonomy';

const fed = { bank: 'FED', item_date: '2026-09-16', source: 'Fed Press', title: 'Federal Reserve issues FOMC statement', url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm', is_statistical: false };
const ecb = { bank: 'ECB', item_date: '2026-09-10', source: 'ECB Press Conf', title: 'ECB Monetary Policy Press Conference', url: 'https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/2026/html/ecb.is260910.en.html', is_statistical: false };
describe('meeting statement taxonomy', () => {
  it('does not mistake frozen scoring metadata for six taxonomy dimensions', () => {
    expect(hasTaxonomyDimensions({ relevance: 'policy', policy_stance: 0.659, scoring_audit: {} })).toBe(false);
    expect(hasTaxonomyDimensions(Object.fromEntries(Object.entries(TAXONOMY_DIMENSIONS).map(([k, v]) => [k, v[0]])))).toBe(true);
  });
  it('selects the September 16 Fed statement, not speeches, projections or another meeting', () => {
    const items = [fed, { ...fed, title: 'September economic projections' }, { ...fed, title: 'Williams speech' }, { ...fed, item_date: '2026-07-29' }];
    expect(statementItemsForMeeting(items, { bank: 'FED', date: '2026-09-16' }, '2026-10-11')).toEqual([fed]);
  });
  it('prefers the September 10 ECB opening statement over the decision notice', () => {
    const decision = { ...ecb, title: 'Monetary policy decisions', url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp260910.en.html' };
    expect(statementItemsForMeeting([decision, ecb], { bank: 'ECB', date: '2026-09-10' }, '2026-10-11')).toEqual([ecb]);
  });
  it('never includes an unreleased meeting or third-party text', () => {
    expect(statementItemsForMeeting([fed], { bank: 'FED', date: '2026-09-16' }, '2026-09-16')).toEqual([]);
    expect(statementItemsForMeeting([{ ...fed, url: 'https://example.com/news' }], { bank: 'FED', date: '2026-09-16' }, '2026-10-11')).toEqual([]);
  });
  it('does not count multiple copies of the same official statement', () => {
    expect(statementItemsForMeeting([fed, { ...fed }], { bank: 'FED', date: '2026-09-16' }, '2026-10-11')).toHaveLength(1);
  });
});