-- Clean up bad data: 1970 dates and old ecb_speech items with broken HTML entities
DELETE FROM sentiment_items WHERE item_date < '2024-01-01' AND source = 'ecb_speech';
DELETE FROM sentiment_items WHERE item_date = '1970-01-01';