#!/bin/sh
# Piece 2: the edited files, one at a time, in the sandbox, on both Nodes; what each leaves in /tmp (counted, never cut).
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2c
N22=$HOME/.local/share/mise/installs/node/22.23.3/bin/node
: > $O/summary.txt
for node in "$(command -v node)" "$N22"; do
  v=$($node --version)
  for f in "$@"; do
    n=$(echo "$f" | tr '/' '_')
    /var/tmp/okd-fi/sbx.sh "$node" "$T/$f" > $O/$v-$n.out 2>&1
    code=$?
    left=$(grep -o '@@LEFT.*' $O/$v-$n.out | sed 's/^@@LEFT //; s/\[[0-9]* entries\]//' | tr ' ' '\n' | grep -c .)
    echo "$v $f exit=$code $(grep -E '^(ℹ|#) (tests|pass|fail|skipped) ' $O/$v-$n.out | tr '\n' ' ') left=$left $(grep -o '@@LEFT.*' $O/$v-$n.out | sed 's/-[A-Za-z0-9]\{6\} / /g' | tr ' ' '\n' | sort | uniq -c | tr '\n' ' ')" >> $O/summary.txt
  done
done
echo done >> $O/summary.txt
