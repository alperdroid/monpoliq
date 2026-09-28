-- Read-only view comparing the frozen scorer with the previous Gemini scores.
-- Used by the admin page /admin/scoring. security_invoker: the caller's RLS applies.
create or replace view public.scorer_comparison
with (security_invoker = true) as
select
  id, bank, source, item_date, title, url, net_score,
  (policy_dimensions->'scoring_audit'->'frozen'->>'net_score')::float  as frozen_score,
  (policy_dimensions->'scoring_audit'->>'ai_score')::float              as ai_score,
  (policy_dimensions->'scoring_audit'->>'disagreement')::boolean       as disagreement,
  policy_dimensions->'scoring_audit'->>'model'                         as scorer_model,
  (policy_dimensions->'scoring_audit'->'frozen'->>'n_sentences')::int  as n_sentences
from public.sentiment_items
where is_statistical = false;