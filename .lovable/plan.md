

# Implementation Plan: 5 Features

## 1. OIS Market Pricing Overlay (Real Data via AI)

No synthetic OIS curves. The edge function will use Gemini to research and return **real, current OIS/swap rate data** for Fed and ECB across multiple horizons.

**New files:**
- `supabase/functions/ois-curve/index.ts` — Edge function that prompts Gemini 3 Flash to provide actual OIS swap rates (using tool calling for structured output). The prompt will instruct the model to return real market OIS rates for horizons: spot, 3M, 6M, 1Y, 2Y for both Fed and ECB. The model's fundamental rate path comes from the existing `monetary-intelligence` predictions. Response shape: `{ fed: [{horizon, ois_rate, model_rate}], ecb: [...], generated_at }`. Cached in `analysis_cache` with type `ois-overlay`.
- `src/components/predictions/OISOverlayChart.tsx` — Recharts LineChart with two lines per bank (Market OIS vs Model Fundamental). Shaded gap area between lines. Bank toggle. Legend and tooltip explaining the spread as a tradeable signal.

**Integration:** Added to `Predictions.tsx` between the PredictionPanel and DivergenceAlertWidget.

**Config:** Add `[functions.ois-curve] verify_jwt = false` to `supabase/config.toml`.

---

## 2. Consensus Fragmentation Heatmap

Pure frontend component using existing `sentiment_items` data.

**New file:**
- `src/components/committee/FragmentationHeatmap.tsx` — Groups comms items by speaker (from `source` field) and month. Computes monthly average `net_score` per speaker. Renders an HTML grid: rows = speakers (sorted by overall tone), columns = last 6 months. Cell color gradient: red (hawkish) → white (neutral) → blue (dovish). Hover tooltip shows score, item count. Bank toggle prop.

**Integration:** Add as a new tab "Fragmentation" in `Committee.tsx` alongside Composition, Dissents, Network.

---

## 3. FOMC/ECB Minutes Word Cloud with Diff

**New files:**
- `supabase/functions/minutes-diff/index.ts` — Queries `sentiment_items` for items containing "Minutes" or "Account" in the title for each bank, gets the two most recent. Sends their titles/content context to Gemini 3 Flash to extract top 40 policy-relevant phrases from each, returning `{ bank, current: {date, phrases}, previous: {date, phrases}, added[], removed[] }`. Cached in `analysis_cache`.
- `src/components/meetings/MinutesDiffCloud.tsx` — Two side-by-side word clouds sized by weight. Green = newly appeared phrases, red = removed, gray = unchanged. Below: "Key Changes" summary list. Bank toggle.

**Integration:** Added to `MeetingCycles.tsx` as a new section after the Meeting Prep Pack.

**Config:** Add `[functions.minutes-diff] verify_jwt = false` to config.toml.

---

## 4. Taylor Rule Reaction Function Estimation

**New files:**
- `supabase/functions/taylor-rule/index.ts` — Uses Gemini to fetch current and historical macro data (policy rates, inflation, unemployment/output gap) for Fed and ECB. Performs OLS regression in TypeScript (simple normal equations for 2-3 variables). Returns coefficients, R-squared, time series of actual vs implied rate. Cached in `analysis_cache`.
- `src/components/predictions/TaylorRulePanel.tsx` — Coefficient table, R-squared display, Recharts line chart (actual vs Taylor-implied rate with shaded gap). Interpretation text.

**Integration:** Added to `EmpiricalPolicy.tsx` below the existing panel.

**Config:** Add `[functions.taylor-rule] verify_jwt = false` to config.toml.

---

## 5. Alert & Watchlist System with Email

This is the largest feature requiring auth, database, and email infrastructure.

### Database (migration):
- `alert_rules` table: `id uuid PK`, `user_id uuid references auth.users ON DELETE CASCADE`, `name text`, `rule_type text`, `bank text`, `metric text`, `operator text`, `threshold numeric`, `is_active boolean DEFAULT true`, `last_triggered_at timestamptz`, `email_notify boolean DEFAULT true`, `created_at timestamptz DEFAULT now()`
- `alert_history` table: `id uuid PK`, `rule_id uuid references alert_rules ON DELETE CASCADE`, `user_id uuid`, `triggered_at timestamptz DEFAULT now()`, `current_value numeric`, `message text`
- RLS: users CRUD their own rules/history only

### Auth:
- Email/password signup + login with email verification (no auto-confirm)
- Pages: `src/pages/Login.tsx`, `src/pages/Signup.tsx`
- Auth context/hook for session management
- Protected routes for alert management

### Frontend:
- `src/components/alerts/AlertBell.tsx` — Notification bell in AppLayout header with unread badge, dropdown of recent alerts
- `src/components/alerts/AlertRulesPanel.tsx` — Rule CRUD: list rules, add/edit form (metric type, bank, operator, threshold, email toggle), alert history table
- `src/pages/Alerts.tsx` — Dedicated page wrapping AlertRulesPanel

### Edge Function:
- `supabase/functions/check-alerts/index.ts` — Queries active rules, evaluates current metric values from `sentiment_scores`/`sentiment_items`, inserts into `alert_history` when triggered

### Email:
- Set up email domain via `presentation-open-email-setup`
- Scaffold transactional email template for alert notifications
- `check-alerts` enqueues email via the transactional email system when `email_notify` is true

### Navigation:
- Add "Alerts" to sidebar nav
- Add AlertBell to AppLayout header

---

## Execution Order

1. Fragmentation Heatmap (frontend only)
2. Minutes Diff (edge function + component)
3. Taylor Rule (edge function + component)
4. OIS Overlay (edge function + chart)
5. Alert System (auth + DB + email + UI)

**Total: ~18 new files, ~6 modified files, 4 new edge functions, 1 DB migration, auth implementation.**

