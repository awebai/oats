#!/bin/sh
# Piece 2: the files the piece edits, each alone, started as the root run starts it (its own temporary
# directory), in the sandbox, on both Node binaries. A file may be listed as "<file> <times>".
# Per run: node, file, run number, exit, counts, entries left in its directory, entries made outside it.
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2f
N22=$HOME/.local/share/mise/installs/node/22.23.3/bin/node
list=${1:-$O/list.txt}
out=${2:-$O/summary.tsv}
: > "$out"
for node in "$(command -v node)" "$N22"; do
  v=$($node --version)
  while read -r f times; do
    [ -n "$f" ] || continue
    n=$(echo "$f" | tr '/' '_')
    i=1
    while [ "$i" -le "${times:-1}" ]; do
      # Each Node by its path, with its own directory first on PATH (the kernel checks that the node it runs on is the one PATH finds).
      PATH="$(dirname "$node"):$PATH" /var/tmp/okd-fi/p2g/one.sh "$node" "$T" "$T/$f" > "$O/$v-$n-$i.out" 2>&1
      code=$?
      left=$(grep '^@@LEFT' "$O/$v-$n-$i.out" | sed 's/^@@LEFT //')
      outside=$(grep '^@@OUTSIDE' "$O/$v-$n-$i.out" | sed 's/^@@OUTSIDE //')
      counts=$(grep -E '^(ℹ|#) (tests|pass|fail|skipped) ' "$O/$v-$n-$i.out" | sed 's/^[ℹ#] //' | tr '\n' ' ')
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$v" "$f" "$i" "$code" "$counts" "$(echo $left | wc -w)" "$(echo $outside | wc -w)" "$left" "$outside" >> "$out"
      i=$((i + 1))
    done
  done < "$list"
done
echo done >> "$out"
