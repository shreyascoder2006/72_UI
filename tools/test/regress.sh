#!/bin/sh
# Engine regression guard: the probes' output must not change.
#   sh tools/test/regress.sh <baseline dir>        write the baseline
#   sh tools/test/regress.sh <baseline dir> check  compare against it
# Timings are stripped, so only engine products are compared.
set -e
DIR="$1"; MODE="${2:-write}"
mkdir -p "$DIR"
run() { node "$2" $3 2>&1 | sed -E 's/[0-9]+(\.[0-9]+)? ?ms/TIME/g' > "$DIR/$1.new"; }
run engine-tropical tools/test/engine_probe.js tropical
run engine-flash    tools/test/engine_probe.js flash
run engine-heat     tools/test/engine_probe.js heat
run interventions   tools/test/interventions_probe.js
run analytics-raleigh tools/test/analytics_probe.js "--city raleigh"
run analytics-nagpur  tools/test/analytics_probe.js "--city nagpur"
rc=0
for f in "$DIR"/*.new; do
  b="${f%.new}.txt"
  if [ "$MODE" = check ]; then
    if diff -q "$b" "$f" >/dev/null 2>&1; then echo "ok   $(basename "$b")"; else echo "DIFF $(basename "$b")"; diff "$b" "$f" | head -20; rc=1; fi
    rm -f "$f"
  else
    mv "$f" "$b"; echo "wrote $(basename "$b")"
  fi
done
exit $rc
