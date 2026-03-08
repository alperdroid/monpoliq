ALTER TABLE sentiment_items ALTER COLUMN topics SET DEFAULT NULL;
UPDATE sentiment_items SET topics = NULL WHERE topics = '{}' AND is_statistical = false;