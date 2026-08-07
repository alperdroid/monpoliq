-- Remove cross-source duplicate communication rows: same bank + date + same
-- underlying document (normalised URL), keeping the row with a real score,
-- then the more binding/longer document.
WITH norm AS (
  SELECT id, bank, item_date, source, title, net_score, word_count,
         regexp_replace(regexp_replace(lower(coalesce(url,'')), '^https?://(www\.)?', ''), '([^:])/{2,}', '\1/', 'g') AS u
  FROM sentiment_items
  WHERE is_statistical = false
), grouped AS (
  SELECT *,
         CASE
           WHEN (lower(source||' '||title) ~ '(fomc statement|issues fomc statement|monetary policy decisions)'
                 AND lower(source||' '||title) !~ '(press conference|q&a|q&amp;a|minutes|account|transcript)')
             THEN bank||'|'||item_date||'|CLASS:policy-decision'
           WHEN u <> '' THEN bank||'|'||item_date||'|U:'||u
           ELSE bank||'|'||item_date||'|T:'||lower(regexp_replace(title, '[^a-zA-Z ]', '', 'g'))
         END AS gkey
  FROM norm
), ranked AS (
  SELECT id, gkey,
         row_number() OVER (
           PARTITION BY gkey
           ORDER BY (abs(coalesce(net_score,0)) > 0.001) DESC, coalesce(word_count,0) DESC, id
         ) AS rn
  FROM grouped
)
DELETE FROM sentiment_items s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;