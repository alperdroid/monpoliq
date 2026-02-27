import { cn } from '@/lib/utils';

interface StanceGaugeProps {
  value: number; // -1 (very dovish) to 1 (very hawkish)
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  className?: string;
}

export function StanceGauge({ value, label, size = 'md', showLabels = true, className }: StanceGaugeProps) {
  const pct = ((value + 1) / 2) * 100; // 0-100

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>}
      <div className="relative">
        <div className={cn(
          'w-full rounded-full bg-secondary overflow-hidden',
          size === 'sm' && 'h-2',
          size === 'md' && 'h-3',
          size === 'lg' && 'h-4',
        )}>
          <div
            className="absolute top-0 left-1/2 w-px h-full bg-muted-foreground/30"
          />
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              value > 0.3 ? 'bg-signal-hawkish' :
              value > 0 ? 'bg-signal-neutral' :
              value > -0.3 ? 'bg-signal-neutral' :
              'bg-signal-dovish',
            )}
            style={{
              width: `${pct}%`,
              marginLeft: pct < 50 ? 0 : undefined,
            }}
          />
          {/* Marker */}
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-background',
              size === 'sm' && 'w-3 h-3',
              size === 'md' && 'w-4 h-4',
              size === 'lg' && 'w-5 h-5',
              value > 0.3 ? 'bg-signal-hawkish' :
              value > -0.3 ? 'bg-signal-neutral' :
              'bg-signal-dovish',
            )}
            style={{ left: `${pct}%` }}
          />
        </div>
        {showLabels && (
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-signal-dovish font-medium">DOVISH</span>
            <span className="text-[9px] text-muted-foreground">NEUTRAL</span>
            <span className="text-[9px] text-signal-hawkish font-medium">HAWKISH</span>
          </div>
        )}
      </div>
      <p className={cn(
        'text-sm font-mono font-semibold text-center',
        value > 0.3 ? 'text-signal-hawkish' :
        value > -0.3 ? 'text-signal-neutral' :
        'text-signal-dovish',
      )}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}
      </p>
    </div>
  );
}
