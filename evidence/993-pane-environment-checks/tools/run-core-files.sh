#!/bin/bash
# The 30 files run at 602baa04, each on two binaries, one file per sandboxed invocation (never a batch).
# NODE22_BIN: the directory of a Node 22 binary (CI's major). It goes first on PATH for its runs:
# with another node first on PATH, golden-fixtures sees the kernel's "node path is not stable" warning.
# Usage: WORK=<work tree> NODE22_BIN=<dir> run-core-files.sh > runs.txt
D=$(cd "$(dirname "$0")" && pwd)
: "${WORK:?set WORK}" "${NODE22_BIN:?set NODE22_BIN}"
export OUTDIR=${OUTDIR:-$D}
for f in pane-environment launch-fix-texts client-own-codes unasserted-warnings fixture-expected-warning launch-preference launch-preference-unmatched harness-trust-write harness-trust-cli harness-trust-launch harness-trust harness-trust-metadata pane-path golden-fixtures cli-json-contract desktop-capability-warnings-kernel fixture-real-environment hook-events-forward-tolerant inspect-readiness launch-config launch-config-default launch-hook-preview launch-recipe native-harness-launch-policy operator-coverage pi-bridge pi-bridge-cli release-notes-entries session-inheritance session-start; do
  NODE=node "$D/t.sh" $f
  PATH="$NODE22_BIN:$PATH" NODE="$NODE22_BIN/node" "$D/t.sh" $f
done
echo "files with an 'oats: warning:' line (main's #1070 guard fails a root run on an unasserted one):"
grep -c "oats: warning:" "$OUTDIR"/out-*.txt | grep -v ":0$"
echo done
