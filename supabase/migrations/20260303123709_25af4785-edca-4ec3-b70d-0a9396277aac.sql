
-- Fix 1: Reclassify Consumer Expectations Survey items as statistical
UPDATE public.sentiment_items 
SET is_statistical = true, 
    stat_metric = 'Survey', 
    stat_weight = 1,
    reasons = ARRAY['survey-reclassified-as-statistical']
WHERE title ILIKE '%consumer expectations survey%' 
  AND is_statistical = false;

-- Fix 2: Fix negative stat_value for HICP items where value should be positive
-- "Annual inflation down to 1.7%" has stat_value = -1.70 but should be 1.70
UPDATE public.sentiment_items
SET stat_value = ABS(stat_value)
WHERE stat_metric = 'HICP' 
  AND stat_value < 0
  AND title ILIKE '%inflation%to%';

-- Fix 3: Mark duplicate inflation prints in same month as zero-weight
-- For items with same stat_metric, same stat_value, same month - keep earliest, zero out duplicates
WITH ranked AS (
  SELECT id, 
         ROW_NUMBER() OVER (
           PARTITION BY stat_metric, stat_value, DATE_TRUNC('month', item_date)
           ORDER BY item_date ASC
         ) as rn,
         FIRST_VALUE(item_date) OVER (
           PARTITION BY stat_metric, stat_value, DATE_TRUNC('month', item_date)
           ORDER BY item_date ASC
         ) as first_date
  FROM public.sentiment_items
  WHERE is_statistical = true 
    AND stat_metric IS NOT NULL
    AND stat_value IS NOT NULL
)
UPDATE public.sentiment_items si
SET net_score = 0, 
    label = 'neutral', 
    stat_weight = 0,
    reasons = ARRAY['duplicate: already counted in ' || ranked.first_date::text]
FROM ranked
WHERE si.id = ranked.id 
  AND ranked.rn > 1;
