#!/bin/bash
# one test file in the sandbox; prints the summary and the failing test names (spec or TAP reporter)
# WORK: the work tree whose test/<name>.test.mjs runs; NODE: the node binary (default: node on PATH).
# Output: out-<name>-<node version>.txt next to this script (OUTDIR overrides).
W=${WORK:?set WORK to the work tree}
V=$("${NODE:-node}" --version)
out="${OUTDIR:-$(dirname "$0")}/out-$1-$V.txt"
bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp env -u TMPDIR setsid -w "${NODE:-node}" --test "$W/test/$1.test.mjs" > "$out" 2>&1
echo "== $1 [$V]: exit $? $(grep -E '^(ℹ|#) (pass|fail) ' "$out" | tr '\n' ' ')"
grep -E '^✖|^  ✖|^not ok|^    not ok' "$out" | head -20
