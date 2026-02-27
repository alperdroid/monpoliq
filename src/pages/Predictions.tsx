import { PredictionPanel } from '@/components/dashboard/PredictionPanel';
import { MetricCard } from '@/components/analytics/MetricCard';
import { fedPrediction, ecbPrediction, eurusdPrediction, fedSummary, ecbSummary } from '@/data/mock-data';
import { StanceGauge } from '@/components/analytics/StanceGauge';

const Predictions = () => {
  return (
    <div className="space-y-6 animate-slide-in max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">Predictions</h1>
        <p className="text-xs text-muted-foreground mt-1">Communication-implied outlook from the model</p>
      </div>

      <PredictionPanel
        fedPrediction={fedPrediction}
        ecbPrediction={ecbPrediction}
        currencyPrediction={eurusdPrediction}
      />

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">Underlying Communication Signals</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-primary">Federal Reserve</p>
            <StanceGauge value={fedSummary.official_stance} label="Official Stance" />
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Guidance" value={`${(fedSummary.guidance_strength * 100).toFixed(0)}%`} />
              <MetricCard label="Uncertainty" value={`${(fedSummary.uncertainty * 100).toFixed(0)}%`} />
              <MetricCard label="Divergence" value={fedSummary.divergence.toFixed(2)} />
              <MetricCard label="Chatter" value={fedSummary.recent_chatter_count} sublabel="30d events" />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium text-prediction">European Central Bank</p>
            <StanceGauge value={ecbSummary.official_stance} label="Official Stance" />
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Guidance" value={`${(ecbSummary.guidance_strength * 100).toFixed(0)}%`} />
              <MetricCard label="Uncertainty" value={`${(ecbSummary.uncertainty * 100).toFixed(0)}%`} />
              <MetricCard label="Divergence" value={ecbSummary.divergence.toFixed(2)} />
              <MetricCard label="Chatter" value={ecbSummary.recent_chatter_count} sublabel="30d events" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Predictions;
