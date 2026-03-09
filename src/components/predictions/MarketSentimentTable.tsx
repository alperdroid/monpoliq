import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';

interface MarketInstrument {
  id: string;
  name: string;
  type: 'futures' | 'bonds' | 'swaps';
  bank: 'FED' | 'ECB';
  meeting_date: string;
  market_hike_prob: number;
  market_hold_prob: number;
  market_cut_prob: number;
  ai_hike_prob: number;
  ai_hold_prob: number;
  ai_cut_prob: number;
  price: number;
  change_24h: number;
}

// AI-generated market expectations data
function generateMarketData(): MarketInstrument[] {
  const nextFedMeeting = '2024-03-20';
  const nextEcbMeeting = '2024-04-11';
  
  return [
    {
      id: 'fed-funds-mar24',
      name: 'Fed Funds Mar 24',
      type: 'futures',
      bank: 'FED',
      meeting_date: nextFedMeeting,
      market_hike_prob: 0.05,
      market_hold_prob: 0.82,
      market_cut_prob: 0.13,
      ai_hike_prob: 0.02,
      ai_hold_prob: 0.75,
      ai_cut_prob: 0.23,
      price: 94.87,
      change_24h: -0.02,
    },
    {
      id: 'euribor-apr24',
      name: 'Euribor Apr 24',
      type: 'futures',
      bank: 'ECB',
      meeting_date: nextEcbMeeting,
      market_hike_prob: 0.08,
      market_hold_prob: 0.89,
      market_cut_prob: 0.03,
      ai_hike_prob: 0.12,
      ai_hold_prob: 0.85,
      ai_cut_prob: 0.03,
      price: 96.25,
      change_24h: 0.01,
    },
    {
      id: 'fed-funds-may24',
      name: 'Fed Funds May 24',
      type: 'futures',
      bank: 'FED',
      meeting_date: '2024-05-01',
      market_hike_prob: 0.03,
      market_hold_prob: 0.71,
      market_cut_prob: 0.26,
      ai_hike_prob: 0.01,
      ai_hold_prob: 0.65,
      ai_cut_prob: 0.34,
      price: 94.74,
      change_24h: -0.03,
    },
    {
      id: 'euribor-jun24',
      name: 'Euribor Jun 24',
      type: 'futures',
      bank: 'ECB',
      meeting_date: '2024-06-06',
      market_hike_prob: 0.02,
      market_hold_prob: 0.78,
      market_cut_prob: 0.20,
      ai_hike_prob: 0.05,
      ai_hold_prob: 0.72,
      ai_cut_prob: 0.23,
      price: 96.15,
      change_24h: -0.01,
    }
  ];
}

function ProbabilityDiff({ market, ai, type }: { market: number; ai: number; type: 'hike' | 'hold' | 'cut' }) {
  const diff = ai - market;
  const absValue = Math.abs(diff);
  
  if (absValue < 0.01) return <Minus className="w-3 h-3 text-muted-foreground" />;
  
  const color = type === 'hike' 
    ? (diff > 0 ? 'text-red-600' : 'text-green-600')
    : type === 'cut'
    ? (diff > 0 ? 'text-blue-600' : 'text-orange-600')  
    : (diff > 0 ? 'text-neutral-600' : 'text-muted-foreground');
    
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  
  return (
    <div className={`flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      <span className="text-[10px] font-mono">{absValue > 0.005 ? `${(absValue * 100).toFixed(1)}%` : '<1%'}</span>
    </div>
  );
}

export function MarketSentimentTable() {
  const { data: marketData = [] } = useQuery({
    queryKey: ['market-sentiment'],
    queryFn: () => generateMarketData(),
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-primary" />
          Market vs AI Expectations
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Futures-implied probabilities vs our AI predictions for upcoming meetings
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Instrument</TableHead>
              <TableHead className="text-xs text-center">Price</TableHead>
              <TableHead className="text-xs text-center">Hike</TableHead>
              <TableHead className="text-xs text-center">Hold</TableHead>
              <TableHead className="text-xs text-center">Cut</TableHead>
              <TableHead className="text-xs text-center">AI Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marketData.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="py-2">
                  <div className="space-y-1">
                    <div className="text-xs font-medium">{item.name}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.bank === 'FED' ? 'default' : 'secondary'} className="text-[9px] px-1 py-0">
                        {item.bank}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(item.meeting_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center py-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono">{item.price.toFixed(2)}</div>
                    <div className={`text-[9px] font-mono ${item.change_24h > 0 ? 'text-green-600' : item.change_24h < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                      {item.change_24h > 0 ? '+' : ''}{item.change_24h.toFixed(2)}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center py-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono">{(item.market_hike_prob * 100).toFixed(0)}%</div>
                    <ProbabilityDiff market={item.market_hike_prob} ai={item.ai_hike_prob} type="hike" />
                  </div>
                </TableCell>
                <TableCell className="text-center py-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono">{(item.market_hold_prob * 100).toFixed(0)}%</div>
                    <ProbabilityDiff market={item.market_hold_prob} ai={item.ai_hold_prob} type="hold" />
                  </div>
                </TableCell>
                <TableCell className="text-center py-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono">{(item.market_cut_prob * 100).toFixed(0)}%</div>
                    <ProbabilityDiff market={item.market_cut_prob} ai={item.ai_cut_prob} type="cut" />
                  </div>
                </TableCell>
                <TableCell className="text-center py-2">
                  <div className="space-y-1">
                    {/* Overall divergence indicator */}
                    <div className="text-[9px] text-muted-foreground">
                      {(() => {
                        const totalDiff = Math.abs(item.ai_hike_prob - item.market_hike_prob) + 
                                        Math.abs(item.ai_hold_prob - item.market_hold_prob) + 
                                        Math.abs(item.ai_cut_prob - item.market_cut_prob);
                        if (totalDiff < 0.1) return 'Aligned';
                        if (totalDiff < 0.2) return 'Minor';
                        return 'Major';
                      })()}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 text-[10px] text-muted-foreground">
          Market data simulated • AI diff shows direction and magnitude vs market consensus • Updates every 2 minutes
        </div>
      </CardContent>
    </Card>
  );
}