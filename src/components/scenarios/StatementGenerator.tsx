import { useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Loader2, FileText, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';

interface GeneratedStatement {
  statement_text: string;
  key_phrases: string[];
  predicted_stance_score: number;
  predicted_decision_shift: { hike_delta: number; hold_delta: number; cut_delta: number };
  market_impact: { fx_direction: string; yield_direction: string; equity_direction: string };
  parameters: { bank: string; hawkish: number; uncertainty: number; inflation_focus: number; financial_stability: number };
  generated_at: string;
}

export function StatementGenerator() {
  const [bank, setBank] = useState('FED');
  const [hawkish, setHawkish] = useState(0.5);
  const [uncertainty, setUncertainty] = useState(0.5);
  const [inflationFocus, setInflationFocus] = useState(0.5);
  const [financialStability, setFinancialStability] = useState(0.3);
  const [result, setResult] = useState<GeneratedStatement | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('statement-generator', {
        body: { bank, hawkish, uncertainty, inflation_focus: inflationFocus, financial_stability: financialStability },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const dirIcon = (d: string) => {
    if (d.includes('bullish') || d === 'higher' || d === 'positive') return <TrendingUp className="w-3.5 h-3.5" />;
    if (d.includes('bearish') || d === 'lower' || d === 'negative') return <TrendingDown className="w-3.5 h-3.5" />;
    return <Minus className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-6">
      {/* Sliders */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Statement Parameters</h3>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="w-36 h-8 text-xs bg-surface"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FED">Federal Reserve</SelectItem>
              <SelectItem value="ECB">ECB</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Hawkishness</label>
              <span className="text-[10px] font-mono text-muted-foreground">{(hawkish * 100).toFixed(0)}%</span>
            </div>
            <Slider value={[hawkish]} onValueChange={([v]) => setHawkish(v)} min={0} max={1} step={0.05} />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>Very Dovish</span><span>Very Hawkish</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Uncertainty</label>
              <span className="text-[10px] font-mono text-muted-foreground">{(uncertainty * 100).toFixed(0)}%</span>
            </div>
            <Slider value={[uncertainty]} onValueChange={([v]) => setUncertainty(v)} min={0} max={1} step={0.05} />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>Very Confident</span><span>Very Uncertain</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Inflation Focus</label>
              <span className="text-[10px] font-mono text-muted-foreground">{(inflationFocus * 100).toFixed(0)}%</span>
            </div>
            <Slider value={[inflationFocus]} onValueChange={([v]) => setInflationFocus(v)} min={0} max={1} step={0.05} />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>Growth-focused</span><span>Inflation-focused</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Financial Stability</label>
              <span className="text-[10px] font-mono text-muted-foreground">{(financialStability * 100).toFixed(0)}%</span>
            </div>
            <Slider value={[financialStability]} onValueChange={([v]) => setFinancialStability(v)} min={0} max={1} step={0.05} />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>No mention</span><span>Heavy emphasis</span>
            </div>
          </div>
        </div>

        <Button onClick={generate} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {loading ? 'Generating…' : 'Generate Statement'}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4 animate-slide-in">
          <div className="rounded-lg border border-primary/20 bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold">Generated Statement</h4>
              <div className="flex items-center gap-2">
                <SignalBadge label={result.parameters.bank} variant="info" />
                <span className={cn(
                  'text-xs font-mono font-bold',
                  result.predicted_stance_score > 0.1 ? 'text-signal-hawkish' : result.predicted_stance_score < -0.1 ? 'text-signal-dovish' : 'text-signal-neutral',
                )}>
                  Stance: {result.predicted_stance_score > 0 ? '+' : ''}{result.predicted_stance_score.toFixed(2)}
                </span>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap bg-surface rounded-md p-4 border border-border font-serif">
              {result.statement_text}
            </p>
            {result.key_phrases?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.key_phrases.map((p, i) => (
                  <span key={i} className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">"{p}"</span>
                ))}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">Decision Probability Shift</h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-sm font-mono font-bold text-signal-hawkish">
                    {result.predicted_decision_shift.hike_delta > 0 ? '+' : ''}{(result.predicted_decision_shift.hike_delta * 100).toFixed(0)}%
                  </p>
                  <p className="text-[9px] text-muted-foreground">Hike Δ</p>
                </div>
                <div>
                  <p className="text-sm font-mono font-bold text-signal-neutral">
                    {result.predicted_decision_shift.hold_delta > 0 ? '+' : ''}{(result.predicted_decision_shift.hold_delta * 100).toFixed(0)}%
                  </p>
                  <p className="text-[9px] text-muted-foreground">Hold Δ</p>
                </div>
                <div>
                  <p className="text-sm font-mono font-bold text-signal-dovish">
                    {result.predicted_decision_shift.cut_delta > 0 ? '+' : ''}{(result.predicted_decision_shift.cut_delta * 100).toFixed(0)}%
                  </p>
                  <p className="text-[9px] text-muted-foreground">Cut Δ</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">Market Impact</h4>
              <div className="space-y-1.5">
                {[
                  { label: 'FX', value: result.market_impact.fx_direction },
                  { label: 'Yields', value: result.market_impact.yield_direction },
                  { label: 'Equities', value: result.market_impact.equity_direction },
                ].map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-14">{m.label}</span>
                    <span className="text-foreground">{dirIcon(m.value)}</span>
                    <span className="font-medium capitalize">{m.value.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
