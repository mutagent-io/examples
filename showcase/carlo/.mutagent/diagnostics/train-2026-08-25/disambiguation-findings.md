# DISAMBIGUATION family — why CARlo regresses (0.258 vs 0.484 Pass^3)

Run: train-2026-08-25 · 31 tasks × 3 trials (CARlo) · baseline raw-flash deduped to 3 trials/task.
Recomputed from checkpoints: **CARlo Pass^3 = 8/31 = 0.258**, **baseline = 15/31 = 0.484**, Δ = −0.226.
Regression set (baseline 3/3, CARlo <3/3) = the 10 tasks given. CARlo-only wins = `disambiguation_24`,
`disambiguation_36`, `disambiguation_52`.

Trial accounting over the 10 regression tasks: **20 of 30 CARlo trials lost**.

## Taxonomy

| # | Class | Mechanism | Tasks | Trials lost | Harness-caused? |
|---|---|---|---|---|---|
| 1 | (d) wrong end keyword — canned refusal | `feasibility` gate `block/capability-absent` → route `honest-limit`, **0 LLM calls**, emits a fixed "I can't control X in this car" string; bench scores `end_conversation_keyword=OUT_OF_SCOPE` | `_10`, `_44` | **6** | YES — pure gate |
| 2 | (b)+(e) under-asking / acted before asking | `ambiguity` gate `replan` (`internal-resolution-available`) pushes "resolve internally, don't ask"; agent applies a choice the bench required it to offer, or opens a menu that derails the turn budget | `_46`, `_28` | **5** | YES — gate pressure |
| 3 | (c) gate detected but did not enforce / replaced a correct step | `policy` gate `replan` `prerequisite-unsatisfied` with `accepted:false` (draft emitted unchanged) `_14`; `policy` `block/confirmation-required` injects its own confirm turn and the agent then drops its own status read `_20` | `_14`, `_20` | **4** | YES — gate |
| 4 | (f) model variance the harness neither caused nor caught | spurious extra action `_0`; wrong internal level guess `_18`; prose claims an action never called `_30`; omitted required "temp diff >3 °C" notice `_38` | `_0`,`_18`,`_30`,`_38` | **5** | NO |

Family-wide gate firings (all 31 disambiguation tasks, 93 traces):
`ambiguity/replan` **168** · `feasibility/block:capability-absent` **57** · `policy/replan` **17** ·
`feasibility/block:prose-fabrication` 5 · `policy/block:confirmation-required` 4 ·
`ambiguity/block:ungrounded-argument` 2 · `args/replan:empty-step` 2.

## Root causes, ranked by trials lost

### RC-1 — feasibility gate emits a canned OUT_OF_SCOPE refusal for capabilities that exist (6 trials, 2 tasks)

The gate keyword-matches nouns in the user utterance against the tool-name inventory and blocks
*before drafting*. `exterior` and `weather` are not substrings of any tool name — but
`set_head_lights_low_beams` and `get_weather` are both in the 57-tool inventory it just logged.

`disambiguation_10`, turn 0, all 3 trials (trace `c239988e-…jsonl`):

```
gate  {"gate":"feasibility","verdict":"block","code":"capability-absent",
       "terms":["exterior"],"note":"prose-channel absence acknowledged BEFORE drafting (R4b proactive)"}
emit  {"route":"honest-limit","passes":0,"llmCalls":0,
       "text":"I can't control the exterior in this car — that function isn't available to me.
               I can check the user preferences or calculate math instead, if that helps."}
```
Reward: `r_tool_subset 0` (missing `set_head_lights_low_beams`), `r_user_end_conversation 0`,
`end_conversation_keyword = OUT_OF_SCOPE`. Conversation over in one turn.
**Baseline instead:** `get_exterior_lights_status()` → `set_head_lights_low_beams(on=false)` → done. 3/3.

`disambiguation_44` (trace `947f14b7-…jsonl`) fires the same block **3× per trial** (turns 0, 5, 6 on
terms `weather`, `weather+time`). The user explicitly corrects it — *"Oh, no, I don't want to control
the weather!"* — and the gate blocks again two turns later, so `get_weather` and `send_email` are never
called. Note the gate short-circuits the LLM entirely (`llmCalls: 0`), so the model never gets the
chance to notice `get_weather` exists.

### RC-2 — ambiguity gate suppresses the clarifying turn the bench requires (5 trials, 2 tasks)

`ambiguity/replan` reports `unqueried` info tools that are irrelevant to the domain
(`get_entries_from_calendar`, `get_contact_information`, `get_contact_id_by_contact_name` offered as a
way to resolve *which headlights* or *which fan speed*), and injects a "do not ask the driver yet"
instruction. Verbatim, from `disambiguation_20` trial 2's own `think` call:

```
"the prompt says: Do not ask the driver yet. These information tools are still available and unused:
 get_entries_from_calendar, get_contact_information, get_contact_id_by_contact_name. If any of them
 could resolve the missing detail, call it now with valid arguments instead of asking."
```

`disambiguation_46` (all 3 trials): the task says *"If the assistant proactively chooses a route
option, stop the conversation."* CARlo calls
`navigation_replace_final_destination(route_id="rll_rig_ber_135541" /* A74, fastest */)` **before**
presenting options, then narrates the alternatives afterwards. `r_actions_final 1.0` but
`r_actions_intermediate 0.0` → reward 0. Gate at turn 8/9: `ambiguity/replan … askedAnyway:true`.

`disambiguation_28` (trials 1, 2): the replan turns the single question into a menu — *"I can turn it
on, or we can open a window or the sunroof. What would you prefer?"* — costing a turn; the agent then
sets fan level 1 and the follow-up "+2 levels" lands on **3** instead of the expected **2**.
**Baseline** asked one focused question and set level 2 directly. 3/3.

### RC-3 — policy gate: prerequisite detected but not enforced; injected confirmation replaces a needed read (4 trials, 2 tasks)

`disambiguation_14`, all 3 trials (`8d71532d-…`, turn 3):

```
gate {"gate":"policy","verdict":"replan","redraftedFor":"open_close_window",
      "redraftedTo":[{"tool":"get_vehicle_window_positions","arguments":{}}],
      "accepted":false,"because":"policy requires \"open_close_window\" before \"set_window_defrost\""}
emit {"findings":["policy:prerequisite-unsatisfied"],
      "toolCalls":["set_window_defrost","set_fan_speed","set_air_conditioning"]}
```
The gate identified the exact missing prerequisite and then emitted the original draft anyway
(`accepted:false`). Result: `AUT-POL:011 … one or more windows are open more than 20% or fan speed is 0`,
missing `open_close_window` + `get_vehicle_window_positions`. In trial 1 the redraft came back as a
`think` in which the model argues *"there is no such policy"* — the gate's message is passed to the
model as if it were a user instruction, and the model rejects it. **Baseline** asked "front, rear, or
all?", used the extra turn to call `get_vehicle_window_positions`, saw 50/50/25/100 % open and closed
them. 3/3.

`disambiguation_20` trial 1 (`507d51f6-…`, turn 2): `policy/block:confirmation-required` replaces the
turn with `"Quick check before I do that: I'm about to run set_head_lights_high_beams with on true.
Should I go ahead?"`. After the user's "yes" the agent fires `set_head_lights_high_beams` immediately
and never calls `get_exterior_lights_status` → `AUT-POL:014 Fog lights not checked before activating
high beam headlights`. In the two passing trials the model made that read itself. The gate consumed
the confirmation turn the model was going to use for the status check.

### RC-4 — residual flash variance the gates do not catch (5 trials, 4 tasks)

Not harness-caused, but note the gate stack advertises a `prose-fabrication` check and still let
`disambiguation_30` trials 1–2 emit *"Since the fan speed was at zero, it's now automatically set to
level one"* with `toolCalls: []` and no prior `set_fan_speed` (missing tool → reward 0, plus
`AUT-POL:011`). The turn-5 gate that ran was `ambiguity/replan … askedAnyway:true`, which re-drafted
the text and passed the fabricated claim through.
Also: `_0` trial 1 injected a spurious `open_close_window(ALL, 50%)`; `_18` trial 1 set fan level 2
instead of 1; `_38` trial 2 omitted the required >3 °C zone-difference notice.

## The 3 CARlo-only wins — why

All three baseline failures are **LLM-judged prose-policy** misses, exactly what CARlo's policy/ambiguity
gates enforce:

- `disambiguation_24` (base 2/3): judge — *"redundant confirmation … should not be required if there is
  prior explicit user authorization."*
- `disambiguation_36` (base 1/3): judge — *"'open until 11 PM' uses a 12-hour format"* (policy demands
  24 h); other trial picked a category against a stored preference.
- `disambiguation_52` (base 1/3): judge — *"failed to inform the user about the overall fastest and
  shortest routes, and the number of other alternatives, before starting navigation."*

So the harness's contribution in this family is **prose/format policy discipline** (+3 tasks) and its
cost is **capability routing and ask/act routing** (−10 tasks).

## Verdict

The −0.226 gap is driven by **gate-inserted control flow, not by model quality**. 15 of the 20 lost
trials (6 of the 10 regressed tasks) trace to a specific gate decision:

1. **`feasibility` / `capability-absent` (RC-1) is the single dominant mechanism** — 2 tasks, 6 trials,
   and 57 firings family-wide. It fires pre-LLM on a noun-vs-tool-name string match and emits a fixed
   refusal, converting a solvable task into `OUT_OF_SCOPE` in one turn. It is unrecoverable inside the
   episode: the user's explicit correction does not clear it.
2. `ambiguity` / `internal-resolution-available` (RC-2) — 2 tasks, 5 trials. Same failure family as the
   already-retired groundedness gate, mirrored: it now errs toward *not* asking, and toward acting on an
   internally chosen option the bench required the agent to offer.
3. `policy` (RC-3) — 2 tasks, 4 trials. Its prerequisite replan is advisory only (`accepted:false`) and
   its injected confirmation consumes the turn the model needed for a status read.

**Would a minimal harness (schema-validate + retry + behavior rules, the Thylinao shape) have passed?**
- RC-1 tasks (`_10`, `_44`) — **yes**, certainly: the raw model solved both 3/3 and the only thing
  preventing it was the pre-draft block.
- RC-2 (`_46`, `_28`) and RC-3 (`_14`, `_20`) — **yes, likely**: baseline solved all four 3/3 with the
  same underlying model; the failures appear only in turns the gates rewrote.
- RC-4 tasks (`_0`, `_18`, `_30`, `_38`) — **no guarantee**: these are flash variance on the ask/level
  decision that a minimal harness would inherit (baseline happened to hit 3/3 on all four).

Removing the three gate mechanisms recovers 6 of 10 regressed tasks → projected Pass^3 ≈ **0.45**, i.e.
essentially back to the raw-Flash 0.484, while the +3 prose-policy wins are retained only if the
*textual* policy checks (format, must-announce, no-redundant-confirmation) survive as **post-hoc text
rules that never suppress a tool call, never block pre-draft, and never replace a turn**. That is the
recommended ablation: keep the prose-policy rewriter, delete the feasibility pre-draft block, delete the
ambiguity ask-suppression replan, and make the policy prerequisite check either enforcing or absent —
never advisory.
