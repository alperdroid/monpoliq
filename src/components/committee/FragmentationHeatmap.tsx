import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { type SentimentItem } from '@/lib/api/sentiment';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Grid3X3 } from 'lucide-react';

interface FragmentationHeatmapProps {
  allItems: SentimentItem[];
}

function extractSpeaker(title: string, source: string): string | null {
  const lowerSrc = source.toLowerCase();
  const lowerTitle = title.toLowerCase();
  
  // Skip non-speaker items
  const skipPatterns = ['minutes', 'statement', 'press release', 'bulletin', 'report', 'account', 'blog', 'monetary policy', 'fomc statement', 'sep ', 'projections', 'press conf'];
  if (skipPatterns.some(p => lowerSrc.includes(p) || lowerTitle.includes(p))) return null;

  // Fed Speech titles: "LastName, Title of Speech"
  if (lowerSrc.includes('speech')) {
    const commaMatch = title.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s/);
    if (commaMatch) return commaMatch[1].trim();
  }

  // fed_speech / ECB Speech: "remarks by Chair Powell" / "Speech by Christine Lagarde"
  const byMatch = title.match(/(?:remarks|speech|keynote|address|comments|testimony|interview|lecture)\s+by\s+(?:chair\s+|president\s+|governor\s+|vice[- ]president\s+|board\s+member\s+)?(\w+(?:\s\w+)?)/i);
  if (byMatch) {
    // Return last name only for consistency
    const parts = byMatch[1].trim().split(/\s+/);
    return parts[parts.length - 1];
  }

  // ECB speeches with "Name:" pattern
  const colonMatch = title.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*:/);
  if (colonMatch) return colonMatch[1].trim();

  return null;
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function formatMonth(key: string): string {
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

function scoreToColor(score: number | null): string {
  if (score === null) return 'hsl(var(--muted))';
  // Red (hawkish) → white (neutral) → blue (dovish)
  const clamped = Math.max(-1, Math.min(1, score * 3)); // amplify for visibility
  if (clamped > 0) {
    // Hawkish: towards red
    const intensity = Math.min(clamped, 1);
    return `hsl(var(--signal-hawkish) / ${0.15 + intensity * 0.65})`;
  } else if (clamped < 0) {
    // Dovish: towards blue/green
    const intensity = Math.min(Math.abs(clamped), 1);
    return `hsl(var(--signal-dovish) / ${0.15 + intensity * 0.65})`;
  }
  return 'hsl(var(--muted) / 0.3)';
}

export function FragmentationHeatmap({ allItems }: FragmentationHeatmapProps) {
  const [bankFilter, setBankFilter] = useState<'FED' | 'ECB'>('FED');
  const months = useMemo(() => getLastNMonths(6), []);

  const { speakers, matrix } = useMemo(() => {
    const comms = allItems.filter(i => i.bank === bankFilter && !i.is_statistical);
    
    // Group by speaker and month
    const speakerMonthScores: Record<string, Record<string, { sum: number; count: number }>> = {};
    const speakerOverall: Record<string, { sum: number; count: number }> = {};

    for (const item of comms) {
      const speaker = extractSpeaker(item.source);
      if (!speaker) continue;
      const monthKey = getMonthKey(item.item_date);
      if (!months.includes(monthKey)) continue;

      if (!speakerMonthScores[speaker]) speakerMonthScores[speaker] = {};
      if (!speakerMonthScores[speaker][monthKey]) speakerMonthScores[speaker][monthKey] = { sum: 0, count: 0 };
      speakerMonthScores[speaker][monthKey].sum += item.net_score;
      speakerMonthScores[speaker][monthKey].count += 1;

      if (!speakerOverall[speaker]) speakerOverall[speaker] = { sum: 0, count: 0 };
      speakerOverall[speaker].sum += item.net_score;
      speakerOverall[speaker].count += 1;
    }

    // Only include speakers with at least 2 items
    const validSpeakers = Object.entries(speakerOverall)
      .filter(([_, v]) => v.count >= 2)
      .sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count))
      .map(([name]) => name);

    const mat: Record<string, Record<string, { avg: number; count: number } | null>> = {};
    for (const sp of validSpeakers) {
      mat[sp] = {};
      for (const m of months) {
        const cell = speakerMonthScores[sp]?.[m];
        mat[sp][m] = cell ? { avg: cell.sum / cell.count, count: cell.count } : null;
      }
    }

    return { speakers: validSpeakers, matrix: mat };
  }, [allItems, bankFilter, months]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Consensus Fragmentation</h3>
        </div>
        <Select value={bankFilter} onValueChange={v => setBankFilter(v as 'FED' | 'ECB')}>
          <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Monthly average sentiment per speaker. Red = hawkish, green = dovish, gray = no data.
      </p>

      {speakers.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted-foreground">
          No speaker-level data available for {bankFilter}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="text-left p-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium sticky left-0 bg-card z-10 min-w-[120px]">
                  Speaker
                </th>
                {months.map(m => (
                  <th key={m} className="text-center p-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium min-w-[70px]">
                    {formatMonth(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {speakers.map(speaker => (
                <tr key={speaker} className="border-t border-border/50">
                  <td className="p-2 font-medium text-foreground sticky left-0 bg-card z-10 truncate max-w-[140px]">
                    {speaker}
                  </td>
                  {months.map(m => {
                    const cell = matrix[speaker]?.[m];
                    return (
                      <td key={m} className="p-1 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="w-full h-8 rounded-md flex items-center justify-center cursor-default transition-all hover:ring-1 hover:ring-primary/30"
                              style={{ backgroundColor: scoreToColor(cell?.avg ?? null) }}
                            >
                              {cell && (
                                <span className="text-[9px] font-mono font-semibold text-foreground/80">
                                  {cell.avg > 0 ? '+' : ''}{cell.avg.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs">
                            <p className="font-semibold">{speaker} — {formatMonth(m)}</p>
                            {cell ? (
                              <>
                                <p>Avg Score: {cell.avg > 0 ? '+' : ''}{cell.avg.toFixed(3)}</p>
                                <p>Items: {cell.count}</p>
                                <p className={cn(
                                  'font-semibold',
                                  cell.avg > 0.05 ? 'text-signal-hawkish' : cell.avg < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral'
                                )}>
                                  {cell.avg > 0.05 ? 'Hawkish' : cell.avg < -0.05 ? 'Dovish' : 'Neutral'}
                                </p>
                              </>
                            ) : (
                              <p className="text-muted-foreground">No data</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 justify-center text-[9px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded" style={{ backgroundColor: 'hsl(var(--signal-dovish) / 0.6)' }} />
          <span>Dovish</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded" style={{ backgroundColor: 'hsl(var(--muted) / 0.3)' }} />
          <span>Neutral</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded" style={{ backgroundColor: 'hsl(var(--signal-hawkish) / 0.6)' }} />
          <span>Hawkish</span>
        </div>
      </div>
    </div>
  );
}
