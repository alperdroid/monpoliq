# MonPol IQ — notes for Claude Code

MonPol IQ scores Fed and ECB communications as hawkish/dovish and aggregates them into a stance
index. Frontend: React + Vite + shadcn (src/). Backend: Supabase edge functions (Deno) in
supabase/functions/. The project was built with Lovable and syncs with GitHub.

## Scoring rules (do not break)

- Communications are scored by a frozen, deterministic scorer:
  supabase/functions/_shared/frozen-scorer.ts + frozen_scorer_bundle.json.
  **Never edit, reformat or regenerate these two files.** Any change alters every score.
  A deliberate model change means a new bundle version and a full history rescore.
- Gemini (LOVABLE_API_KEY) is allowed ONLY for: scraping/discovery (member-remark search,
  cross-language dedup, ECB URL fallback) and SEP projections (isSepDoc path + SEP delta scoring).
  Never route other communications to scoreWithGemini().
- Do not change weights, tiers, decay, the 10% speaker cap or the policy anchor
  (supabase/functions/_shared/scoring-weights.ts, src/lib/scoring-weights.ts).
- SCORER_MODE secret: shadow | frozen | frozen-only | ai. MEMBER_SOURCE: both | bis | ai | off.
  ADMIN_EMAILS: comma-separated emails allowed to run maintenance modes.
- sentiment-analysis has verify_jwt = false: any mode that writes data must check isAdminRequest().
- Two type errors in sentiment-analysis/index.ts predate this work (stance_adjustments,
  PromiseSettledResult .value). Leave them unless asked.

## Checks before any commit

npx tsc -p tsconfig.app.json --noEmit && npm run build && npx vitest run
deno check supabase/functions/sentiment-analysis/index.ts   (expect only the two old errors)
deno run --allow-read supabase/functions/_shared/tests/member_sources_test.ts   (14/14)
