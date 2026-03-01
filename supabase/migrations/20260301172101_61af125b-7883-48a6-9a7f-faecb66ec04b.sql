-- Remove duplicate score rows, keeping only the latest per bank
DELETE FROM sentiment_scores a
USING sentiment_scores b
WHERE a.bank = b.bank
  AND a.fetched_at < b.fetched_at;

-- Add unique constraint on bank so upserts work
ALTER TABLE sentiment_scores ADD CONSTRAINT sentiment_scores_bank_unique UNIQUE (bank);