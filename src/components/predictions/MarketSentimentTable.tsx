import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, TrendingDown, Minus, Clock, BarChart3, Landmark, DollarSign } from 'lucide-react';

import { type MarketInstrument, fetchMarketData } from '@/lib/api/predictions';

function PriceChange({ value }: { value: number }) {
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-muted-foreground';
  return (
    <span className={`text-[9px] font-mono ${color}`}>
      {value > 0 ? '+' : ''}{value.toFixed(2)}
    </span>
  );
}

function DirectionBadge({ market, ai }: { market?: string; ai?: string }) {
  if (!market) return null;
  const colors: Record<string, string> = {
    bullish: 'bg-green-500/10 text-green-700 border-green-500/20',
    bearish: 'bg-red-500/10 text-red-700 border-red-500/20',
    neutral: 'bg-muted text-muted-foreground border-border',
  };
  const diverges = ai && ai !== market;
  return (
    <div className="flex items-center gap-1">
      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[market] || ''}`}>{market}</span>
      {diverges && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[ai!] || ''} ring-1 ring-accent`}>
          AI: {ai}
        </span>
      )}
    </div>
  );
}

function ProbabilityDiff({ market, ai, type }: { market: number; ai: number; type: 'hike' | 'hold' | 'cut' }) {
  const diff = ai - market;
  const abs = Math.abs(diff);
  if (abs < 0.01) return <Minus className="w-3 h-3 text-muted-foreground" />;
  const color = type === 'hike'
    ? (diff > 0 ? 'text-red-600' : 'text-green-600')
    : type === 'cut'
    ? (diff > 0 ? 'text-blue-600' : 'text-orange-600')
    : 'text-muted-foreground';
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <div className={`flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      <span className="text-[10px] font-mono">{(abs * 100).toFixed(1)}%</span>
    </div>
  );
}

function RateFuturesTable({ items }: { items: MarketInstrument[] }) {
  return (
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
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="py-2">
              <div className="space-y-1">
                <div className="text-xs font-medium">{item.name}</div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.bank === 'FED' ? 'default' : 'secondary'} className="text-[9px] px-1 py-0">
                    {item.bank}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(item.reference_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-center py-2">
              <div className="text-xs font-mono">{item.price.toFixed(2)}</div>
              <PriceChange value={item.change_24h} />
            </TableCell>
            <TableCell className="text-center py-2">
              <div className="text-xs font-mono">{((item.market_hike_prob ?? 0) * 100).toFixed(0)}%</div>
              <ProbabilityDiff market={item.market_hike_prob ?? 0} ai={item.ai_hike_prob ?? 0} type="hike" />
            </TableCell>
            <TableCell className="text-center py-2">
              <div className="text-xs font-mono">{((item.market_hold_prob ?? 0) * 100).toFixed(0)}%</div>
              <ProbabilityDiff market={item.market_hold_prob ?? 0} ai={item.ai_hold_prob ?? 0} type="hold" />
            </TableCell>
            <TableCell className="text-center py-2">
              <div className="text-xs font-mono">{((item.market_cut_prob ?? 0) * 100).toFixed(0)}%</div>
              <ProbabilityDiff market={item.market_cut_prob ?? 0} ai={item.ai_cut_prob ?? 0} type="cut" />
            </TableCell>
            <TableCell className="text-center py-2 text-[9px] text-muted-foreground">
              {(() => {
                const d = Math.abs((item.ai_hike_prob ?? 0) - (item.market_hike_prob ?? 0)) +
                          Math.abs((item.ai_hold_prob ?? 0) - (item.market_hold_prob ?? 0)) +
                          Math.abs((item.ai_cut_prob ?? 0) - (item.market_cut_prob ?? 0));
                return d < 0.1 ? 'Aligned' : d < 0.2 ? 'Minor' : 'Major';
              })()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BondsTable({ items }: { items: MarketInstrument[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Instrument</TableHead>
          <TableHead className="text-xs text-center">Price</TableHead>
          <TableHead className="text-xs text-center">Yield / Spread</TableHead>
          <TableHead className="text-xs text-center">24h</TableHead>
          <TableHead className="text-xs text-center">Direction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="py-2">
              <div className="text-xs font-medium">{item.name}</div>
              <Badge variant="outline" className="text-[9px] px-1 py-0 mt-1">{item.bank}</Badge>
            </TableCell>
            <TableCell className="text-center py-2">
              <span className="text-xs font-mono">{item.price.toFixed(2)}</span>
            </TableCell>
            <TableCell className="text-center py-2">
              {item.yield_value != null ? (
                <span className="text-xs font-mono">{item.yield_value.toFixed(3)}%</span>
              ) : item.spread_bps != null ? (
                <span className="text-xs font-mono">{item.spread_bps.toFixed(0)} bps</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-center py-2">
              <PriceChange value={item.change_24h} />
            </TableCell>
            <TableCell className="text-center py-2">
              <DirectionBadge market={item.direction} ai={item.ai_direction} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CurrencyTable({ items }: { items: MarketInstrument[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Forward</TableHead>
          <TableHead className="text-xs text-center">Rate</TableHead>
          <TableHead className="text-xs text-center">24h</TableHead>
          <TableHead className="text-xs text-center">Direction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="py-2">
              <div className="text-xs font-medium">{item.name}</div>
              <span className="text-[9px] text-muted-foreground">
                {new Date(item.reference_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </TableCell>
            <TableCell className="text-center py-2">
              <span className="text-xs font-mono">{item.price.toFixed(4)}</span>
            </TableCell>
            <TableCell className="text-center py-2">
              <PriceChange value={item.change_24h} />
            </TableCell>
            <TableCell className="text-center py-2">
              <DirectionBadge market={item.direction} ai={item.ai_direction} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MarketSentimentTable() {
  const { data: marketData = [], isLoading, error } = useQuery({
    queryKey: ['market-sentiment'],
    queryFn: fetchMarketData,
    staleTime: 1000 * 60 * 30,
    retry: 2,
  });

  const rateFutures = marketData.filter(i => i.category === 'rate_futures');
  const bonds = marketData.filter(i => i.category === 'bonds');
  const currency = marketData.filter(i => i.category === 'currency');

  const tabCounts = {
    rates: rateFutures.length,
    bonds: bonds.length,
    fx: currency.length,
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-destructive" />
            Market Expectations & Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-xs text-destructive">Failed to load market data</p>
            <p className="text-xs text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-primary animate-pulse" />
            Market Expectations & Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">Loading live market data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-primary" />
          Market Expectations & Pricing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Multi-asset market data: rate futures, sovereign bonds, and currency forwards
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="rates" className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-3">
            <TabsTrigger value="rates" className="text-xs gap-1">
              <BarChart3 className="w-3 h-3" /> Rates {tabCounts.rates > 0 && `(${tabCounts.rates})`}
            </TabsTrigger>
            <TabsTrigger value="bonds" className="text-xs gap-1">
              <Landmark className="w-3 h-3" /> Bonds {tabCounts.bonds > 0 && `(${tabCounts.bonds})`}
            </TabsTrigger>
            <TabsTrigger value="fx" className="text-xs gap-1">
              <DollarSign className="w-3 h-3" /> FX {tabCounts.fx > 0 && `(${tabCounts.fx})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rates">
            {rateFutures.length > 0 ? <RateFuturesTable items={rateFutures} /> : <EmptyTab />}
          </TabsContent>
          <TabsContent value="bonds">
            {bonds.length > 0 ? <BondsTable items={bonds} /> : <EmptyTab />}
          </TabsContent>
          <TabsContent value="fx">
            {currency.length > 0 ? <CurrencyTable items={currency} /> : <EmptyTab />}
          </TabsContent>
        </Tabs>

        <div className="mt-3 text-[10px] text-muted-foreground">
          AI-generated daily market data • Updates every 30 minutes • {marketData.length} instruments tracked
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTab() {
  return (
    <div className="text-center py-6 text-xs text-muted-foreground">No data available for this category</div>
  );
}
