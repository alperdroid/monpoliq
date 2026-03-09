import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TooltipInfoProps {
  content: string;
  className?: string;
}

export function TooltipInfo({ content, className }: TooltipInfoProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className={`w-3 h-3 text-muted-foreground hover:text-foreground cursor-help ${className}`} />
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs text-xs">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}