import { useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Zap, TrendingUp, TrendingDown, Minus, AlertTriangle, History, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatementGenerator } from '@/components/scenarios/StatementGenerator';

interface PolicyStep {
  meeting: string;
  action: string;
  probability: number;
  shift_from_baseline: string;
}

interface CounterfactualResult {
  scenario_name: string;
  scenario_impact: string;
  policy_path: PolicyStep[];
  eurusd_impact: { direction: string; magnitude: string; reasoning: string };
  us10y_impact: { direction: string; magnitude: string; reasoning: string };
  historical_analogs: { date: string; event: string; market_reaction: string }[];
  confidence: number;
  risk_factors: string[];
  bank: string;
  generated_at: string;
}

const SCENARIOS = [
  { value: 'more_restrictive', label: 'More Restrictive', desc: 'Hawkish pivot — emphasis on inflation persistence' },
  { value: 'data_dependent', label: 'Data Dependent', desc: 'Remove directional bias, pure optionality' },
  { value: 'cuts_possible', label: 'Cuts Possible', desc: 'Dovish tilt — growth concerns, ready to ease' },
  { value: 'emergency_easing', label: 'Emergency Easing', desc: 'Crisis mode — financial stability, urgent cuts' },
  { value: 'custom', label: 'Custom Scenario', desc: 'Write your own hypothetical statement' },
];

const Counterfactual = () => {
  const [bank, setBank] = useState<string>('FED');
  const [scenario, setScenario] = useState<string>('');
  const [customText, setCustomText] = useState('');
  const [result, setResult] = useState<CounterfactualResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runScenario = async () => {
    if (!scenario) { toast.error('Select a scenario'); return; }
    if (scenario === 'custom' && !customText.trim()) { toast.error('Enter scenario text'); return; }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('counterfactual', {
        body: { bank, scenario, custom_text: customText },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      toast.error(e.message || 'Scenario analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const dirIcon = (dir: string) => {
    if (dir === 'bullish' || dir === 'higher') return <TrendingUp className="w-4 h-4" />;
    if (dir === 'bearish' || dir === 'lower') return <TrendingDown className="w-4 h-4" />;
    return <Minus className="w-4 h-4" />;
  };

  const dirColor = (dir: string) => {
    if (dir === 'bullish' || dir === 'higher') return 'text-data-positive';
    if (dir === 'bearish' || dir === 'lower') return 'text-data-negative';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="text-lg font-semibold">What If… Lab</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Scenario analysis and synthetic statement generation
        </p>
      </div>

      <Tabs defaultValue="counterfactual" className="space-y-4">
        <TabsList>
          <TabsTrigger value="counterfactual" className="text-xs gap-1.5"><Zap className="w-3 h-3" /> Counterfactual</TabsTrigger>
          <TabsTrigger value="generator" className="text-xs gap-1.5"><FileText className="w-3 h-3" /> Statement Generator</TabsTrigger>
        </TabsList>

        <TabsContent value="generator">
          <StatementGenerator />
        </TabsContent>

        <TabsContent value="counterfactual">

      {/* Controls */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="w-28 h-9 text-xs bg-surface"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FED">Federal Reserve</SelectItem>
              <SelectItem value="ECB">ECB</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {SCENARIOS.map(s => (
            <button
              key={s.value}
              onClick={() => setScenario(s.value)}
              className={cn(
                'rounded-lg border p-3 text-left transition-all',
                scenario === s.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-surface hover:border-primary/30',
              )}
            >
              <p className="text-xs font-semibold">{s.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
            </button>
          ))}
        </div>

        {scenario === 'custom' && (
          <Textarea
            placeholder="Write your hypothetical statement or scenario... e.g. 'The committee noted that inflation has fallen below target and labor market conditions have weakened significantly...'"
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            className="text-xs min-h-[100px] bg-surface"
          />
        )}

        <Button onClick={runScenario} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {loading ? 'Analyzing…' : 'Run Scenario'}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4 animate-slide-in">
          {/* Summary */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">{result.scenario_name}</h2>
              <SignalBadge label={result.bank} variant="info" />
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                Confidence: {(result.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs text-foreground leading-relaxed">{result.scenario_impact}</p>
          </div>

          {/* Policy Path */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Implied Policy Path
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {result.policy_path.map((step, i) => (
                <div key={i} className="rounded-lg bg-surface border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {step.meeting}
                    </span>
                    <span className={cn(
                      'text-xs font-bold uppercase',
                      step.action === 'cut' ? 'text-signal-dovish' : step.action === 'hike' ? 'text-signal-hawkish' : 'text-signal-neutral',
                    )}>
                      {step.action}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={cn(
                        'h-2 rounded-full transition-all',
                        step.action === 'cut' ? 'bg-signal-dovish' : step.action === 'hike' ? 'bg-signal-hawkish' : 'bg-signal-neutral',
                      )}
                      style={{ width: `${step.probability * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{step.shift_from_baseline}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Market Impact */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">EUR/USD Impact</h3>
              <div className="flex items-center gap-2">
                <span className={dirColor(result.eurusd_impact.direction)}>
                  {dirIcon(result.eurusd_impact.direction)}
                </span>
                <span className={cn('text-sm font-bold uppercase', dirColor(result.eurusd_impact.direction))}>
                  {result.eurusd_impact.direction}
                </span>
                <SignalBadge
                  label={result.eurusd_impact.magnitude}
                  variant={result.eurusd_impact.magnitude === 'strong' ? 'hawkish' : 'neutral'}
                  size="sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{result.eurusd_impact.reasoning}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">US 10Y Treasury</h3>
              <div className="flex items-center gap-2">
                <span className={dirColor(result.us10y_impact.direction)}>
                  {dirIcon(result.us10y_impact.direction)}
                </span>
                <span className={cn('text-sm font-bold uppercase', dirColor(result.us10y_impact.direction))}>
                  {result.us10y_impact.direction}
                </span>
                <SignalBadge
                  label={result.us10y_impact.magnitude}
                  variant={result.us10y_impact.magnitude === 'strong' ? 'hawkish' : 'neutral'}
                  size="sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{result.us10y_impact.reasoning}</p>
            </div>
          </div>

          {/* Historical Analogs */}
          {result.historical_analogs?.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Historical Analogs
                </h3>
              </div>
              <div className="space-y-2">
                {result.historical_analogs.map((analog, i) => (
                  <div key={i} className="flex gap-3 text-xs p-2 rounded bg-surface">
                    <span className="font-mono text-muted-foreground flex-shrink-0 w-16">{analog.date}</span>
                    <span className="text-foreground">{analog.event}</span>
                    <span className="text-muted-foreground ml-auto flex-shrink-0">→ {analog.market_reaction}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk Factors */}
          {result.risk_factors?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-signal-neutral mt-0.5" />
              {result.risk_factors.map((rf, i) => (
                <span key={i} className="text-[10px] bg-signal-neutral/10 text-signal-neutral px-2 py-0.5 rounded-full">
                  {rf}
                </span>
              ))}
            </div>
        )}
      </div>
      )}
      </TabsContent>
      </Tabs>
    </div>
  );
};

export default Counterfactual;
