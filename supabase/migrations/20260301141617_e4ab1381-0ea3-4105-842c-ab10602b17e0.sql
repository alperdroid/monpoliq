-- Add unique constraint on sentiment_items to prevent duplicate events
ALTER TABLE public.sentiment_items
ADD CONSTRAINT sentiment_items_bank_source_title_date_unique
UNIQUE (bank, source, title, item_date);