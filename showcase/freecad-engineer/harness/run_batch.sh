#!/bin/bash
# Full-suite batch driver. Runs the next BATCH_SIZE tasks that do not yet have a
# clean completed trial (reward.json present) in any of the given DONE_JOBS.
#
# Usage: run_batch.sh BATCH_NAME [BATCH_SIZE]
#   Honors EFFORT / N from run_slice.sh (N<=2 enforced there).
set -euo pipefail
cd "$(dirname "$0")/.."

BATCH_NAME=$1
BATCH_SIZE=${2:-25}
# Jobs whose completed trials count as done (clean logs only — post-scrubber-patch).
DONE_JOBS=${DONE_JOBS:-"slice-dev2 slice-dev2-rerun"}

declare -A done
mark_done() {
    # A trial counts as done only when the verifier actually scored an answer
    # (score > 0). Interrupted/zero trials are re-run.
    local r=$1
    [ -f "$r" ] || return 0
    python3 - "$r" <<'PYEOF' || return 0
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if float(d.get("score") or 0) > 0 else 1)
PYEOF
    local t
    t=$(basename "$(dirname "$(dirname "$r")")" | cut -d_ -f1)
    done[$t]=1
}
for j in $DONE_JOBS; do
    for r in jobs/$j/freecad-*/verifier/reward.json; do mark_done "$r"; done
done
for j in jobs/batch-*/; do
    [ -d "$j" ] || continue
    for r in $j/freecad-*/verifier/reward.json; do mark_done "$r"; done
done

todo=()
for d in tasks/cad-bench/freecad-*/; do
    t=$(basename "$d")
    [ -z "${done[$t]:-}" ] && todo+=("$t")
done

echo "done: $((100 - ${#todo[@]}))/100 — remaining: ${#todo[@]}"
[ ${#todo[@]} -eq 0 ] && { echo "all tasks have clean trials"; exit 0; }

batch=("${todo[@]:0:$BATCH_SIZE}")
echo "launching ${#batch[@]} tasks as $BATCH_NAME: ${batch[*]}"
exec harness/run_slice.sh "$BATCH_NAME" "${batch[@]}"
