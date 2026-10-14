#!/bin/sh
# The probe copies of the two server-starting files in their WAITING form, one run at a time, in the
# sandbox: desktop-server N times, desktop-cli-integration M times, on the given node.
# usage: wait-probes.sh <node> <tag> <N> <M>
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2w
node=$1; tag=$2
run() { # name count
  i=1
  while [ "$i" -le "$2" ]; do
    : > "$O/wait-$tag-$1-$i.jsonl"
    PATH="$(dirname "$node"):$PATH" FAKE_PROBE_LOG="$O/wait-$tag-$1-$i.jsonl" /var/tmp/okd-fi/sbx.sh "$node" "$T/test/zz-probe-$1.test.mjs" > "$O/wait-$tag-$1-$i.out" 2>&1
    echo "$tag $1 $i exit=$? $(grep -E '^(ℹ|#) (pass|fail) ' "$O/wait-$tag-$1-$i.out" | tr '\n' ' ') $(grep '^@@LEFT' "$O/wait-$tag-$1-$i.out")"
    i=$((i + 1))
  done
}
run desktop-server "$3"
run desktop-cli-integration "$4"
echo done
