#!/bin/sh
# The edited test files with injected failures, each alone: for each file and each "after" value.
# usage: run.sh <node> <tag> <list> <after...>
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2x
node=$1; tag=$2; list=$3; shift 3
out=$O/summary-$tag.tsv
: > "$out"
while read -r f; do
  [ -n "$f" ] || continue
  n=$(echo "$f" | tr '/' '_')
  for after in "$@"; do
    PATH="$(dirname "$node"):$PATH" timeout 600 $O/one-fail.sh "$node" "$T" "$T/$f" "$after" > "$O/$tag-$n-after$after.out" 2>&1
    code=$?
    left=$(grep '^@@LEFT' "$O/$tag-$n-after$after.out" | sed 's/^@@LEFT //')
    outside=$(grep '^@@OUTSIDE' "$O/$tag-$n-after$after.out" | sed 's/^@@OUTSIDE //')
    counts=$(grep -E '^(ℹ|#) (tests|pass|fail|cancelled) ' "$O/$tag-$n-after$after.out" | sed 's/^[ℹ#] //' | tr '\n' ' ')
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$f" "$after" "$code" "$counts" "$(echo $left | wc -w)" "$(echo $outside | wc -w)" "$left" "$outside" >> "$out"
  done
done < "$list"
echo done >> "$out"
