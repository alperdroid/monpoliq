
-- Committee members table for Fed voter rotation + ECB board composition
CREATE TABLE public.committee_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bank text NOT NULL,
  role text NOT NULL,
  institution text NOT NULL,
  is_permanent_voter boolean DEFAULT false,
  voting_years integer[] DEFAULT '{}',
  is_core_board boolean DEFAULT false,
  term_start text,
  term_end text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(name, bank)
);

ALTER TABLE public.committee_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read committee members" ON public.committee_members FOR SELECT USING (true);

-- Add topics column to sentiment_items for supervised topic tagging
ALTER TABLE public.sentiment_items ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}';
