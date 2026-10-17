import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { HistoryBackfill } from '@/components/admin/HistoryBackfill';

describe('history import runner', () => {
  it('previews every page of a part and year without applying', async () => {
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce({ data: { units_total: 2, page: ['FOMC 2015-01-28'], found: 2, new: 2, scored: 2, saved: 0, next_offset: 1 }, error: null })
      .mockResolvedValueOnce({ data: { units_total: 2, page: ['FOMC 2015-03-18 +press conf +SEP'], found: 4, new: 4, scored: 3, saved: 0, next_offset: null }, error: null });
    render(<HistoryBackfill />);
    // one bank, one part, one year
    fireEvent.click(screen.getByRole('button', { name: 'FED' }));
    for (const label of ['Board speeches', 'Member speeches (BIS)', 'Statistics']) fireEvent.click(screen.getByText(label));
    const [from, to] = screen.getAllByRole('spinbutton');
    fireEvent.change(to, { target: { value: '2015' } });
    expect((from as HTMLInputElement).value).toBe('2015');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByText(/saved 0\s+done$/)).toBeTruthy());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body).toMatchObject({ mode: 'backfill-history', bank: 'fed', year: 2015, part: 'policy', offset: 0, apply: false });
    expect(invoke.mock.calls[1][1].body).toMatchObject({ offset: 1 });
    expect(screen.getByText(/calls 2 · found 6 · new 6 · saved 0/)).toBeTruthy();
  });
});
