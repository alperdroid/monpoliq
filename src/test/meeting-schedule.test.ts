import { describe, expect, it } from 'vitest';
import { CENTRAL_BANK_MEETINGS } from '@/data/meeting-schedule';
import { policyActionAnchor } from '@/lib/scoring-weights';
import { POLICY_ACTIONS } from '../../supabase/functions/_shared/scoring-weights';

describe('decision calendar from 2015', () => {
  it('has the same decisions as POLICY_ACTIONS on the backend', () => {
    for (const bank of ['FED', 'ECB'] as const) {
      const decided = CENTRAL_BANK_MEETINGS
        .filter(m => m.bank === bank && typeof m.bps === 'number')
        .map(m => ({ date: m.date, bps: m.bps }));
      expect(decided).toEqual(POLICY_ACTIONS[bank]);
    }
  });

  it('labels historical decisions with the resulting rate', () => {
    const byId = new Map(CENTRAL_BANK_MEETINGS.map(m => [m.id, m]));
    expect(byId.get('fed-2015-12-16')?.label).toBe('FOMC Dec 2015 — Hike to 0.25–0.50%');
    expect(byId.get('fed-2020-03-15')?.label).toBe('FOMC Mar 2020 (unscheduled) — Cut to 0.00–0.25%');
    expect(byId.get('ecb-2019-09-12')?.decision).toBe('Cut 10bps — Deposit Facility Rate to -0.50%');
    expect(byId.get('ecb-2025-01-30')?.label).toBe('ECB Jan 2025 — Cut to 2.75%');
    expect(new Set(CENTRAL_BANK_MEETINGS.map(m => m.id)).size).toBe(CENTRAL_BANK_MEETINGS.length);
  });

  it('gives historical months a policy anchor', () => {
    // 2022 hiking cycle: the anchor is hawkish (clamped), as it would have been at the time.
    expect(policyActionAnchor('FED', new Date('2022-10-01T00:00:00Z')).score).toBeGreaterThan(0.5);
    // ECB 2016 negative-rate cut: dovish.
    expect(policyActionAnchor('ECB', new Date('2016-04-01T00:00:00Z')).score).toBeLessThan(0);
  });
});
