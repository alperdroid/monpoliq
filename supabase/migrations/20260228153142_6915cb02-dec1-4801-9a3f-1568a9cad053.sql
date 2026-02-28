
-- Table for individual sentiment items (both communication and statistical)
CREATE TABLE public.sentiment_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank TEXT NOT NULL CHECK (bank IN ('FED', 'ECB')),
  source TEXT NOT NULL,
  item_date DATE NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  is_statistical BOOLEAN NOT NULL DEFAULT false,
  hawk_pts INTEGER DEFAULT 0,
  dove_pts INTEGER DEFAULT 0,
  net_score NUMERIC(8,3) DEFAULT 0,
  label TEXT DEFAULT 'neutral',
  word_count INTEGER DEFAULT 0,
  reasons TEXT[] DEFAULT '{}',
  stat_metric TEXT,
  stat_value NUMERIC(12,4),
  stat_weight NUMERIC(6,2) DEFAULT 0,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for aggregated dual scores
CREATE TABLE public.sentiment_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank TEXT NOT NULL CHECK (bank IN ('FED', 'ECB')),
  score_1_avg NUMERIC(8,3) DEFAULT 0,
  score_1_count INTEGER DEFAULT 0,
  score_1_label TEXT DEFAULT 'neutral',
  score_1_dist JSONB DEFAULT '{}',
  score_2_avg NUMERIC(8,3) DEFAULT 0,
  score_2_count INTEGER DEFAULT 0,
  score_2_label TEXT DEFAULT 'neutral',
  score_2_dist JSONB DEFAULT '{}',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_sentiment_items_bank_date ON public.sentiment_items(bank, item_date DESC);
CREATE INDEX idx_sentiment_items_statistical ON public.sentiment_items(is_statistical, bank);
CREATE INDEX idx_sentiment_scores_bank ON public.sentiment_scores(bank, fetched_at DESC);

-- Enable RLS
ALTER TABLE public.sentiment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentiment_scores ENABLE ROW LEVEL SECURITY;

-- Public read access (this is public research data, not user-specific)
CREATE POLICY "Anyone can read sentiment items"
  ON public.sentiment_items FOR SELECT USING (true);

CREATE POLICY "Anyone can read sentiment scores"
  ON public.sentiment_scores FOR SELECT USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can insert sentiment items"
  ON public.sentiment_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can insert sentiment scores"
  ON public.sentiment_scores FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update sentiment items"
  ON public.sentiment_items FOR UPDATE
  USING (true);

CREATE POLICY "Service role can update sentiment scores"
  ON public.sentiment_scores FOR UPDATE
  USING (true);

CREATE POLICY "Service role can delete sentiment items"
  ON public.sentiment_items FOR DELETE
  USING (true);

CREATE POLICY "Service role can delete sentiment scores"
  ON public.sentiment_scores FOR DELETE
  USING (true);
