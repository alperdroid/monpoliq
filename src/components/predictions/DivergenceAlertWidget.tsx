import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { fetchMarketData } from '@/lib/api/predictions';
import { Skeleton } from '@/components/ui/skeleton';

export function DivergenceAlertWidget() {
  const { data: marketData, isLoading, error } = useQuery({
    queryKey: ['market-sentiment'],
    queryFn: fetchMarketData,
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) {
    return (
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-orange-600 dark:text-orange-400">
            <AlertTriangle className="w-4 h-4" />
            Fundamental vs Market Divergences
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full bg-orange-500/10" />
        </CardContent>
      </Card>
    );
  }

  if (error || !marketData) return null;

  const divergences = marketData.filter(item => {
    if (item.category === 'rate_futures' && item.market_hike_prob != null && item.ai_hike_prob != null) {
      const diff = Math.abs(item.market_hike_prob - item.ai_hike_prob) + 
                   Math.abs((item.market_hold_prob||0) - (item.ai_hold_prob||0)) + 
                   Math.abs((item.market_cut_prob||0) - (item.ai_cut_prob||0));
      return diff > 0.2; // Significant divergence
    }
    if (item.direction && item.ai_direction && item.direction !== item.ai_direction) {
      return true; // Directional divergence
    }
    return false;
  });

  if (divergences.length === 0) return null;

  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-orange-600 dark:text-orange-400">
          <AlertTriangle className="w-4 h-4" />
          Fundamental vs Market Divergences
        </CardTitle>
        <p className="text-xs text-orange-600/80 dark:text-orange-400/80">
          Areas where algorithm-implied path differs significantly from market expectations
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {divergences.map(div => {
          let mktStr = '';
          let aiStr = '';

          if (div.category === 'rate_futures') {
            const mCut = (div.market_cut_prob||0)*100;
            const mHold = (div.market_hold_prob||0)*100;
            const mHike = (div.market_hike_prob||0)*100;
            const aCut = (div.ai_cut_prob||0)*100;
            const aHold = (div.ai_hold_prob||0)*100;
            const aHike = (div.ai_hike_prob||0)*100;

            const mMax = Math.max(mCut, mHold, mHike);
            mktStr = mMax === mCut ? `${mCut.toFixed(0)}% Cut` : mMax === mHike ? `${mHike.toFixed(0)}% Hike` : `${mHold.toFixed(0)}% Hold`;

            const aMax = Math.max(aCut, aHold, aHike);
            aiStr = aMax === aCut ? `${aCut.toFixed(0)}% Cut` : aMax === aHike ? `${aHike.toFixed(0)}% Hike` : `${aHold.toFixed(0)}% Hold`;
          } else {
            mktStr = div.direction ? div.direction.toUpperCase() : 'N/A';
            aiStr = div.ai_direction ? div.ai_direction.toUpperCase() : 'N/A';
          }

          return (
            <div key={div.id} className="text-xs flex items-center justify-between border-b border-orange-500/10 pb-2 last:border-0 last:pb-0">
              <div>
                <span className="font-semibold text-orange-700 dark:text-orange-300">{div.name}</span>
                <span className="text-orange-600/60 dark:text-orange-400/60 ml-2">({div.bank})</span>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col items-end">
                  <span className="text-[9px] text-orange-600/60 dark:text-orange-400/60 uppercase font-bold tracking-wider">Market</span>
                  <span className="font-medium text-orange-700 dark:text-orange-300">{mktStr}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] text-orange-600/60 dark:text-orange-400/60 uppercase font-bold tracking-wider">Fundamental</span>
                  <span className="font-medium text-orange-700 dark:text-orange-300">{aiStr}</span>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
