import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/analytics/MetricCard';
import { StanceGauge } from '@/components/analytics/StanceGauge';
import { BankPanel } from '@/components/dashboard/BankPanel';
import { PredictionPanel } from '@/components/dashboard/PredictionPanel';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import {
  fedSummary, ecbSummary, fedPrediction, ecbPrediction, eurusdPrediction,
  officialToneHistory, divergenceHistory, communicationVolumeHistory,
} from '@/data/mock-data';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ReferenceLine,
} from 'recharts';

const Dashboard = () => {
  const fedToneData = officialToneHistory.filter(d => d.label === 'FED');
  const ecbToneData = officialToneHistory.filter(d => d.label === 'ECB');

  const combinedTone = fedToneData.map((f, i) => ({
    date: f.date,
    fed: f.value,
    ecb: ecbToneData[i]?.value ?? 0,
  }));

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Executive Summary Bar */}
      <div className="rounded-lg border border-primary/20 bg-card p-4 glow-primary">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Executive Summary</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">Current Regime Signal</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard label="Fed Stance" value={fedSummary.official_stance > 0 ? '+' + fedSummary.official_stance.toFixed(2) : fedSummary.official_stance.toFixed(2)} sublabel="Sl. Hawkish" variant="primary" />
          <MetricCard label="ECB Stance" value={ecbSummary.official_stance > 0 ? '+' + ecbSummary.official_stance.toFixed(2) : ecbSummary.official_stance.toFixed(2)} sublabel="Sl. Dovish" variant="primary" />
          <MetricCard label="Regime" value="Divergent" sublabel="FED hawk / ECB dove" />
          <MetricCard label="Fed Next" value={fedPrediction.next_decision.toUpperCase()} sublabel={`${(fedPrediction.hold_probability * 100).toFixed(0)}% prob`} variant="prediction" />
          <MetricCard label="ECB Next" value={ecbPrediction.next_decision.toUpperCase()} sublabel={`${(ecbPrediction.cut_probability * 100).toFixed(0)}% prob`} variant="prediction" />
          <MetricCard label="EUR/USD" value={eurusdPrediction.direction.toUpperCase()} sublabel={`${(eurusdPrediction.signal_strength * 100).toFixed(0)}% signal`} variant="prediction" />
          <MetricCard label="Comm. Volume" value="25" sublabel="30d events" trend="up" trendValue="+25%" />
        </div>
      </div>

      {/* Bank Panels */}
      <div className="grid lg:grid-cols-2 gap-4">
        <BankPanel summary={fedSummary} />
        <BankPanel summary={ecbSummary} />
      </div>

      {/* Prediction Section */}
      <PredictionPanel
        fedPrediction={fedPrediction}
        ecbPrediction={ecbPrediction}
        currencyPrediction={eurusdPrediction}
      />

      {/* Communication Intelligence */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Communication Intelligence</h3>
          <SignalBadge label="Fed" variant="info" size="sm" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="Official Stance" value={`+${fedSummary.official_stance.toFixed(2)}`} />
          <MetricCard label="Member Weighted" value={`+${fedSummary.member_weighted_signal.toFixed(2)}`} />
          <MetricCard label="Divergence" value={fedSummary.divergence.toFixed(2)} trend={fedSummary.divergence > 0.15 ? 'up' : 'flat'} trendValue="rising" />
          <MetricCard label="7d Pressure" value={`${(fedSummary.communication_pressure_7d * 100).toFixed(0)}%`} trend="up" trendValue="active" />
          <MetricCard label="30d Pressure" value={`${(fedSummary.communication_pressure_30d * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Official Tone Over Time */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Official Tone Over Time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={combinedTone}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[-0.5, 0.6]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
              <Line type="monotone" dataKey="fed" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="FED" />
              <Line type="monotone" dataKey="ecb" stroke="hsl(var(--prediction))" strokeWidth={2} dot={{ r: 3 }} name="ECB" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Divergence Over Time */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Fed: Official vs Member Stance</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={divergenceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              />
              <Area type="monotone" dataKey="official" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.1)" strokeWidth={2} name="Official" />
              <Area type="monotone" dataKey="member_weighted" stroke="hsl(var(--signal-neutral))" fill="hsl(var(--signal-neutral) / 0.1)" strokeWidth={2} name="Members" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Communication Volume */}
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4">Communication Volume</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={communicationVolumeHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Events" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
