
-- Remove overly permissive write policies (edge functions use service role which bypasses RLS)
DROP POLICY "Service role can insert sentiment items" ON public.sentiment_items;
DROP POLICY "Service role can insert sentiment scores" ON public.sentiment_scores;
DROP POLICY "Service role can update sentiment items" ON public.sentiment_items;
DROP POLICY "Service role can update sentiment scores" ON public.sentiment_scores;
DROP POLICY "Service role can delete sentiment items" ON public.sentiment_items;
DROP POLICY "Service role can delete sentiment scores" ON public.sentiment_scores;
