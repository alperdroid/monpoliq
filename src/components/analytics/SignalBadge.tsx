import { cn } from '@/lib/utils';

interface SignalBadgeProps {
  label: string;
  variant?: 'hawkish' | 'dovish' | 'neutral' | 'hold' | 'hike' | 'cut' | 'bullish' | 'bearish' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles: Record<string, string> = {
  hawkish: 'bg-signal-hawkish/15 text-signal-hawkish border-signal-hawkish/25',
  dovish: 'bg-signal-dovish/15 text-signal-dovish border-signal-dovish/25',
  neutral: 'bg-signal-neutral/15 text-signal-neutral border-signal-neutral/25',
  hold: 'bg-signal-neutral/15 text-signal-neutral border-signal-neutral/25',
  hike: 'bg-signal-hawkish/15 text-signal-hawkish border-signal-hawkish/25',
  cut: 'bg-signal-dovish/15 text-signal-dovish border-signal-dovish/25',
  bullish: 'bg-signal-dovish/15 text-signal-dovish border-signal-dovish/25',
  bearish: 'bg-signal-hawkish/15 text-signal-hawkish border-signal-hawkish/25',
  info: 'bg-primary/10 text-primary border-primary/20',
};

export function SignalBadge({ label, variant = 'neutral', size = 'sm', className }: SignalBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded border font-medium uppercase tracking-wider',
      size === 'sm' && 'px-1.5 py-0.5 text-[9px]',
      size === 'md' && 'px-2 py-1 text-[10px]',
      variantStyles[variant],
      className,
    )}>
      {label}
    </span>
  );
}
