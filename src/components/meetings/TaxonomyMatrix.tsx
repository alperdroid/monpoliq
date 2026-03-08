import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/** Dimension definitions with human labels and value colors */
const DIMENSIONS: Record<string, {
  label: string;
  values: Record<string, { label: string; color: string }>;
}> = {
  reaction_function: {
    label: 'Reaction Function',
    values: {
      inflation_priority: { label: 'Inflation', color: 'hsl(0 70% 55%)' },
      growth_priority: { label: 'Growth', color: 'hsl(160 55% 45%)' },
      financial_stability_priority: { label: 'Fin. Stability', color: 'hsl(220 65% 55%)' },
    },
  },
  forward_guidance: {
    label: 'Forward Guidance',
    values: {
      firm: { label: 'Firm', color: 'hsl(0 60% 50%)' },
      conditional: { label: 'Conditional', color: 'hsl(38 80% 50%)' },
      open_ended: { label: 'Open-ended', color: 'hsl(200 60% 50%)' },
    },
  },
  risk_balance: {
    label: 'Risk Balance',
    values: {
      upside_inflation: { label: '↑ Inflation', color: 'hsl(0 65% 52%)' },
      downside_growth: { label: '↓ Growth', color: 'hsl(160 55% 42%)' },
      balanced: { label: 'Balanced', color: 'hsl(220 15% 60%)' },
    },
  },
  terminal_rate: {
    label: 'Terminal-Rate Framing',
    values: {
      restrictive_enough: { label: 'Restrictive Enough', color: 'hsl(160 50% 45%)' },
      more_to_do: { label: 'More To Do', color: 'hsl(0 60% 52%)' },
      neutral_framing: { label: 'Neutral', color: 'hsl(220 15% 60%)' },
    },
  },
  time_horizon: {
    label: 'Time Horizon',
    values: {
      near_term: { label: 'Near-term', color: 'hsl(38 75% 50%)' },
      medium_term: { label: 'Medium-term', color: 'hsl(260 50% 55%)' },
      mixed: { label: 'Mixed', color: 'hsl(220 15% 60%)' },
    },
  },
  balance_sheet: {
    label: 'Balance Sheet',
    values: {
      qt_continuing: { label: 'QT Continuing', color: 'hsl(0 55% 52%)' },
      qt_slowing: { label: 'QT Slowing', color: 'hsl(38 70% 50%)' },
      reinvestment_change: { label: 'Reinvest. Change', color: 'hsl(260 50% 55%)' },
      not_discussed: { label: 'Not Discussed', color: 'hsl(220 10% 75%)' },
    },
  },
};

const DIM_KEYS = Object.keys(DIMENSIONS);

interface Props {
  meetings: { id: string; label: string; bank: string; items: TaxonomyItem[] }[];
}

/**
 * Stacked bar chart per dimension, per meeting
 */
export function TaxonomyMatrix({ meetings }: Props) {
  const sorted = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const dateA = a.id.split('-').slice(1).join('-');
      const dateB = b.id.split('-').slice(1).join('-');
      return dateA.localeCompare(dateB);
    });
  }, [meetings]);

  const dimData = useMemo(() => {
    return DIM_KEYS.map(dimKey => {
      const dim = DIMENSIONS[dimKey];
      const valKeys = Object.keys(dim.values);

      const meetingDistributions = sorted.map(m => {
        const counts: Record<string, number> = {};
        for (const v of valKeys) counts[v] = 0;
        let total = 0;

        for (const item of m.items) {
          const pd = (item as any).policy_dimensions as Record<string, string | null> | null;
          if (!pd || !pd[dimKey]) continue;
          const val = pd[dimKey]!;
          if (counts[val] !== undefined) {
            counts[val]++;
            total++;
          }
        }

        return { counts, total };
      });

      return { dimKey, dim, valKeys, meetingDistributions };
    });
  }, [sorted]);

  const hasAnyData = dimData.some(d => d.meetingDistributions.some(md => md.total > 0));

  if (!hasAnyData) {
    return (
      <p className="text-xs text-muted-foreground italic py-4">
        No taxonomy data yet — click <strong>"Run Taxonomy Analysis"</strong> to classify communications.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {dimData.map(({ dimKey, dim, valKeys, meetingDistributions }) => {
        const anyData = meetingDistributions.some(md => md.total > 0);
        if (!anyData) return null;

        return (
          <div key={dimKey} className="space-y-1.5">
            <h4 className="text-[11px] font-bold text-foreground tracking-wide uppercase">
              {dim.label}
            </h4>
            <div className="space-y-1">
              {sorted.map((m, mi) => {
                const { counts, total } = meetingDistributions[mi];
                if (total === 0) return null;

                const meetingLabel = m.label.split('—')[0].trim();
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <div className="w-[100px] text-[9px] text-muted-foreground truncate shrink-0 text-right font-medium">
                      {meetingLabel}
                    </div>
                    <span
                      className={cn(
                        'text-[7px] font-bold px-1 py-0.5 rounded-sm shrink-0 w-7 text-center',
                        m.bank === 'FED'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-accent text-accent-foreground',
                      )}
                    >
                      {m.bank}
                    </span>
                    <div className="flex-1 h-5 rounded-md overflow-hidden flex bg-muted/40">
                      {valKeys.map(vk => {
                        const pct = (counts[vk] / total) * 100;
                        if (pct === 0) return null;
                        return (
                          <div
                            key={vk}
                            className="h-full flex items-center justify-center text-[8px] font-bold transition-all duration-300 hover:brightness-110"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: dim.values[vk].color,
                              color: 'white',
                              minWidth: pct > 8 ? undefined : '12px',
                            }}
                            title={`${dim.values[vk].label}: ${counts[vk]}/${total} (${Math.round(pct)}%)`}
                          >
                            {pct > 15 ? dim.values[vk].label : ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend for this dimension */}
            <div className="flex items-center gap-3 mt-1">
              {valKeys.filter(vk => vk !== 'not_discussed').map(vk => (
                <div key={vk} className="flex items-center gap-1">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: dim.values[vk].color }}
                  />
                  <span className="text-[8px] text-muted-foreground">{dim.values[vk].label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
