# MonPol IQ — notes for Claude Code

MonPol IQ scores Fed and ECB communications as hawkish/dovish and aggregates them into a stance
index. Frontend: React + Vite + shadcn (src/). Backend: Supabase edge functions (Deno) in
supabase/functions/. The project was built with Lovable and syncs with GitHub.

## Scoring rules (do not break)

- Communications are scored by a frozen, deterministic scorer:
  supabase/functions/_shared/frozen-scorer.ts + frozen_scorer_bundle.json + frozen_decision_bundle.json.
  **Never edit, reformat or regenerate these files.** Any change alters scores.
  A deliberate model change means a new bundle version and a full history rescore.
- Rate-decision documents (FOMC statement, ECB "Monetary policy decisions"; see isDecisionDoc() in
  sentiment-analysis/index.ts) are scored as action + words (decision-v1.0): the decision is read from
  the text and sets the base score; the other sentences, normalised on the statement genre, move it.
  All other documents use the general scorer, whose output is unchanged by the decision layer.
- Surveys (bank lending, loan officer, consumer expectations, SAFE, monetary analysts) go to the
  statistical channel on both the Fed and ECB side (shouldReclassifyAsStatistical()).
- AI-found member remarks (sources 'GC Member Remark' / 'Fed Official Remark') come from a model that recalls
  them from memory, so they can be invented. They are scored on real text only after verification
  (_shared/remark-sources.ts): a published article that names the speaker, matches the headline and quotes
  them on policy. The scored text is the speaker's attributed sentences, stored in policy_dimensions.source_text,
  with the result in policy_dimensions.source_resolution. Unverified remarks keep the AI summary, get no URL and
  are marked verified:false. Never score a remark from an unverified URL. Admin mode: resolve-remarks.
- Gemini (LOVABLE_API_KEY) is allowed ONLY for: scraping/discovery (member-remark search,
  cross-language dedup, ECB URL fallback) and SEP projections (isSepDoc path + SEP delta scoring).
  Never route other communications to scoreWithGemini().
- The Predictions page functions (monetary-intelligence, multi-horizon, pivot-probability, market-futures) use
  the Claude API through _shared/claude.ts (secret ANTHROPIC_API_KEY): forecasting only, never scoring.
  market-futures takes market-implied probabilities only from published pricing found by web search (sources
  returned in web_sources); when none is found they stay null, never estimated. Cached 4h in analysis_cache.
- Committee members (Committee/Speakers pages, speaker analytics) come from src/data/committee-roster.ts
  (verified roster with dates). Update it when a member changes; departed members keep an `until` date.
- Items Layer 1 marks 'operational' (policy_dimensions.relevance) are never scored: they stay at 0, are
  skipped by the frozen backfill, are not speaker-calibrated and do not count in speaker baselines.
- Do not change weights, tiers, decay, the 10% speaker cap or the policy anchor
  (supabase/functions/_shared/scoring-weights.ts, src/lib/scoring-weights.ts).
- After every Fed/ECB decision, record its bps in src/data/meeting-schedule.ts AND POLICY_ACTIONS in
  _shared/scoring-weights.ts (data, not weights): they feed the policy anchor and the rate facts in the
  predictions prompt (currentPolicyRate()). Predictions, alerts and the Dashboard all read publishedIndex().
- SCORER_MODE secret: shadow | frozen | frozen-only | ai. MEMBER_SOURCE: bis (default) | both | ai | off.
  Member communications come from BIS speeches (real URL, full text) and, for the FED, presidents' speeches
  on the regional banks' own sites (_shared/fed-speeches.ts), kept only if by the bank's current president
  (configured by name per bank; New York/Dallas/SF lists only reach the president's speeches). Fed-site import:
  a few pages per bank per scrape, rejections remembered in analysis_cache 'fed-speech-skip', admin preview
  fed-speeches-report, runs only when the secret FED_SITE_SPEECHES=on. When a president changes, update
  FED_SPEECH_SOURCES and delete that bank's 'fed-speech-skip' rows.
- Bundesbank feed ('Bundesbank Speech', _shared/bundesbank.ts): kept only if English and by the Bundesbank
  President (BUNDESBANK_PRESIDENT; update when it changes). His items come from this feed; the BIS path adds
  his speeches only when the Bundesbank has no English copy (German-only there, English on BIS; sameTitle()).
  German-only items without an English version stay out: the frozen scorer is English-only. Admin check for
  stored rows: bundesbank-check.
- Only rate-setters count. ECB: Governing Council (Executive Board + euro-area NCB governors). FED: Board +
  regional presidents in a year their bank votes (fomcVoterBanks(): New York always, others by the fixed
  rotation, judged by the speech date; applies to BIS and Fed-site speeches).
- The AI remark search (MEMBER_SOURCE 'ai'/'both') recalls from memory and returned 2024 news with 2026
  dates; keep it off unless verified sources are required.
  ADMIN_EMAILS: comma-separated emails allowed to run maintenance modes.
- sentiment-analysis has verify_jwt = false: any mode that writes data must check isAdminRequest().

## Checks before any commit

npx tsc -p tsconfig.app.json --noEmit && npm run build && npx vitest run
deno check supabase/functions/sentiment-analysis/index.ts   (no errors)
deno run --allow-read supabase/functions/_shared/tests/member_sources_test.ts   (14/14)
deno run --allow-read supabase/functions/_shared/tests/decision_test.ts         (62/62, hold, general unchanged)
deno run --allow-read supabase/functions/_shared/tests/remark_sources_test.ts   (20/20)
deno run --allow-read supabase/functions/_shared/tests/source_probe_test.ts     (9/9)
deno run --allow-read supabase/functions/_shared/tests/fed_speeches_test.ts     (32/32)
deno run --allow-read supabase/functions/_shared/tests/bundesbank_test.ts       (14/14)
