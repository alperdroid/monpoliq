import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

interface ExpandableTitleProps {
  title: string;
  maxWidth?: string;
}

export function ExpandableTitle({ title, maxWidth = 'max-w-[300px]' }: ExpandableTitleProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn('flex items-start gap-1 cursor-pointer group', !expanded && maxWidth)}
      onClick={() => setExpanded(!expanded)}
    >
      <span
        className={cn('font-medium select-text', !expanded && 'truncate')}
        title={!expanded ? title : undefined}
      >
        {title}
      </span>
      <ChevronDown className={cn(
        'w-3 h-3 mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all',
        expanded && 'rotate-180 opacity-100',
      )} />
    </div>
  );
}
