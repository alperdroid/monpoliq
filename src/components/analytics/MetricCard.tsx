import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  variant?: 'default' | 'primary' | 'signal' | 'prediction';
  className?: string;
}

export function MetricCard({ label, value, sublabel, trend, trendValue, variant = 'default', className }: MetricCardProps) {
  return (
    <div className={cn(
      'rounded-lg border p-3 transition-colors',
      variant === 'default' && 'bg-card border-border',
      variant === 'primary' && 'bg-card border-primary/30 glow-primary',
      variant === 'signal' && 'bg-card border-border',
      variant === 'prediction' && 'bg-card border-prediction/30',
      className,
    )}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={cn(
        'text-xl font-semibold font-mono mt-1',
        variant === 'primary' && 'text-primary',
        variant === 'prediction' && 'text-prediction',
      )}>{value}</p>
      <div className="flex items-center gap-1.5 mt-1">
        {trend && (
          <span className={cn(
            'text-xs font-mono font-medium',
            trend === 'up' && 'text-data-positive',
            trend === 'down' && 'text-data-negative',
            trend === 'flat' && 'text-data-neutral',
          )}>
            {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'} {trendValue}
          </span>
        )}
        {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );
}
