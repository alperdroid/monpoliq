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
      'rounded-xl border p-3 transition-all',
      variant === 'default' && 'bg-card border-border shadow-sm',
      variant === 'primary' && 'bg-card border-primary/20 shadow-sm shadow-primary/5',
      variant === 'signal' && 'bg-card border-border shadow-sm',
      variant === 'prediction' && 'bg-card border-prediction/20 shadow-sm shadow-prediction/5',
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
