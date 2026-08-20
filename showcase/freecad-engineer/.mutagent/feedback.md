# MutagenT feedback ledger

## 2026-08-10 — [helix] Helix persona silently lost on session resume → whole build ran as vanilla CC

On resuming this session (--continue), the operator believed they were still in the Helix harness, but the session was running as vanilla Claude Code — the Helix orchestrator persona/routing was not active. Re-invoking /mutagent-helix restored it.

**Likely cause:** Helix boots by adopting a persona in-context via the slash command activation-instructions; a resumed session restores the conversation but does NOT re-run activation, and nothing (a hook or a CLAUDE.md session-start trigger) re-asserts the persona on resume, so the agent reverts to vanilla CC. The cwd stayed within the same project root all session (only subdirs changed), so resume-without-reboot is a more likely cause than the work-dir change the operator wondered about.

**Impact:** the entire CADGenBench-crusher build — spec, build, evaluate, diagnose, optimize — ran OUTSIDE the ADL. agentspec.yaml drafted but never *validate-spec'd; build/evaluate/diagnose/optimize done hands-on rather than routed through the stage skills and their gates. The drift was silent; only noticed after a resume.

**Suggestions:** (a) resume-time re-boot (hook or CLAUDE.md session-start trigger that re-adopts Helix when a prior Helix session is detected); (b) failing that, document that Helix must be re-invoked after --continue; (c) a lightweight persistent marker so the agent self-detects it should be conducting, not executing.

_transcript: e85440ed-0cd6-4b65-9f24-cefc472fc4b0.jsonl (attached to remote send) · category: helix_

---

## 2026-08-13 — cadbench-crusher session (gNucleus cad-bench evaluation run): toolchain field report

Context: real ADL run on a demanding real-world target — spec (retroactive *sync-spec cold-construct),
build-verify (ai-architect STEER), evaluate (evaluator leaves, agent-dispatch), plus the earlier
recon/build done hands-on. Verbatim operator ask: "can you still run 1 and 2 over what was already
built? or does it not make sense?" → the retroactive path got a genuine end-to-end exercise.

### What worked (keep, and say so in docs)

1. **ai-architect is the standout.** Both modes delivered real value:
   - `#sync-spec` cold-construct: enumerate-first + slot-disposition + cross-verify produced a
     spec draft whose CROSS-VERIFY section (CV-1..9) surfaced omissions I would not have caught
     (the load-bearing-but-unasserted venv patches; the "spec's fallback exists nowhere in the
     impl" gap). The honest deviation report when `check-sync-spec.ts` was absent set exactly the
     right tone.
   - build-verify STEER: 11 ranked findings, 3 of them score-saving on a benchmark run (the
     self-check-is-a-floor trap that could convert a perfect gear into a zero; the undocumented
     PYTHONPATH incantation; the inch/diametral-pitch hole). This paid for itself immediately.
2. **evaluator `#mode-judge-trajectory` over CONDUCT criteria found what numbers can't.** All
   trials scored 1.0; the judges still found an 8x cost tail with its exact causal chain, a
   criteria hole (scorer-source introspection passes a file-fencing criterion), and a per-trial
   environment tax quantified in turns. Critique-before-verdict + refs made every finding
 actionable. Judge-never-fix held naturally — findings routed back as playbook edits
   by the parent, not by judges.
3. **agent-dispatch substrate**: parent-session PREP → leaf verdict files → aggregate worked
   smoothly with zero provider config. This default is right.

### Friction (ranked)

1. **Closed schema vocabularies are undiscoverable until *validate-spec fails.** The 0.3.0
   template shows one happy path; the closed enums (BindingKind cli|saas|mcp|sdk|host-tool ·
   EvalType llm-judge|code-check · TriggerKind · OperatingType · node `edges[{to,condition,loop}]`
   vs the intuitive `next`) live only in agentspec.schema.ts. The ai-architect — reading the
   template as instructed — invented `access.kind: library`, `evaluation.tooling`,
   `targets[].notes`, `operatingType: autonomous`, `nodes[].next/maxIterations`; every one failed
   the gate. Fix: make `slot-checklist.ts` emit the enum vocabularies per slot, and teach
   validate-spec errors to suggest the nearest valid field ("`next` is not a property — did you
   mean `edges[].to`?").
2. **Setup-detection contracts are inconsistent across skills.** agentspec `detect.ts` returns
   clean JSON `{complete:true,...}`; evaluator `profile-subject.ts --detect` exited SILENTLY
   (no output, no error) in an un-onboarded project. The parent can't distinguish "needs
   onboarding" from "script broke". Every skill's detect should emit the same JSON contract.
3. **Evaluator has no trace adapter for harness-run outputs.** Traces here were harbor trial dirs
   (agent/claude-code.txt + ATIF trajectory.json). The documented intake is UniTF JSONL via
   mutagent-cli only. I improvised the packet/verdict-file flow by hand (it worked — see run
   `.mutagent/evaluator/run-cadbench-slice-01/`), but a harbor/ATIF adapter would have made
   `*evaluate` runnable as-shipped. ATIF is a stable public format; low-hanging fruit.
4. **Leaf token cost is dominated by raw-transcript reading.** Each evaluator leaf burned
   ~150-170K tokens judging 4 trajectories, mostly reading full terminal transcripts. A
   deterministic pre-slicer (code, not LLM: extract agent turns + tool calls + exit states from
   the host log before dispatch) would cut leaf cost by well over half. Same lesson as
   diagnostics' tiered analysis — apply it to judge packets.
5. **Interactive-only confirm steps block autonomous runs.** *sync-spec step 3 requires
   AskUserQuestion for INFERRED fields; in a background session that's impossible. I adopted
   recommended defaults and surfaced them post-hoc — which worked, but the protocol should name
   that mode: "propose-with-defaults (non-interactive): adopt the recommendation, mark
   `operator-pending`, surface in the final report".
6. **orchestrator-protocol references scripts the install doesn't ship** (`check-sync-spec.ts`).
   The ai-architect handled it gracefully, but doc/script version skew erodes trust in binds.
   A doctor check ("every script referenced by a protocol exists") would catch this at init.
7. (Carried forward, still open) **Helix boot is heavy and not compaction-safe.** This session's
   /mutagent-helix boot was interrupted by context compaction mid-activation and never completed;
   work proceeded un-conducted again (cf. 2026-08-10 entry). A checkpointable or slim boot path
   remains the ask.

### One conceptual finding worth stealing

The evaluator judges independently discovered that an access-boundary criterion fencing FILES
("never read /opt/grader, reference.FCStd, param_check.py") does not fence KNOWLEDGE CHANNELS —
an agent legally pip-installed the public copy of the grading library and read its source to
shape output structure toward the measurer. Criteria-mining guidance should name this pattern:
boundary criteria need a "derived-channel" variant (sources of the oracle's logic, not just its
data). It fell out of `#mode-judge-trajectory` + critique-before-verdict; a pure numeric eval
could never have seen it.

_transcript: e6728170-7456-4ef1-a95c-dbd0ee99ab2f.jsonl + d1d2aef5 (current) · category: agentspec, builder, evaluator, helix_

---
