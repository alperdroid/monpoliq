
-- Alert rules table
CREATE TABLE public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  rule_type text NOT NULL DEFAULT 'threshold',
  bank text,
  metric text NOT NULL DEFAULT 'fed_ecb_spread',
  operator text NOT NULL DEFAULT 'gt',
  threshold numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  email_notify boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own alert rules"
  ON public.alert_rules FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alert rules"
  ON public.alert_rules FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alert rules"
  ON public.alert_rules FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own alert rules"
  ON public.alert_rules FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Alert history table
CREATE TABLE public.alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.alert_rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  current_value numeric NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT ''
);

ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own alert history"
  ON public.alert_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Service role needs insert access (edge function)
CREATE POLICY "Service can insert alert history"
  ON public.alert_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
