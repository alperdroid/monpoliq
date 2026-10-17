# Architecture rules

- Group named same-day speech copies only for evidence-ledger presentation, prefer the original publisher, and retain each copy's evidence and score; this avoids duplicate-looking rows without rewriting scoring or stored history.
- Keep meeting-statement taxonomy in analysis_cache, separate from policy_dimensions scoring metadata; this prevents taxonomy writes and scoring refreshes from overwriting each other.
- Share taxonomy statement selection and validation between the page and edge function; this keeps document eligibility and completion counts consistent.
- Share monthly index calculation between charts and CSV exports, but export all loaded history independently of the chart window; this prevents display limits from truncating downloads.