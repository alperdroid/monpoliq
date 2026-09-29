import type { SentimentItem } from '@/lib/api/sentiment';
import { scoreKind, textKind } from '@/lib/scoring-provenance';

const pill = 'inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-4';

/** Badges telling the reader how this score and its text were produced. */
export function ScoreProvenanceBadges({ item, linkable = true }: { item: SentimentItem; linkable?: boolean }) {
  // linkable=false when rendered inside a <button> (a link cannot be nested in a button)
  const sk = scoreKind(item);
  const tk = textKind(item);
  return (
    <>
      {sk === 'legacy' && (
        <span className={`${pill} border-border bg-muted text-muted-foreground`}
          title="Scored by the previous AI method, before the switch to the fixed scorer">
          Legacy AI score
        </span>
      )}
      {sk === 'sep' && (
        <span className={`${pill} border-primary/30 bg-primary/10 text-primary`}
          title="Projection tables are compared with the previous SEP; an AI model reads the tables">
          SEP: projection comparison
        </span>
      )}
      {tk === 'ai_discovered' && (
        <span className={`${pill} border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400`}
          title="This remark was found by an AI search and no published article or speech has confirmed it yet. The text is the AI's summary.">
          AI search summary: not verified
        </span>
      )}
      {tk === 'ai_verified' && (
        item.url && linkable
          ? <a href={item.url} target="_blank" rel="noopener noreferrer"
              title="Confirmed by this published source; scored on the speaker's own sentences from it"
              className={`${pill} border-border bg-background text-foreground hover:underline`}>Verified source</a>
          : <span className={`${pill} border-border bg-background text-foreground`}
              title="Confirmed by a published source; scored on the speaker's own sentences from it">Verified source</span>
      )}
      {tk === 'bis' && (
        item.url && linkable
          ? <a href={item.url} target="_blank" rel="noopener noreferrer"
              className={`${pill} border-border bg-background text-foreground hover:underline`}>BIS speech</a>
          : <span className={`${pill} border-border bg-background text-foreground`}>BIS speech</span>
      )}
    </>
  );
}
