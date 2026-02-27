import { cn } from '@/lib/utils';

interface TrendChipProps {
  label: string;
  value: number | string;
  direction?: 'up' | 'down' | 'flat';
  variant?: 'default' | 'hawkish' | 'dovish' | 'neutral';
  className?: string;
}

export function TrendChip({ label, value, direction, variant = 'default', className }: TrendChipProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium border',
      variant === 'default' && 'bg-secondary text-secondary-foreground border-border',
      variant === 'hawkish' && 'bg-signal-hawkish/10 text-signal-hawkish border-signal-hawkish/20',
      variant === 'dovish' && 'bg-signal-dovish/10 text-signal-dovish border-signal-dovish/20',
      variant === 'neutral' && 'bg-signal-neutral/10 text-signal-neutral border-signal-neutral/20',
      className,
    )}>
      {direction === 'up' && '▲'}
      {direction === 'down' && '▼'}
      {direction === 'flat' && '—'}
      {label}: {value}
    </span>
  );
}
