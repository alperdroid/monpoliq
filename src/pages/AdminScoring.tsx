import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FROZEN_MODEL } from '@/lib/scoring-provenance';

/**
 * Admin page for the switch from Gemini scoring to the frozen scorer.
 * Every write goes through the sentiment-analysis edge function, which checks that the
 * signed-in user's email is listed in the ADMIN_EMAILS secret. This page only reads
 * data directly (the scorer_comparison view).
 */

interface CmpRow {
  id: string; bank: string; source: string; item_date: string; title: string; url: string | null;
  net_score: number; frozen_score: number | null; ai_score: number | null; disagreement: boolean | null;
  scorer_model: string | null; n_sentences: number | null;
}
interface Status { scorer_mode: string; member_source: string; gemini_key_present: boolean }
type Bank = 'both' | 'fed' | 'ecb';
interface Progress { scored: number; skipped: number; offset: number; done: boolean }

const PAGE = 1000;
const isSep = (r: CmpRow) => /fomc sep|summary of economic projections/i.test(`${r.source} ${r.title}`);
const isAiRemark = (r: CmpRow) => r.source === 'GC Member Remark' || r.source === 'Fed Official Remark';

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const fmt = (v: number | null | undefined, d = 3) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d));

async function loadComparison(): Promise<CmpRow[]> {
  const rows: CmpRow[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase
      .from('scorer_comparison' as never)
      .select('id,bank,source,item_date,title,url,net_score,frozen_score,ai_score,disagreement,scorer_model,n_sentences')
      .order('item_date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as CmpRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export default function AdminScoring() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CmpRow[]>([]);
  const [rowsErr, setRowsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [bank, setBank] = useState<Bank>('both');
  const [apply, setApply] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [runErr, setRunErr] = useState<string | null>(null);
  const stopRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true); setRowsErr(null);
    try { setRows(await loadComparison()); } catch (e) { setRowsErr(String((e as Error).message || e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke('sentiment-analysis', { body: { mode: 'scoring-status' } }).then(({ data, error }) => {
      if (error) setStatusErr('Not authorised, or the function is unreachable. Your email must be listed in the ADMIN_EMAILS secret.');
      else setStatus(data as Status);
    });
    refresh();
  }, [user, refresh]);

  const runBackfill = async () => {
    setConfirmOpen(false); setRunning(true); setRunErr(null); stopRef.current = false;
    const acc: Record<string, Progress> = {};
    let offset = 0;
    try {
      while (!stopRef.current) {
        const { data, error } = await supabase.functions.invoke('sentiment-analysis', {
          body: { mode: 'rescore-frozen', bank, offset, limit: 20, apply },
        });
        if (error) { setRunErr(String(error.message || error)); break; }
        const result = (data?.result ?? {}) as Record<string, { scored: number; skipped: number; next_offset: number | null }>;
        for (const [b, r] of Object.entries(result)) {
          const prev = acc[b] ?? { scored: 0, skipped: 0, offset: 0, done: false };
          acc[b] = { scored: prev.scored + r.scored, skipped: prev.skipped + r.skipped, offset: r.next_offset ?? prev.offset, done: r.next_offset === null };
        }
        setProgress({ ...acc });
        const next = Object.values(result).map(r => r.next_offset).filter((n): n is number => n !== null);
        if (next.length === 0) break;
        offset = Math.max(...next);
      }
    } catch (e) { setRunErr(String((e as Error).message || e)); }
    setRunning(false);
    refresh();
  };

  const stats = useMemo(() => {
    const byBank = (b: string) => rows.filter(r => r.bank === b);
    return (['FED', 'ECB'] as const).map(b => {
      const all = byBank(b);
      const pairs = all.filter(r => r.frozen_score != null && r.ai_score != null && !isSep(r));
      const x = pairs.map(r => r.frozen_score as number), y = pairs.map(r => r.ai_score as number);
      const mae = pairs.length ? pairs.reduce((a, r) => a + Math.abs((r.frozen_score as number) - (r.ai_score as number)), 0) / pairs.length : null;
      const dis = pairs.filter(r => Math.sign(r.frozen_score as number) !== Math.sign(r.ai_score as number)
        && Math.abs(r.frozen_score as number) > 0.2 && Math.abs(r.ai_score as number) > 0.2).length;
      return {
        bank: b, total: all.length,
        withFrozen: all.filter(r => r.frozen_score != null).length,
        published: all.filter(r => r.scorer_model === FROZEN_MODEL).length,
        sep: all.filter(isSep).length,
        bis: all.filter(r => r.source === 'Member Speech (BIS)').length,
        aiRemarks: all.filter(isAiRemark).length,
        n: pairs.length, corr: pearson(x, y), mae, disRate: pairs.length ? dis / pairs.length : null, pairs,
      };
    });
  }, [rows]);

  const modeInUse = useMemo(() => {
    const recent = rows.filter(r => !isSep(r)).slice(0, 20).map(r => r.scorer_model || 'none');
    const counts = recent.reduce<Record<string, number>>((a, m) => ({ ...a, [m]: (a[m] || 0) + 1 }), {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [rows]);

  const topDisagreements = useMemo(() => rows
    .filter(r => r.frozen_score != null && r.ai_score != null && !isSep(r))
    .map(r => ({ ...r, gap: Math.abs((r.frozen_score as number) - (r.ai_score as number)) }))
    .sort((a, b) => b.gap - a.gap).slice(0, 20), [rows]);

  if (!user) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-lg font-semibold">Scoring migration</h1>
        <p className="text-sm text-muted-foreground">Please <Link to="/login" className="text-primary underline">sign in</Link> with an admin account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Scoring migration</h1>
      </div>

      {/* 3a — status */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Status</h2>
        {statusErr ? <p className="text-sm text-destructive">{statusErr}</p> : (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>SCORER_MODE: <span className="font-mono">{status?.scorer_mode ?? '…'}</span></span>
            <span>MEMBER_SOURCE: <span className="font-mono">{status?.member_source ?? '…'}</span></span>
            <span>Gemini key (scraping, SEP): <span className="font-mono">{status ? (status.gemini_key_present ? 'present' : 'missing') : '…'}</span></span>
            <span>Scorer in use on the 20 newest texts: <span className="font-mono">{modeInUse ?? '…'}</span></span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left">
              <th className="py-1 pr-3">Bank</th><th className="pr-3">Communications</th><th className="pr-3">With frozen score</th>
              <th className="pr-3">Published by frozen scorer</th><th className="pr-3">SEP</th><th className="pr-3">BIS speeches</th><th>AI-found remarks</th>
            </tr></thead>
            <tbody>{stats.map(s => (
              <tr key={s.bank} className="border-t border-border font-mono">
                <td className="py-1 pr-3 font-sans font-medium">{s.bank}</td><td className="pr-3">{s.total}</td><td className="pr-3">{s.withFrozen}</td>
                <td className="pr-3">{s.published}</td><td className="pr-3">{s.sep}</td><td className="pr-3">{s.bis}</td><td>{s.aiRemarks}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        {rowsErr && <p className="text-xs text-destructive">Could not read scorer_comparison: {rowsErr}</p>}
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </section>

      {/* 3b — backfill */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Backfill stored history with the frozen scorer</h2>
        <p className="text-xs text-muted-foreground leading-snug">
          Unchecked: writes the frozen score next to the existing one (nothing published changes).
          Checked: overwrites the published score, label and the three dimensions, and keeps the previous
          Gemini score for reference. SEP rows are always skipped. Each call re-reads up to 20 source pages per bank.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-1.5">
            {(['both', 'fed', 'ecb'] as const).map(b => (
              <Button key={b} size="sm" variant={bank === b ? 'default' : 'outline'} className="h-7 text-xs" disabled={running} onClick={() => setBank(b)}>
                {b.toUpperCase()}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={apply} disabled={running} onCheckedChange={v => setApply(v === true)} />
            Apply (overwrite published scores)
          </label>
          {!running
            ? <Button size="sm" onClick={() => setConfirmOpen(true)}>Run</Button>
            : <Button size="sm" variant="destructive" onClick={() => { stopRef.current = true; }}>Stop after current batch</Button>}
        </div>
        {Object.keys(progress).length > 0 && (
          <div className="text-xs font-mono space-y-0.5">
            {Object.entries(progress).map(([b, p]) => (
              <div key={b}>{b}: scored {p.scored} · skipped {p.skipped} · offset {p.offset}{p.done ? ' · done' : running ? ' · running' : ''}</div>
            ))}
          </div>
        )}
        {runErr && <p className="text-xs text-destructive">{runErr} — if calls time out, the batch size is too large for the function time limit.</p>}
      </section>

      {/* 3c — comparison */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold">Frozen scorer vs previous Gemini score</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left">
              <th className="py-1 pr-3">Bank</th><th className="pr-3">Pairs</th><th className="pr-3">Correlation</th>
              <th className="pr-3">Mean |difference|</th><th>Disagreement rate</th>
            </tr></thead>
            <tbody>{stats.map(s => (
              <tr key={s.bank} className="border-t border-border font-mono">
                <td className="py-1 pr-3 font-sans font-medium">{s.bank}</td><td className="pr-3">{s.n}</td><td className="pr-3">{fmt(s.corr)}</td>
                <td className="pr-3">{fmt(s.mae)}</td><td>{s.disRate == null ? '—' : `${(s.disRate * 100).toFixed(1)}%`}</td>
              </tr>))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-1">Disagreement: opposite signs with both scores beyond ±0.2. SEP rows excluded.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {stats.map(s => (
            <div key={s.bank} className="h-64">
              <p className="text-xs font-medium mb-1">{s.bank}: frozen (x) vs Gemini (y)</p>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" dataKey="frozen_score" domain={[-1, 1]} tick={{ fontSize: 10 }} />
                  <YAxis type="number" dataKey="ai_score" domain={[-1, 1]} tick={{ fontSize: 10 }} />
                  <ReferenceLine x={0} className="stroke-muted-foreground" />
                  <ReferenceLine y={0} className="stroke-muted-foreground" />
                  <RTooltip formatter={(v: number) => v.toFixed(3)} />
                  <Scatter data={s.pairs} fill="hsl(var(--primary))" fillOpacity={0.55} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <p className="text-xs font-medium mb-1">20 largest differences</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left">
              <th className="py-1 pr-3">Date</th><th className="pr-3">Bank</th><th className="pr-3">Source</th><th className="pr-3">Title</th>
              <th className="pr-3">Frozen</th><th className="pr-3">Gemini</th><th />
            </tr></thead>
            <tbody>{topDisagreements.map(r => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-1 pr-3 font-mono whitespace-nowrap">{r.item_date}</td><td className="pr-3">{r.bank}</td>
                <td className="pr-3 whitespace-nowrap">{r.source}</td><td className="pr-3">{r.title}</td>
                <td className="pr-3 font-mono">{fmt(r.frozen_score, 2)}</td><td className="pr-3 font-mono">{fmt(r.ai_score, 2)}</td>
                <td>{r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="w-3 h-3" /></a>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{apply ? 'Overwrite published scores?' : 'Run a comparison backfill?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {apply
                ? `This rescores every stored ${bank === 'both' ? 'FED and ECB' : bank.toUpperCase()} communication with the frozen scorer and replaces the published score, label and dimensions. The previous Gemini score is kept in the audit record.`
                : `This writes the frozen score next to the existing score for every stored ${bank === 'both' ? 'FED and ECB' : bank.toUpperCase()} communication. Published scores do not change.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBackfill}>{apply ? 'Overwrite' : 'Run'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
