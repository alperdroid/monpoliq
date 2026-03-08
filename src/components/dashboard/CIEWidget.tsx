import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AIPredictionResponse } from '@/lib/api/predictions';
import type { SentimentItem } from '@/lib/api/sentiment';

interface CIEWidgetProps {
  allItems: SentimentItem[];
  aiPrediction: AIPredictionResponse | undefined;
  isPredictionLoading: boolean;
}

/**
 * Communication-Implied Expectation (CIE) Widget
 * 
 * Builds an internal "comms-implied" expectation from:
 *   1. 30-day comms sentiment average (hawk/dove score)
 *   2. Sentiment trend direction (7d vs 30d)
 *   3. AI prediction probabilities (derived from comms + macro)
 * 
 * Then compares implied committee lean vs AI model output
 * to surface "Comms vs Market" gap — a volatility risk alert.
 */
export function CIEWidget({ allItems, aiPrediction, isPredictionLoading }: CIEWidgetProps) {
  const analysis = useMemo(() => {
    if (!aiPrediction) return null;

    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const cs30 = d30.toISOString().split('T')[0];
    const cs7 = d7.toISOString().split('T')[0];

    const computeBank = (bank: string, pred: AIPredictionResponse['fed']) => {
      const comms = allItems.filter(i => i.bank === bank && !i.is_statistical);
      const comms30 = comms.filter(i => i.item_date >= cs30);
      const comms7 = comms.filter(i => i.item_date >= cs7);
      
      const scored30 = comms30.filter(i => Math.abs(i.net_score) > 0.001);
      const scored7 = comms7.filter(i => Math.abs(i.net_score) > 0.001);
      
      const avg30 = scored30.length > 0
        ? scored30.reduce((s, i) => s + i.net_score, 0) / scored30.length
        : 0;
      const avg7 = scored7.length > 0
        ? scored7.reduce((s, i) => s + i.net_score, 0) / scored7.length
        : 0;

      // CIE: communication-implied hawkishness on -1 to +1 scale
      const cie = avg30;
      
      // Trend: is committee getting more or less hawkish?
      const trend = avg7 - avg30;
      
      // Model expectation: convert probabilities to a -1 to +1 scale
      // hike = +1, hold = 0, cut = -1
      const modelImplied = pred.hike_probability * 1 + pred.hold_probability * 0 + pred.cut_probability * -1;
      
      // Gap: positive = market more hawkish than comms, negative = market more dovish
      const gap = modelImplied - cie;
      
      // Volatility risk level
      const absGap = Math.abs(gap);
      const riskLevel: 'low' | 'moderate' | 'high' = 
        absGap > 0.3 ? 'high' : absGap > 0.15 ? 'moderate' : 'low';
      
      // Direction description
      const gapDirection = gap > 0.05 
        ? 'Model more hawkish than comms' 
        : gap < -0.05 
          ? 'Comms more hawkish than model'
          : 'Aligned';

      return {
        cie: Math.round(cie * 1000) / 1000,
        modelImplied: Math.round(modelImplied * 1000) / 1000,
        gap: Math.round(gap * 1000) / 1000,
        trend: Math.round(trend * 1000) / 1000,
        riskLevel,
        gapDirection,
        commsCount: comms30.length,
      };
    };

    return {
      fed: computeBank('FED', aiPrediction.fed),
      ecb: computeBank('ECB', aiPrediction.ecb),
    };
  }, [allItems, aiPrediction]);

  if (isPredictionLoading || !analysis) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 animate-pulse">
        <div className="h-4 w-48 bg-muted rounded mb-3" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  const BankCIE = ({ bank, data }: { bank: string; data: NonNullable<typeof analysis>['fed'] }) => {
    const TrendIcon = data.trend > 0.02 ? TrendingUp : data.trend < -0.02 ? TrendingDown : Minus;
    
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">{bank}</span>
          <span className={cn(
            'text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full',
            data.riskLevel === 'high' && 'bg-destructive/15 text-destructive',
            data.riskLevel === 'moderate' && 'bg-signal-hawkish/15 text-signal-hawkish',
            data.riskLevel === 'low' && 'bg-data-positive/15 text-data-positive',
          )}>
            {data.riskLevel} vol risk
          </span>
        </div>
        
        {/* CIE vs Model bar visualization */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Comms Implied (CIE)</span>
            <span className={cn(
              'font-mono font-bold',
              data.cie > 0.05 ? 'text-signal-hawkish' : data.cie < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {data.cie > 0 ? '+' : ''}{data.cie.toFixed(3)}
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-px h-full bg-muted-foreground/30" />
            </div>
            <div
              className={cn(
                'h-full rounded-full transition-all absolute top-0',
                data.cie >= 0 ? 'bg-signal-hawkish left-1/2' : 'bg-signal-dovish right-1/2',
              )}
              style={{
                width: `${Math.min(Math.abs(data.cie) * 50, 50)}%`,
                ...(data.cie < 0 ? { right: '50%' } : { left: '50%' }),
              }}
            />
          </div>
          
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Model Implied</span>
            <span className={cn(
              'font-mono font-bold',
              data.modelImplied > 0.05 ? 'text-signal-hawkish' : data.modelImplied < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {data.modelImplied > 0 ? '+' : ''}{data.modelImplied.toFixed(3)}
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-px h-full bg-muted-foreground/30" />
            </div>
            <div
              className={cn(
                'h-full rounded-full transition-all absolute top-0',
                data.modelImplied >= 0 ? 'bg-primary left-1/2' : 'bg-prediction right-1/2',
              )}
              style={{
                width: `${Math.min(Math.abs(data.modelImplied) * 50, 50)}%`,
                ...(data.modelImplied < 0 ? { right: '50%' } : { left: '50%' }),
              }}
            />
          </div>
        </div>

        {/* Gap alert */}
        <div className={cn(
          'rounded-md p-2 flex items-center gap-2',
          data.riskLevel === 'high' && 'bg-destructive/10 border border-destructive/20',
          data.riskLevel === 'moderate' && 'bg-signal-hawkish/10 border border-signal-hawkish/20',
          data.riskLevel === 'low' && 'bg-muted/50 border border-border',
        )}>
          {data.riskLevel === 'high' && <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />}
          {data.riskLevel === 'moderate' && <Activity className="w-3.5 h-3.5 text-signal-hawkish flex-shrink-0" />}
          <div className="flex-1">
            <p className="text-[10px] font-medium text-foreground">{data.gapDirection}</p>
            <p className="text-[9px] text-muted-foreground">
              Gap: {data.gap > 0 ? '+' : ''}{data.gap.toFixed(3)} · 
              7d trend: <TrendIcon className="w-3 h-3 inline" /> {data.trend > 0 ? '+' : ''}{data.trend.toFixed(3)} · 
              {data.commsCount} comms
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-primary">
            Comms vs Model Gap
          </span>
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">Communication-Implied Expectation</span>
      </div>
      
      <div className="grid md:grid-cols-2 gap-4">
        <BankCIE bank="FED" data={analysis.fed} />
        <BankCIE bank="ECB" data={analysis.ecb} />
      </div>
    </div>
  );
}
