import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Activity, TrendingUp, TrendingDown, Minus, MessageSquare, BarChart3, Layers } from 'lucide-react';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import type { AIPredictionResponse } from '@/lib/api/predictions';
import type { SentimentItem } from '@/lib/api/sentiment';

interface CIEWidgetProps {
  allItems: SentimentItem[];
  aiPrediction: AIPredictionResponse | undefined;
  isPredictionLoading: boolean;
}

export function CIEWidget({ allItems, aiPrediction, isPredictionLoading }: CIEWidgetProps) {
  const analysis = useMemo(() => {
    if (!aiPrediction) return null;

    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const cs30 = d30.toISOString().split('T')[0];
    const cs7 = d7.toISOString().split('T')[0];

    const computeBank = (bank: string, pred: AIPredictionResponse['fed']) => {
      const bankItems = allItems.filter(i => i.bank === bank);
      const comms = bankItems.filter(i => !i.is_statistical);
      const stats = bankItems.filter(i => i.is_statistical);

      const comms30 = comms.filter(i => i.item_date >= cs30);
      const comms7 = comms.filter(i => i.item_date >= cs7);
      const stats30 = stats.filter(i => i.item_date >= cs30);
      const all30 = bankItems.filter(i => i.item_date >= cs30);

      const avgOf = (arr: SentimentItem[]) => {
        const scored = arr.filter(i => Math.abs(i.net_score) > 0.001);
        return scored.length > 0
          ? scored.reduce((s, i) => s + i.net_score, 0) / scored.length
          : 0;
      };

      const commsAvg30 = avgOf(comms30);
      const commsAvg7 = avgOf(comms7);
      const statsAvg30 = avgOf(stats30);
      const combinedAvg30 = avgOf(all30);

      const cie = commsAvg30;
      const trend = commsAvg7 - commsAvg30;
      const modelImplied = pred.hike_probability * 1 + pred.hold_probability * 0 + pred.cut_probability * -1;
      const gap = modelImplied - cie;
      const absGap = Math.abs(gap);
      const riskLevel: 'low' | 'moderate' | 'high' =
        absGap > 0.3 ? 'high' : absGap > 0.15 ? 'moderate' : 'low';
      const gapDirection = gap > 0.05
        ? 'Model more hawkish than comms'
        : gap < -0.05
          ? 'Comms more hawkish than model'
          : 'Aligned';

      return {
        cie: Math.round(cie * 1000) / 1000,
        statsImplied: Math.round(statsAvg30 * 1000) / 1000,
        combined: Math.round(combinedAvg30 * 1000) / 1000,
        modelImplied: Math.round(modelImplied * 1000) / 1000,
        gap: Math.round(gap * 1000) / 1000,
        trend: Math.round(trend * 1000) / 1000,
        riskLevel,
        gapDirection,
        commsCount: comms30.length,
        statsCount: stats30.length,
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

  const ScoreBar = ({ value, colorPos, colorNeg }: { value: number; colorPos: string; colorNeg: string }) => (
    <div className="h-1.5 bg-muted rounded-full overflow-hidden relative">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-px h-full bg-muted-foreground/20" />
      </div>
      <div
        className={cn('h-full rounded-full transition-all absolute top-0', value >= 0 ? colorPos : colorNeg)}
        style={{
          width: `${Math.min(Math.abs(value) * 50, 50)}%`,
          ...(value < 0 ? { right: '50%' } : { left: '50%' }),
        }}
      />
    </div>
  );

  const SignalRow = ({
    icon: Icon,
    label,
    value,
    count,
    colorPos,
    colorNeg,
  }: {
    icon: React.ElementType;
    label: string;
    value: number;
    count?: number;
    colorPos: string;
    colorNeg: string;
  }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3 h-3 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground">{label}</span>
          {count !== undefined && (
            <span className="text-[8px] text-muted-foreground/60">({count})</span>
          )}
        </div>
        <span className={cn(
          'text-[10px] font-mono font-bold',
          value > 0.05 ? 'text-signal-hawkish' : value < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
        )}>
          {value > 0 ? '+' : ''}{value.toFixed(3)}
        </span>
      </div>
      <ScoreBar value={value} colorPos={colorPos} colorNeg={colorNeg} />
    </div>
  );

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

        {/* Signal Decomposition */}
        <div className="space-y-2.5 rounded-lg border border-border/50 bg-muted/20 p-2.5">
          <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-medium">Underlying Signals (30d avg)</span>

          <SignalRow
            icon={MessageSquare}
            label="Comms-Only"
            value={data.cie}
            count={data.commsCount}
            colorPos="bg-signal-hawkish"
            colorNeg="bg-signal-dovish"
          />

          <SignalRow
            icon={BarChart3}
            label="Stats-Only"
            value={data.statsImplied}
            count={data.statsCount}
            colorPos="bg-signal-hawkish"
            colorNeg="bg-signal-dovish"
          />

          <div className="border-t border-border/30 pt-2">
            <SignalRow
              icon={Layers}
              label="Combined"
              value={data.combined}
              count={data.commsCount + data.statsCount}
              colorPos="bg-primary"
              colorNeg="bg-prediction"
            />
          </div>
        </div>

        {/* Model Implied */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground font-medium">Model Implied (AI)</span>
            <span className={cn(
              'text-[10px] font-mono font-bold',
              data.modelImplied > 0.05 ? 'text-signal-hawkish' : data.modelImplied < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral',
            )}>
              {data.modelImplied > 0 ? '+' : ''}{data.modelImplied.toFixed(3)}
            </span>
          </div>
          <ScoreBar value={data.modelImplied} colorPos="bg-primary" colorNeg="bg-prediction" />
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
              {data.commsCount + data.statsCount} signals
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
          <TooltipInfo content="Decomposes sentiment into comms-only (speeches, minutes), stats-only (economic data), and combined averages. The 'Model Implied' score is derived from AI prediction probabilities (hike×1 + hold×0 + cut×−1). Large gaps flag volatility risk." />
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">CIE · 30d window</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <BankCIE bank="FED" data={analysis.fed} />
        <BankCIE bank="ECB" data={analysis.ecb} />
      </div>
    </div>
  );
}
