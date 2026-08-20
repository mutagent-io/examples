#!/bin/bash
# Run a slice of cad-bench tasks with the claude-code agent on the operator's
# Claude subscription (OAuth), with the freecad-engineer agent definition appended to every instruction.
#
# Usage: run_slice.sh JOB_NAME TASK_NAME [TASK_NAME ...]
#   TASK_NAME: e.g. freecad-0603c53148 (glob ok). Use ALL to run the whole suite.
#   EFFORT=high|max (default high)   N=concurrency (default 2 — usage limits!)
set -euo pipefail
cd "$(dirname "$0")/.."

JOB_NAME=$1; shift
EFFORT=${EFFORT:-high}
N=${N:-2}

# Preflight: the two load-bearing local harbor-venv patches must be present
# (reward-json numeric filter; secret-scrub length guard). Without them runs
# die with ValidationError / ship digit-corrupted logs. See agentspec assumptions.
grep -q "keep only the numbers" .venv/lib/python3.12/site-packages/harbor/verifier/verifier.py \
    || { echo "FATAL: harbor verifier.py reward-json patch missing"; exit 1; }
grep -q "len(secret) < 8" .venv/lib/python3.12/site-packages/harbor/trial/trial.py \
    || { echo "FATAL: harbor trial.py secret-scrub patch missing"; exit 1; }

# Usage-limit guard: token spend is N-independent but burn rate is not; RAM
# supports ~4 containers (1-1.5GB each on this 15GB box). Operator raised the
# cap 2->4 on 2026-08-19 for the generalized-definition rerun.
[ "$N" -le 4 ] || { echo "FATAL: N=$N exceeds the concurrency<=4 usage-limit cap"; exit 1; }

# Fresh access token each launch — the one in credentials.json rotates.
TOK=$(python3 - <<'EOF'
import json, os, sys, time
c = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))["claudeAiOauth"]
tok, exp = c.get("accessToken", ""), c.get("expiresAt", 0)
if not tok:
    sys.exit("FATAL: no accessToken in credentials.json")
if exp and exp / 1000 < time.time() + 300:
    print("WARNING: OAuth access token expires in <5min; refresh by using claude once",
          file=sys.stderr)
print(tok)
EOF
)
[ -n "$TOK" ] || exit 1

INC=()
for t in "$@"; do
    [ "$t" = "ALL" ] && break
    name=$(basename "$t")
    # A typo'd id would become a filter that silently matches nothing.
    compgen -G "tasks/cad-bench/$name" >/dev/null \
        || { echo "FATAL: no task matches tasks/cad-bench/$name"; exit 1; }
    INC+=(-i "$name")
done

# Pre-baked agent binary: mounting the claude ELF makes harbor's version probe
# succeed and skip the ~4-6 min per-trial apt+download install. PREBAKE=0 disables.
MOUNTS=()
if [ "${PREBAKE:-1}" = "1" ] && [ -f harness/prebaked/claude ]; then
    MOUNTS=(--mounts "[{\"type\":\"bind\",\"source\":\"$PWD/harness/prebaked/claude\",\"target\":\"/usr/local/bin/claude\",\"read_only\":true}]")
fi

exec .venv/bin/harbor run \
    -p tasks/cad-bench "${INC[@]}" "${MOUNTS[@]}" \
    -a claude-code -m claude-opus-5 \
    --ak reasoning_effort="$EFFORT" \
    --ae CLAUDE_FORCE_OAUTH=1 \
    --ae CLAUDE_CODE_OAUTH_TOKEN="$TOK" \
    --extra-instruction-path harness/freecad-engineer.md \
    --agent-setup-timeout-multiplier 4 \
    -o jobs --job-name "$JOB_NAME" \
    -n "$N" -q -y
