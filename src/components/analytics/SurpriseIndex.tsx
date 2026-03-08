import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';
import type { SentimentItem } from '@/lib/api/sentiment';

interface SurpriseAlert {
  title: string;
  date: string;
  bank: string;
  score: number;
  speakerBaseline: number;
  committeeBaseline: number;
  surpriseVsSpeaker: number;
  surpriseVsCommittee: number;
  totalSurprise: number;
}

const SPEAKER_PATTERNS = [
  { name: 'Powell', patterns: ['powell'] },
  { name: 'Waller', patterns: ['waller'] },
  { name: 'Bowman', patterns: ['bowman'] },
  { name: 'Williams', patterns: ['williams'] },
  { name: 'Cook', patterns: ['cook'] },
  { name: 'Kugler', patterns: ['kugler'] },
  { name: 'Jefferson', patterns: ['jefferson'] },
  { name: 'Lagarde', patterns: ['lagarde'] },
  { name: 'Schnabel', patterns: ['schnabel'] },
  { name: 'Cipollone', patterns: ['cipollone'] },
  { name: 'Lane', patterns: ['lane'] },
  { name: 'Guindos', patterns: ['guindos'] },
  { name: 'Elderson', patterns: ['elderson'] },
];

function findSpeaker(title: string): string {
  const tl = title.toLowerCase();
  return SPEAKER_PATTERNS.find(s => s.patterns.some(p => tl.includes(p)))?.name || 'Unknown';
}

interface SurpriseIndexProps {
  allItems: SentimentItem[];
}

export function SurpriseIndex({ allItems }: SurpriseIndexProps) {
  const surprises = useMemo(() => {
    const comms = allItems.filter(i => !i.is_statistical && Math.abs(i.net_score) > 0.001);
    if (comms.length < 5) return [];

    // Compute speaker baselines
    const speakerScores: Record<string, number[]> = {};
    for (const item of comms) {
      const speaker = findSpeaker(item.title);
      if (!speakerScores[speaker]) speakerScores[speaker] = [];
      speakerScores[speaker].push(item.net_score);
    }
    const speakerAvg: Record<string, number> = {};
    for (const [s, scores] of Object.entries(speakerScores)) {
      speakerAvg[s] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    // Committee baselines per bank
    const bankScores: Record<string, number[]> = {};
    for (const item of comms) {
      if (!bankScores[item.bank]) bankScores[item.bank] = [];
      bankScores[item.bank].push(item.net_score);
    }
    const bankAvg: Record<string, number> = {};
    const bankStd: Record<string, number> = {};
    for (const [b, scores] of Object.entries(bankScores)) {
      const mean = scores.reduce((a, v) => a + v, 0) / scores.length;
      bankAvg[b] = mean;
      bankStd[b] = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length) || 0.1;
    }

    // Compute surprise for recent items (30 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cs = cutoff.toISOString().split('T')[0];
    const recent = comms.filter(i => i.item_date >= cs);

    const alerts: SurpriseAlert[] = recent.map(item => {
      const speaker = findSpeaker(item.title);
      const spAvg = speakerAvg[speaker] || 0;
      const bAvg = bankAvg[item.bank] || 0;
      const bStd = bankStd[item.bank] || 0.1;

      const surpriseVsSpeaker = Math.abs(item.net_score - spAvg) / Math.max(bStd, 0.05);
      const surpriseVsCommittee = Math.abs(item.net_score - bAvg) / Math.max(bStd, 0.05);

      return {
        title: item.title,
        date: item.item_date,
        bank: item.bank,
        score: item.net_score,
        speakerBaseline: spAvg,
        committeeBaseline: bAvg,
        surpriseVsSpeaker,
        surpriseVsCommittee,
        totalSurprise: (surpriseVsSpeaker + surpriseVsCommittee) / 2,
      };
    });

    return alerts
      .filter(a => a.totalSurprise > 0.8)
      .sort((a, b) => b.totalSurprise - a.totalSurprise)
      .slice(0, 5);
  }, [allItems]);

  if (surprises.length === 0) return null;

  return (
    <div className="rounded-xl border border-signal-neutral/20 bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-signal-neutral" />
        <h3 className="text-sm font-semibold">Communication Surprise Index</h3>
        <span className="text-[9px] text-muted-foreground ml-auto">30-day window • z-score relative</span>
      </div>
      <div className="space-y-2">
        {surprises.map((s, i) => (
          <div key={i} className="flex items-start gap-3 p-2 rounded-md bg-surface">
            <div className={cn(
              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold',
              s.totalSurprise > 2 ? 'bg-signal-hawkish/15 text-signal-hawkish' :
              s.totalSurprise > 1.5 ? 'bg-signal-neutral/15 text-signal-neutral' :
              'bg-muted text-muted-foreground'
            )}>
              {s.totalSurprise.toFixed(1)}σ
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium truncate">{s.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] font-mono text-muted-foreground">{s.bank}</span>
                <span className="text-[9px] font-mono text-muted-foreground">{s.date}</span>
                <span className={cn('text-[9px] font-mono', s.score > 0 ? 'text-signal-hawkish' : 'text-signal-dovish')}>
                  {s.score > 0 ? '+' : ''}{s.score.toFixed(3)}
                </span>
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-[9px] text-muted-foreground">
                  vs Speaker: <span className="font-mono font-medium">{s.surpriseVsSpeaker.toFixed(1)}σ</span>
                </span>
                <span className="text-[9px] text-muted-foreground">
                  vs Committee: <span className="font-mono font-medium">{s.surpriseVsCommittee.toFixed(1)}σ</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
