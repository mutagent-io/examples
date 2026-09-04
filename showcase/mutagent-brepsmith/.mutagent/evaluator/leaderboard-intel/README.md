# CadGenBench baseline task splits

Per-task score split for the 10 VALIDATED "HF Baseline with Build123d" leaderboard entries
(submitter: HuggingFace), extracted 2026-08-25 from the public dataset
`HuggingAI4Engineering/cadgenbench-submissions` (results.jsonl + reports/<submission_id>.json).
All 10 entries: validation_status=validated, status=completed. For every entry the report's
run_summary agreed exactly with the results.jsonl row.

| # | Name | Aggregate | Gen mean | Edit mean | Gen n (valid) | Edit n (valid) | Gen validity | Edit validity |
|---|------|-----------|----------|-----------|---------------|----------------|--------------|---------------|
| 1 | Claude Fable 5 | 0.4514 | 0.3728 | 0.5718 | 49 (49) | 32 (29) | 1.0000 | 0.9062 |
| 2 | GPT-5.5 Pro | 0.3871 | 0.3208 | 0.4886 | 49 (45) | 32 (26) | 0.9184 | 0.8125 |
| 3 | Claude Opus 4.7 | 0.3691 | 0.2987 | 0.4768 | 49 (49) | 32 (27) | 1.0000 | 0.8438 |
| 4 | GPT-5.5 | 0.3596 | 0.2971 | 0.4553 | 49 (45) | 32 (26) | 0.9184 | 0.8125 |
| 5 | Claude Opus 4.8 | 0.3451 | 0.2738 | 0.4543 | 49 (49) | 32 (29) | 1.0000 | 0.9062 |
| 6 | Gemini 3.1 Pro | 0.3106 | 0.2115 | 0.4624 | 49 (37) | 32 (26) | 0.7551 | 0.8125 |
| 7 | Claude Opus 4.6 | 0.3092 | 0.2357 | 0.4219 | 49 (45) | 32 (27) | 0.9184 | 0.8438 |
| 8 | Claude Sonnet 4.6 | 0.2830 | 0.2207 | 0.3784 | 49 (43) | 32 (25) | 0.8776 | 0.7812 |
| 9 | Gemini 3.1 Flash-Lite | 0.2489 | 0.2238 | 0.2872 | 49 (47) | 32 (28) | 0.9592 | 0.8750 |
| 10 | GLM-4.6V | 0.1831 | 0.1638 | 0.2127 | 49 (47) | 32 (25) | 0.9592 | 0.7812 |

Full records (including submission ids, timestamps, per-task n_invalid/n_missing) in
`baseline-task-splits.json`.
