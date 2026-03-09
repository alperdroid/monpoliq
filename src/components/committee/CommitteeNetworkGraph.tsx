import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TooltipInfo } from '@/components/ui/tooltip-info';
import type { SentimentItem } from '@/lib/api/sentiment';

interface Node {
  name: string;
  bank: string;
  avgTone: number;
  commsCount: number;
  x: number;
  y: number;
}

interface Edge {
  from: string;
  to: string;
  similarity: number;
}

const SPEAKERS = [
  { name: 'Powell', bank: 'FED' }, { name: 'Waller', bank: 'FED' },
  { name: 'Bowman', bank: 'FED' }, { name: 'Williams', bank: 'FED' },
  { name: 'Cook', bank: 'FED' }, { name: 'Kugler', bank: 'FED' },
  { name: 'Jefferson', bank: 'FED' },
  { name: 'Lagarde', bank: 'ECB' }, { name: 'Schnabel', bank: 'ECB' },
  { name: 'Cipollone', bank: 'ECB' }, { name: 'Lane', bank: 'ECB' },
  { name: 'Guindos', bank: 'ECB' }, { name: 'Elderson', bank: 'ECB' },
];

function computeGraph(items: SentimentItem[], bankFilter: string): { nodes: Node[]; edges: Edge[] } {
  const comms = items.filter(i => !i.is_statistical);
  const speakerData: Record<string, { scores: number[]; bank: string }> = {};

  for (const sp of SPEAKERS) {
    if (bankFilter !== 'all' && sp.bank !== bankFilter) continue;
    const matched = comms.filter(i => i.bank === sp.bank && i.title.toLowerCase().includes(sp.name.toLowerCase()));
    if (matched.length < 2) continue;
    speakerData[sp.name] = {
      scores: matched.map(m => m.net_score),
      bank: sp.bank,
    };
  }

  const names = Object.keys(speakerData);
  if (names.length < 2) return { nodes: [], edges: [] };

  // Compute average tone per speaker
  const avgTones: Record<string, number> = {};
  for (const [name, data] of Object.entries(speakerData)) {
    avgTones[name] = data.scores.reduce((s, v) => s + v, 0) / data.scores.length;
  }

  // Layout: arrange on a circle, then shift by tone
  const cx = 200, cy = 180, radius = 130;
  const nodes: Node[] = names.map((name, i) => {
    const angle = (2 * Math.PI * i) / names.length - Math.PI / 2;
    const tone = avgTones[name];
    // Shift X by tone (hawkish = right, dovish = left)
    const x = cx + Math.cos(angle) * radius + tone * 40;
    const y = cy + Math.sin(angle) * radius;
    return {
      name,
      bank: speakerData[name].bank,
      avgTone: tone,
      commsCount: speakerData[name].scores.length,
      x, y,
    };
  });

  // Compute pairwise similarity (inverse of absolute difference)
  const edges: Edge[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const diff = Math.abs(avgTones[names[i]] - avgTones[names[j]]);
      const sim = Math.max(0, 1 - diff * 5); // Normalize: diff of 0.2 = 0 similarity
      if (sim > 0.3) {
        edges.push({ from: names[i], to: names[j], similarity: sim });
      }
    }
  }

  return { nodes, edges };
}

interface CommitteeNetworkGraphProps {
  allItems: SentimentItem[];
  bankFilter?: string;
}

export function CommitteeNetworkGraph({ allItems, bankFilter = 'all' }: CommitteeNetworkGraphProps) {
  const { nodes, edges } = useMemo(() => computeGraph(allItems, bankFilter), [allItems, bankFilter]);

  if (nodes.length < 2) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-muted-foreground">Insufficient data for network graph</p>
      </div>
    );
  }

  const nodeMap = Object.fromEntries(nodes.map(n => [n.name, n]));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Committee Network Graph</h3>
        <TooltipInfo content="Network visualization showing speaker positioning based on communication patterns. Node size = activity level, position = hawkish/dovish stance, connections = similarity in messaging tone." />
      </div>
      <div className="relative">
        <svg viewBox="0 0 400 360" className="w-full max-w-lg mx-auto">
        {/* Edges */}
        {edges.map((e, i) => {
          const from = nodeMap[e.from];
          const to = nodeMap[e.to];
          if (!from || !to) return null;
          return (
            <line
              key={i}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="hsl(var(--border))"
              strokeWidth={e.similarity * 3}
              opacity={e.similarity * 0.6}
            />
          );
        })}

        {/* Hawk/Dove labels */}
        <text x="10" y="20" fontSize="9" fill="hsl(var(--signal-dovish))" fontFamily="monospace">← DOVISH</text>
        <text x="340" y="20" fontSize="9" fill="hsl(var(--signal-hawkish))" fontFamily="monospace">HAWKISH →</text>

        {/* Center line */}
        <line x1="200" y1="10" x2="200" y2="350" stroke="hsl(var(--border))" strokeDasharray="4 4" opacity="0.3" />

        {/* Nodes */}
        {nodes.map((node) => {
          const r = Math.min(24, Math.max(12, node.commsCount * 2));
          const color = node.avgTone > 0.05
            ? 'hsl(var(--signal-hawkish))'
            : node.avgTone < -0.05
            ? 'hsl(var(--signal-dovish))'
            : 'hsl(var(--signal-neutral))';
          const bgColor = node.avgTone > 0.05
            ? 'hsl(var(--signal-hawkish) / 0.15)'
            : node.avgTone < -0.05
            ? 'hsl(var(--signal-dovish) / 0.15)'
            : 'hsl(var(--signal-neutral) / 0.15)';

          return (
            <g key={node.name}>
              <circle cx={node.x} cy={node.y} r={r} fill={bgColor} stroke={color} strokeWidth="1.5" />
              <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize="8" fontWeight="600" fill={color}>
                {node.name.slice(0, 3)}
              </text>
              <text x={node.x} y={node.y + r + 10} textAnchor="middle"
                fontSize="7" fill="hsl(var(--muted-foreground))">
                {node.name}
              </text>
              <text x={node.x} y={node.y + r + 19} textAnchor="middle"
                fontSize="6" fill="hsl(var(--muted-foreground))" fontFamily="monospace">
                {node.avgTone > 0 ? '+' : ''}{node.avgTone.toFixed(3)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
