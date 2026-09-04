# Thylinao (team-28) report mined — "Reliability Engineering for Pass³ Tool Use on CAR-bench Track 1"
Author: Maksim Silchenko · Gemini 3.5 Flash · rank 2/21 · source: car-bench.github.io/reports/track_1/team-28.pdf
Public submission repo: https://github.com/thylinao1/car-bench-track1-submission

## Headline numbers (theirs)
- FULL TRAIN (129 tasks × 3 trials, faithful 3.5 simulator): **Pass³ 0.802** — base 86.0 (43/50),
  hallucination 77.1 (37/48), disambiguation 77.4 (24/31).
- Held-out public test (single pre-registered read): **78.0** (base 88, halluc 70, disamb 76).
- Hidden set (official): 0.667. Cost **$0.169/episode** (Vertex-logged).
- vs our corpus: our raw-flash train baseline 0.566, CARlo 0.388 — but see fidelity gaps below.

## The recipe (ALL of it — deliberately minimal)
1. **Greedy decoding**: temperature=0. Starter agent leaves temp unset → per-trial sampling
   variance that Pass³ punishes directly. Pitfall: LiteLLM's Gemini-3.x param mapper raises on
   env-var strings (`value < 1.0` compare) — AGENT_TEMPERATURE must be coerced to float.
2. **Live-schema guard** (ported from public CAReful agent, gmsh/car-bench-exp-agent): every
   turn, before dispatch, validate each call against the *per-task* schema the evaluator sends —
   tool name exists, arg keys declared, all required present. On violation inject a
   capability-unavailable observation and retry in-turn; repeated violation strips the calls.
   Retry budget 4 sequential LLM calls per action decision. Compliance rule: absence reported as
   capability-absence, NEVER "removal-detection"; emits official names only; never reasons about
   reward/scorer. Held-out effect: corrected 14 parameter-schema violations across 375 episodes,
   all resolved by in-turn retry. Guard adds +8.3 Pass¹ under faithful 3.5 simulator.
3. **Agent-model upgrade 2.5→3.5-flash = the DOMINANT lever** (their words): removes most
   hallucination, wrong-action, ask-vs-act errors outright.
4. **One general behaviour skill** (single split-agnostic instruction block prepended to host
   system prompt; byte-identical otherwise) + **HIGH reasoning effort**. Rules (all general,
   never task-type- or removed-tool-conditional):
   - name the intended action and each parameter value before a confirmation-required tool call
   - metric units and 24-hour times everywhere, including inside tool arguments
   - act on exactly what was asked
   - report an unavailable capability as capability-absence rather than as a removed tool
   High reasoning effort "stabilises an otherwise-flaky multi-step disambiguation task";
   thinking is only 2.4–11.2% of episode tokens (85.8% is cacheable prompt).

## Negative results — the prompt-interference tax (≈ our GATE FAIL in miniature)
- A **policy-cascade rule** passed its targeted probes (2/3→9/9) and neighbor sweep (27/27),
  then FAILED the full split: +1 target, −5 unrelated previously-passing tasks (four of them
  tasks the rule cannot even fire on). Reverted.
- A minimal one-bullet variant: halluc 77.1→75.0. Reverted.
- Conclusion (theirs): "added prompt text degrades rules it never touches, invisibly to
  targeted probes" — targeted probes are structurally blind to it. Only full-split
  re-measurement catches it. **Once a strong agent is available the model choice dominates,
  and the marginal wins move to variance reduction, where admission gates earn their cost.**

## Gated admission discipline (per candidate change)
mechanism probe (8 trials) → neighboring-task sweep → fixed cross-split regression gate →
re-measure ENTIRE training split ×3 (frozen floor must hold on every split). Run-to-run noise
on frozen config ≈ 1 task/split; cannot-be-shown-safe ⇒ treated as unsafe.

## ⚠ Evaluation-fidelity pitfalls that affect OUR corpus
1. **Simulator/judge model era**: official Track-1 evaluator locks user-sim AND policy judge to
   **gemini-3.5-flash**. Our runs used **gemini-2.5-flash** for both. The 2.5-flash simulator
   scores the same agent ~25 points HIGHER on hallucination than the faithful 3.5 one.
2. **Provider route**: vertex_ai/gemini-3.5-flash (global) is a *different, more lenient*
   snapshot than AI-Studio gemini/gemini-3.5-flash for the simulator/judge role (halluc Pass¹
   37.5→62.5 on their 8-task probe just by flipping the simulator route). They run the sim/judge
   on the gemini/ route; agent on Vertex is fine (route-parity verified for the agent).
   → Our baseline-vs-CARlo comparison is internally consistent (same sim both arms; GATE FAIL
   stands), but our ABSOLUTE numbers are not comparable to Thylinao/official references, and
   likely inflated on hallucination.
3. Their four-class failure taxonomy for Pass^k forensics: (i) capability ceiling (fails under
   stronger model too — not a tuning target), (ii) agent-side sampling variance (legit target),
   (iii) judge-sampling variance at genuine policy conflicts (bounds Pass³ from above; cannot
   tune without gaming the judge), (iv) ungraded trials (infra). "Distinguishing (ii) from (iii)
   is the single most useful discipline for working against a Pass^k metric."
4. Benchmark's planning tool is penalty-free scratchpad; stripping it projected −30-44% latency
   on disambiguation but was unshipped (unvalidated).

## Implications for CARlo ⑤ OPTIMIZE
- CARlo-minimal ablation = essentially Thylinao's recipe: temp0 + live-schema validate/retry
  (budget ~4) + capability-absence observation + the 4 behaviour bullets + HIGH thinking.
  CARlo currently runs thinkingBudget 0 — their evidence says high effort is a key stabiliser
  (esp. disambiguation, our worst family) at only ~2-11% token overhead.
- Kill list (prompt/pipeline-interference tax): policy pre-check, redirects, prose gates,
  verify escalation, six-gate chain.
- Fix eval fidelity BEFORE the next A/B: sim+judge → gemini-3.5-flash, ideally on gemini/
  route (needs GEMINI_API_KEY — currently Vertex-only by design; decision for operator).
