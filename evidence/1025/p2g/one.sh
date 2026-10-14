#!/bin/sh
# One test file as the root run starts it (its own temporary directory, by the runner's preload), in the
# sandbox. Prints what it left in its directory (@@LEFT, what the guard reads) and what it made
# outside it, in the sandbox's /tmp (@@OUTSIDE, what the guard cannot see).
# usage: one.sh <node> <tree> <absolute test file>
node=$1; tree=$2; file=$3
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp \
  env -u TMPDIR -u TMUX_TMPDIR sh -c '
    run=$(mktemp -d /tmp/ot-XXXXXX)
    OATS_TEST_RUN_DIR=$run setsid -w "$1" --test "--import=$2/scripts/test-file-tmpdir.mjs" "$3"; code=$?
    echo "@@FILE $(cat $run/0.file 2>/dev/null)"
    echo "@@LEFT $(ls -A $run/0 2>/dev/null | tr "\n" " ")"
    echo "@@OUTSIDE $(ls -A /tmp | grep -v "^$(basename $run)\$" | tr "\n" " ")"
    echo "@@RUN $(ls -A $run | tr "\n" " ")"
    exit $code' sh "$node" "$tree" "$file"
