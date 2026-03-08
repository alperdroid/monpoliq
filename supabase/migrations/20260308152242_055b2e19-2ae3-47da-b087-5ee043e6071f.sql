
CREATE TABLE public.dissent_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank text NOT NULL DEFAULT 'FED',
  meeting_date date NOT NULL,
  member_name text NOT NULL,
  dissent_direction text NOT NULL CHECK (dissent_direction IN ('hawkish', 'dovish')),
  preferred_action text, -- e.g. 'hike', 'hold', 'cut', 'larger cut', 'smaller cut'
  committee_action text, -- what the committee actually did
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.dissent_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read dissent history"
ON public.dissent_history
FOR SELECT
USING (true);

-- Unique constraint to prevent duplicate entries
ALTER TABLE public.dissent_history ADD CONSTRAINT unique_dissent UNIQUE (bank, meeting_date, member_name);
