#!/bin/sh
# Piece 2 measurement: one test file at a time, host Node, in the sandbox; what each leaves in /tmp.
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2m
: > $O/summary.txt
while read -r f; do
  n=$(echo "$f" | tr '/' '_')
  /var/tmp/okd-fi/sbx.sh "$(command -v node)" "$T/$f" > $O/$n.out 2>&1
  echo "$f exit=$? $(grep -E '^ℹ (tests|pass|fail)' $O/$n.out | tr '\n' ' ') $(grep '@@LEFT' $O/$n.out | cut -c1-400)" >> $O/summary.txt
done < $O/list.txt
echo done >> $O/summary.txt
