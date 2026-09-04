# CARlo ⑤ OPTIMIZE — thinkingLevel MEDIUM arm (addendum, 2026-08-26)

Same 30-task sample, same CARLO_MINIMAL=1 build, only `CARLO_THINKING_LEVEL=MEDIUM`.

## Result: **MEDIUM loses the gate — the thinking level IS the win**

| Pass^3 | MEDIUM | HIGH | baseline |
|---|---|---|---|
| base | 8/12 | 8/12 | 9/12 |
| hallucination | 5/11 | **8/11** | 5/11 |
| disambiguation | 3/7 | **4/7** | 3/7 |
| **overall** | 0.533 | **0.667** | 0.567 |

- MEDIUM gives back ALL of HIGH's hallucination gains (8/11 → 5/11 = exactly baseline) and the
  disambiguation edge. Base unchanged (8/12 both).
- Independent replication of Thylinao's claim: high reasoning effort is what removes
  hallucination/wrong-action flakiness; the harness alone doesn't.
- Cost: MEDIUM $14.58 vs HIGH $19.77 — only ~26% cheaper (prompt tokens dominate, thinking is
  the minority share), for a 4-task loss. HIGH is strictly the better $/point.
- Spend cutoff was ENFORCED this run (monitor priced traces live, $15 kill switch); finished at
  $14.51 without triggering. Cumulative ADL spend **$153.85**.

## Disposition
CARlo-minimal + thinkingLevel HIGH is the confirmed candidate. Next gate: full-train confirm
(129×3, one arm, ≈$85 est at $0.219/session, cutoff $95) — operator approval required.
