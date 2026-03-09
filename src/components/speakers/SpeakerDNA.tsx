import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Dna } from 'lucide-react';
import type { SentimentItem } from '@/lib/api/sentiment';

interface DNAProfile {
  name: string;
  bank: string;
  inflationFocus: number;     // 0-1
  guidanceCommitment: number; // 0-1
  volatilityScore: number;    // 0-1 (std dev of scores normalized)
  contradictionRate: number;  // 0-1
  avgTone: number;
  totalComms: number;
  // Drift: compare first half vs second half
  toneDrift: number;
  inflationDrift: number;
}

const SPEAKERS = [
  { name: 'Powell', patterns: ['powell'], bank: 'FED' },
  { name: 'Waller', patterns: ['waller'], bank: 'FED' },
  { name: 'Bowman', patterns: ['bowman'], bank: 'FED' },
  { name: 'Williams', patterns: ['williams'], bank: 'FED' },
  { name: 'Cook', patterns: ['cook'], bank: 'FED' },
  { name: 'Kugler', patterns: ['kugler'], bank: 'FED' },
  { name: 'Jefferson', patterns: ['jefferson'], bank: 'FED' },
  { name: 'Lagarde', patterns: ['lagarde'], bank: 'ECB' },
  { name: 'Schnabel', patterns: ['schnabel'], bank: 'ECB' },
  { name: 'Cipollone', patterns: ['cipollone'], bank: 'ECB' },
  { name: 'Lane', patterns: ['lane'], bank: 'ECB' },
  { name: 'Guindos', patterns: ['guindos'], bank: 'ECB' },
  { name: 'Elderson', patterns: ['elderson'], bank: 'ECB' },
];

function computeDNA(items: SentimentItem[]): DNAProfile[] {
  const comms = items.filter(i => !i.is_statistical);

  return SPEAKERS.map(sp => {
    const matched = comms
      .filter(i => i.bank === sp.bank && sp.patterns.some(p => i.title.toLowerCase().includes(p)))
      .sort((a, b) => a.item_date.localeCompare(b.item_date));

    if (matched.length < 2) return null;

    const scores = matched.map(i => i.net_score);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const std = Math.sqrt(scores.reduce((s, v) => s + (v - avg) ** 2, 0) / scores.length);

    // Inflation focus: check topics and reasons for inflation mentions
    let inflationMentions = 0;
    for (const item of matched) {
      const topics = (item as any).topics || [];
      const reasons = item.reasons || [];
      const text = [...topics, ...reasons].join(' ').toLowerCase();
      if (text.includes('inflation') || text.includes('price') || text.includes('cpi')) {
        inflationMentions++;
      }
    }
    const inflationFocus = inflationMentions / matched.length;

    // Guidance commitment: check policy_dimensions
    let guidanceCount = 0;
    for (const item of matched) {
      const dims = (item as any).policy_dimensions;
      if (dims && (dims.forward_guidance === 'firm' || dims.forward_guidance === 'explicit')) {
        guidanceCount++;
      }
    }
    const guidanceCommitment = matched.filter(i => (i as any).policy_dimensions).length > 0
      ? guidanceCount / matched.filter(i => (i as any).policy_dimensions).length
      : 0.5;

    // Contradiction rate: how often sign flips from prev
    let flips = 0;
    for (let i = 1; i < scores.length; i++) {
      if (Math.sign(scores[i]) !== Math.sign(scores[i - 1]) && Math.abs(scores[i]) > 0.01 && Math.abs(scores[i - 1]) > 0.01) {
        flips++;
      }
    }
    const contradictionRate = scores.length > 1 ? flips / (scores.length - 1) : 0;

    // Drift: first half vs second half
    const mid = Math.floor(scores.length / 2);
    const firstHalf = scores.slice(0, mid);
    const secondHalf = scores.slice(mid);
    const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const toneDrift = secondAvg - firstAvg;

    // Inflation drift
    let firstInflation = 0, secondInflation = 0;
    for (let i = 0; i < matched.length; i++) {
      const topics = ((matched[i] as any).topics || []);
      const reasons = matched[i].reasons || [];
      const hasInflation = [...topics, ...reasons].join(' ').toLowerCase().includes('inflation');
      if (i < mid && hasInflation) firstInflation++;
      if (i >= mid && hasInflation) secondInflation++;
    }
    const inflationDrift = (secondInflation / Math.max(secondHalf.length, 1)) - (firstInflation / Math.max(firstHalf.length, 1));

    // Normalize volatility to 0-1 range (cap at 0.5 std)
    const volatilityScore = Math.min(std / 0.5, 1);

    return {
      name: sp.name,
      bank: sp.bank,
      inflationFocus: Math.round(inflationFocus * 100) / 100,
      guidanceCommitment: Math.round(guidanceCommitment * 100) / 100,
      volatilityScore: Math.round(volatilityScore * 100) / 100,
      contradictionRate: Math.round(contradictionRate * 100) / 100,
      avgTone: Math.round(avg * 1000) / 1000,
      totalComms: matched.length,
      toneDrift: Math.round(toneDrift * 1000) / 1000,
      inflationDrift: Math.round(inflationDrift * 100) / 100,
    };
  }).filter(Boolean) as DNAProfile[];
}

function DNABar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-[9px] text-muted-foreground">{label}</span>
        <span className="text-[9px] font-mono text-muted-foreground">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

interface SpeakerDNAProps {
  allItems: SentimentItem[];
  bankFilter?: string;
}

export function SpeakerDNAPanel({ allItems, bankFilter }: SpeakerDNAProps) {
  const profiles = useMemo(() => {
    const all = computeDNA(allItems);
    return bankFilter && bankFilter !== 'all' ? all.filter(p => p.bank === bankFilter) : all;
  }, [allItems, bankFilter]);

  if (profiles.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Dna className="w-4 h-4 text-prediction" />
        <h3 className="text-sm font-semibold">Speaker DNA Profiles</h3>
        <TooltipInfo content="Real-time behavioral analysis of individual central bank officials. Tracks inflation focus, guidance commitment, volatility, and ideological drift using historical communication patterns." />
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {profiles.map(p => (
          <div key={p.name} className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{p.name}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-muted-foreground">{p.bank}</span>
                <span className={cn(
                  'text-[9px] font-mono',
                  p.avgTone > 0.05 ? 'text-signal-hawkish' : p.avgTone < -0.05 ? 'text-signal-dovish' : 'text-signal-neutral'
                )}>
                  {p.avgTone > 0 ? '+' : ''}{p.avgTone.toFixed(3)}
                </span>
              </div>
            </div>

            <DNABar label="Inflation Focus" value={p.inflationFocus} color="bg-signal-hawkish" />
            <DNABar label="Guidance Commitment" value={p.guidanceCommitment} color="bg-primary" />
            <DNABar label="Volatility" value={p.volatilityScore} color="bg-signal-neutral" />
            <DNABar label="Contradiction Rate" value={p.contradictionRate} color="bg-destructive" />

            {/* Drift indicators */}
            <div className="flex gap-3 pt-1 border-t border-border">
              <div>
                <span className="text-[9px] text-muted-foreground">Tone Drift</span>
                <p className={cn('text-[10px] font-mono font-medium',
                  p.toneDrift > 0.02 ? 'text-signal-hawkish' : p.toneDrift < -0.02 ? 'text-signal-dovish' : 'text-muted-foreground'
                )}>
                  {p.toneDrift > 0 ? '↑' : p.toneDrift < -0.02 ? '↓' : '→'} {p.toneDrift > 0 ? '+' : ''}{p.toneDrift.toFixed(3)}
                </p>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground">Inflation Drift</span>
                <p className={cn('text-[10px] font-mono font-medium',
                  p.inflationDrift > 0.05 ? 'text-signal-hawkish' : p.inflationDrift < -0.05 ? 'text-signal-dovish' : 'text-muted-foreground'
                )}>
                  {p.inflationDrift > 0 ? '↑' : p.inflationDrift < -0.05 ? '↓' : '→'} {(p.inflationDrift * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground">Comms</span>
                <p className="text-[10px] font-mono font-medium text-muted-foreground">{p.totalComms}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
