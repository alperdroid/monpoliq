import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Drives the sentiment-analysis admin mode "backfill-history": one bank / part / year per call,
 * paged with next_offset, until every page is done. Preview (apply off) reports what would be
 * stored; apply writes. Every communication is scored by the frozen scorer on the server.
 */

type Part = 'policy' | 'speeches' | 'members' | 'stats';
const PARTS: { id: Part; label: string; hint: string }[] = [
  { id: 'policy', label: 'Policy documents', hint: 'FOMC statements, minutes, press conferences, SEP · ECB statements, decisions, accounts' },
  { id: 'speeches', label: 'Board speeches', hint: 'Fed Board · ECB Executive Board (speeches, interviews)' },
  { id: 'members', label: 'Member speeches (BIS)', hint: 'euro-area governors · regional Fed presidents in their voting year' },
  { id: 'stats', label: 'Statistics', hint: 'FRED first releases · ECB Data Portal · balance sheets (once per bank, not per year)' },
];

interface Reply {
  units_total?: number; next_offset?: number | null; found?: number; new?: number; saved?: number;
  scored?: number; operational?: number; page?: string[]; series?: string | null; errors?: string[];
  listing?: unknown[]; tried?: unknown[]; error?: string; sample?: unknown[];
  surprise_rescored?: { found: number; restored: number };
}
interface Tally { calls: number; found: number; fresh: number; saved: number; errors: number }

const thisYear = new Date().getUTCFullYear();

export function HistoryBackfill() {
  const [banks, setBanks] = useState<'both' | 'fed' | 'ecb'>('both');
  const [fromYear, setFromYear] = useState(2015);
  const [toYear, setToYear] = useState(thisYear - 1);
  const [parts, setParts] = useState<Part[]>(['policy', 'speeches', 'members', 'stats']);
  const [apply, setApply] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [tally, setTally] = useState<Tally>({ calls: 0, found: 0, fresh: 0, saved: 0, errors: 0 });
  const [lastReply, setLastReply] = useState<Reply | null>(null);
  const stop = useRef(false);

  const say = (line: string) => setLog(l => [...l.slice(-300), line]);

  // A failed call is retried once with one unit per call (a meeting with long transcript PDFs can hit
  // the function's CPU limit when two are read together).
  const call = async (body: Record<string, unknown>): Promise<Reply | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase.functions.invoke('sentiment-analysis', {
        body: { mode: 'backfill-history', ...body, ...(attempt ? { limit: 1 } : {}) },
      });
      if (!error) return data as Reply;
      say(`  ! ${String(error.message || error)}${attempt === 0 ? ' — retrying with one unit' : ''}`);
    }
    return null;
  };

  const run = async () => {
    setConfirm(false); setRunning(true); setLog([]); stop.current = false;
    const t: Tally = { calls: 0, found: 0, fresh: 0, saved: 0, errors: 0 };
    const order = PARTS.map(p => p.id).filter(p => parts.includes(p));
    try {
      for (const bank of banks === 'both' ? ['fed', 'ecb'] : [banks]) {
        for (const part of order) {
          const years = part === 'stats' ? [fromYear] : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
          for (const year of years) {
            let offset: number | null = 0;
            while (offset !== null && !stop.current) {
              const r = await call({ bank, year, part, offset, apply, from: `${fromYear}-01-01` });
              if (!r) { t.errors++; stop.current = true; say(`stopped: ${bank} ${part} ${year} offset ${offset} failed twice`); break; }
              if (r.error) { t.errors++; say(`${bank} ${part}: ${r.error}`); break; }
              t.calls++; t.found += r.found ?? 0; t.fresh += r.new ?? r.found ?? 0; t.saved += r.saved ?? 0; t.errors += r.errors?.length ?? 0;
              setTally({ ...t }); setLastReply(r);
              const where = part === 'stats' ? `${bank.toUpperCase()} stats ${r.series ?? ''}` : `${bank.toUpperCase()} ${part} ${year}`;
              say(`${where} [${offset + 1}/${r.units_total ?? '?'}] ${(r.page ?? []).join(', ')} → found ${r.found ?? 0}`
                + `${r.new !== undefined ? `, new ${r.new}` : ''}${r.scored !== undefined ? `, scored ${r.scored}` : ''}`
                + `${r.operational ? `, operational ${r.operational}` : ''}, saved ${r.saved ?? 0}`);
              if (offset === 0 && r.units_total === 0) say(`  (nothing listed — check the sources: ${JSON.stringify(r.listing ?? r.tried ?? []).slice(0, 300)})`);
              if (r.surprise_rescored?.found) say(`  old Gemini "surprise" scores: ${r.surprise_rescored.found} found, ${r.surprise_rescored.restored} ${apply ? 'restored to their level score' : 'to restore'}`);
              for (const e of r.errors ?? []) say(`  ! ${e}`);
              offset = r.next_offset ?? null;
            }
            if (stop.current) break;
          }
          if (stop.current) break;
        }
        if (stop.current) break;
      }
      say(stop.current ? 'stopped' : 'done');
    } catch (e) { say(`error: ${String((e as Error).message || e)}`); }
    setRunning(false);
  };

  const togglePart = (p: Part, on: boolean) => setParts(ps => (on ? [...new Set([...ps, p])] : ps.filter(x => x !== p)));
  const yearInput = (value: number, set: (n: number) => void) => (
    <input
      type="number" min={2015} max={thisYear} value={value} disabled={running}
      onChange={e => set(Math.max(2015, Math.min(thisYear, Number(e.target.value) || 2015)))}
      className="h-7 w-20 rounded border border-border bg-background px-2 text-xs font-mono"
    />
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Import history (from 2015)</h2>
      <p className="text-xs text-muted-foreground leading-snug">
        Reads the official archives year by year and scores every communication with the frozen scorer, like live items
        (no Gemini; SEP from FRED&rsquo;s published medians). Run a preview first: it reports what each archive returned
        without writing anything. Already stored items are skipped, so a stopped run can be resumed.
        Before 2025 the ECB statistics are today&rsquo;s revised values dated at their usual release day.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1.5">
          {(['both', 'fed', 'ecb'] as const).map(b => (
            <Button key={b} size="sm" variant={banks === b ? 'default' : 'outline'} className="h-7 text-xs" disabled={running} onClick={() => setBanks(b)}>
              {b.toUpperCase()}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">From {yearInput(fromYear, setFromYear)} to {yearInput(toYear, n => setToYear(Math.max(n, fromYear)))}</label>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PARTS.map(p => (
          <label key={p.id} className="flex items-start gap-2 text-sm">
            <Checkbox checked={parts.includes(p.id)} disabled={running} onCheckedChange={v => togglePart(p.id, v === true)} className="mt-0.5" />
            <span>{p.label}<span className="block text-[11px] text-muted-foreground">{p.hint}</span></span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={apply} disabled={running} onCheckedChange={v => setApply(v === true)} />
          Apply (store the items)
        </label>
        {!running
          ? <Button size="sm" disabled={!parts.length} onClick={() => (apply ? setConfirm(true) : run())}>{apply ? 'Import' : 'Preview'}</Button>
          : <Button size="sm" variant="destructive" onClick={() => { stop.current = true; }}>Stop after current call</Button>}
      </div>
      {tally.calls > 0 && (
        <div className="text-xs font-mono">calls {tally.calls} · found {tally.found} · new {tally.fresh} · saved {tally.saved} · errors {tally.errors}</div>
      )}
      {log.length > 0 && (
        <pre className="max-h-72 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] leading-snug whitespace-pre-wrap">{log.join('\n')}</pre>
      )}
      {lastReply?.sample && lastReply.sample.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Last call: sample of scored items</summary>
          <pre className="mt-1 max-h-60 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(lastReply.sample, null, 1)}</pre>
        </details>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import history into the index?</AlertDialogTitle>
            <AlertDialogDescription>
              Stores the {fromYear}–{toYear} items for {banks === 'both' ? 'the Fed and the ECB' : banks.toUpperCase()} in sentiment_items.
              They feed the monthly history and the CSV export; today&rsquo;s headline only reads the last year. Items already stored are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
