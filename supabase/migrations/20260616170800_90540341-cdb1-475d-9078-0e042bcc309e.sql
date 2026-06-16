
WITH canon AS (
  SELECT
    id, bank, source, item_date, title, url, word_count,
    CASE
      WHEN url IS NULL OR url = '' THEN NULL
      ELSE regexp_replace(
             regexp_replace(
               regexp_replace(lower(url), '^https?://(www\.)?', ''),
               '/(en|de|fr|es|it|nl|pt)/', '/__lang__/', 'g'),
             '\.(en|de|fr|es|it|nl|pt)\.(html?|pdf)$', '.\2')
    END AS canon_url,
    lower(regexp_replace(regexp_replace(replace(title, '(with Q&amp;A)', ''), '\s+\|\s+.*$', ''), '[^a-z0-9 ]', ' ', 'g')) AS canon_title
  FROM public.sentiment_items
),
grouped AS (
  SELECT
    id, bank, source, item_date,
    COALESCE('U:' || canon_url, 'T:' || canon_title) AS k,
    -- Prefer English url, then Q&A title, then higher word_count
    (CASE WHEN url ~ '/en/' OR url ~ '\.en\.(html?|pdf)$' THEN 1 ELSE 0 END) * 1000
      + (CASE WHEN title ~* 'q&amp;a|q&a' THEN 1 ELSE 0 END) * 100
      + COALESCE(word_count, 0) AS rank_score
  FROM canon
),
ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY bank, source, item_date, k ORDER BY rank_score DESC, id) AS rn
  FROM grouped
)
DELETE FROM public.sentiment_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
