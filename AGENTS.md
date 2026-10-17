# Architecture rules

- Group named same-day speech copies only for evidence-ledger presentation, prefer the original publisher, and retain each copy's evidence and score; this avoids duplicate-looking rows without rewriting scoring or stored history.
- Keep meeting-statement taxonomy in analysis_cache, separate from policy_dimensions scoring metadata; this prevents taxonomy writes and scoring refreshes from overwriting each other.
- Share taxonomy statement selection and validation between the page and edge function; this keeps document eligibility and completion counts consistent.
- Share monthly index calculation between charts and CSV exports, but have the export read the full stored history (getIndexHistoryItems, back to 2015) independently of the chart window and of the pages' two-year load; this prevents display and load limits from truncating downloads.