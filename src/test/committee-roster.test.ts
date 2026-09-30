import { describe, it, expect } from 'vitest';
import { currentMembers, fomcVoterBanks, isFomcVoter, speakerOf, mentions, COMMITTEE_ROSTER } from '@/data/committee-roster';
describe('roster', () => {
  it('sizes', () => {
    expect(currentMembers('FED').filter(m => m.body === 'fed-board').length).toBe(7);
    expect(currentMembers('FED').filter(m => m.body === 'fed-bank').length).toBe(12);
    expect(currentMembers('ECB').filter(m => m.body === 'ecb-board').length).toBe(6);
    expect(currentMembers('ECB').filter(m => m.body === 'ecb-ncb').length).toBe(21);
  });
  it('rotation', () => {
    expect(fomcVoterBanks(2026)).toEqual(['New York', 'Philadelphia', 'Cleveland', 'Dallas', 'Minneapolis']);
    const voters = currentMembers('FED').filter(m => isFomcVoter(m, 2026));
    expect(voters.length).toBe(12);
  });
  it('attribution', () => {
    expect(speakerOf('Jerome H. Powell: Economic outlook', 'FED', '2026-08-01')?.role).toBe('Governor');
    expect(speakerOf('Villeroy de Galhau: inflation', 'ECB', '2026-03-01')?.name).toBe('François Villeroy de Galhau');
    expect(speakerOf('Villeroy de Galhau: inflation', 'ECB', '2026-07-01')).toBeNull();
    expect(mentions(COMMITTEE_ROSTER.find(m => m.name === 'Philip Lane')!, 'A plane crash')).toBe(false);
    expect(speakerOf('Boris Vujčić: euro outlook', 'ECB', '2025-05-01')?.name).toBe('Boris Vujčić');
  });
});
