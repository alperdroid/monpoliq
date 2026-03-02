import { cn } from '@/lib/utils';

interface MonPolLogoProps {
  collapsed?: boolean;
  className?: string;
}

export function MonPolLogo({ collapsed = false, className }: MonPolLogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {/* Abstract M icon: signal wave merging into rate curve */}
      <div className="w-8 h-8 flex-shrink-0">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <rect width="32" height="32" rx="7" className="fill-primary" />
          <path
            d="M7 22 C9 14, 11 20, 13 12 C15 18, 17 10, 19 16 C21 12, 23 8, 25 10"
            className="stroke-primary-foreground"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="25" cy="10" r="2" className="fill-primary-foreground" opacity="0.85" />
        </svg>
      </div>
      {!collapsed && (
        <div className="min-w-0 flex items-baseline gap-1">
          <span className="text-sm font-bold tracking-tight text-sidebar-accent-foreground">MonPol</span>
          <span className="text-sm font-light tracking-widest text-sidebar-primary">IQ</span>
        </div>
      )}
    </div>
  );
}
