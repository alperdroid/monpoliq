
CREATE TABLE public.analysis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_type text NOT NULL,
  bank text NOT NULL,
  data_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_type, bank, data_hash)
);

ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read analysis cache"
ON public.analysis_cache FOR SELECT USING (true);
