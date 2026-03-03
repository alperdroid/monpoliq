
CREATE TABLE public.prediction_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predictions jsonb NOT NULL,
  data_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prediction_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read predictions" ON public.prediction_cache
  FOR SELECT USING (true);

-- Index for fast latest lookup
CREATE INDEX idx_prediction_cache_created ON public.prediction_cache(created_at DESC);
