import { cn } from '@/lib/utils';

interface ProbabilityBarProps {
  label: string;
  probabilities: { label: string; value: number; color: 'hawkish' | 'neutral' | 'dovish' | 'primary' }[];
  className?: string;
}

export function ProbabilityBar({ label, probabilities, className }: ProbabilityBarProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <div className="flex h-6 rounded overflow-hidden">
        {probabilities.map((p, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-center text-[10px] font-mono font-semibold transition-all duration-500',
              p.color === 'hawkish' && 'bg-signal-hawkish text-signal-hawkish/[.01]',
              p.color === 'neutral' && 'bg-signal-neutral text-signal-neutral/[.01]',
              p.color === 'dovish' && 'bg-signal-dovish text-signal-dovish/[.01]',
              p.color === 'primary' && 'bg-primary text-primary-foreground',
            )}
            style={{ width: `${p.value * 100}%` }}
          >
            <span className={cn(
              p.value > 0.15 ? 'opacity-100' : 'opacity-0',
              p.color === 'hawkish' && 'text-signal-hawkish-fg',
              p.color === 'neutral' && 'text-signal-neutral-fg',
              p.color === 'dovish' && 'text-signal-dovish-fg',
              p.color === 'primary' && 'text-primary-foreground',
            )}>
              {(p.value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {probabilities.map((p, i) => (
          <span key={i} className="font-medium">{p.label}</span>
        ))}
      </div>
    </div>
  );
}
