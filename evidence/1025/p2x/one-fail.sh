#!/bin/sh
# One test file as the root run starts it, in the sandbox, with failures injected (probe/inject-fail.mjs):
# from assertion number $4 on, every assertion throws. Prints what the file left and made outside.
# usage: one-fail.sh <node> <tree> <absolute test file> <after>
node=$1; tree=$2; file=$3; after=$4
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp \
  env -u TMPDIR -u TMUX_TMPDIR INJECT_FAIL_AFTER="$after" sh -c '
    run=$(mktemp -d /tmp/ot-XXXXXX)
    OATS_TEST_RUN_DIR=$run setsid -w "$1" --test "--import=$2/scripts/test-file-tmpdir.mjs" "--import=/var/tmp/okd-fi/probe/inject-fail.mjs" "$3"; code=$?
    echo "@@LEFT $(ls -A $run/0 2>/dev/null | tr "\n" " ")"
    echo "@@OUTSIDE $(ls -A /tmp | grep -v "^$(basename $run)\$" | tr "\n" " ")"
    exit $code' sh "$node" "$tree" "$file"
