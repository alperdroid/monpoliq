-- Reset topics for ECB policy documents so they get re-analyzed with improved classifier
UPDATE sentiment_items 
SET topics = NULL 
WHERE bank = 'ECB' 
AND is_statistical = false
AND (
  source ILIKE '%press conf%' 
  OR source ILIKE '%ecb press%'
  OR title ILIKE '%meeting of%' 
  OR title ILIKE '%monetary policy%'
  OR title ILIKE '%ECB Monetary%'
  OR source ILIKE '%minutes%'
  OR source ILIKE '%statement%'
  OR source ILIKE '%accounts%'
);