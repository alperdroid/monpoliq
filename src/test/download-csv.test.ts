import { describe, it, expect } from 'vitest';
import { buildCsv } from '@/lib/download-csv';

describe('buildCsv', () => {
  it('joins headers and rows with commas', () => {
    const csv = buildCsv(
      [['2026-01', 0.123, 4]],
      ['month', 'fed_index', 'fed_items'],
    );
    expect(csv).toBe('month,fed_index,fed_items\n2026-01,0.123,4');
  });

  it('escapes fields containing commas or quotes', () => {
    const csv = buildCsv([['a,b', 'say "hi"', null]], ['x', 'y', 'z']);
    expect(csv).toBe('x,y,z\n"a,b","say ""hi""",');
  });

  it('renders null and undefined as empty fields', () => {
    const csv = buildCsv([[null, undefined, 'ok']], ['a', 'b', 'c']);
    expect(csv).toBe('a,b,c\n,,ok');
  });
});
