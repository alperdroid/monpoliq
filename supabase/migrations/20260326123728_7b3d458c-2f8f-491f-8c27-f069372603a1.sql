DELETE FROM sentiment_items 
WHERE bank = 'ECB' 
AND source = 'ECB Monetary Policy Accounts' 
AND (net_score = 0 OR net_score IS NULL);

DELETE FROM prediction_cache;
DELETE FROM analysis_cache WHERE analysis_type IN ('multi_horizon', 'minutes-diff-ECB');