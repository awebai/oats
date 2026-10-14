#!/bin/sh
# Continue the sweep (run.sh) where it stopped: files already in the summary are skipped.
T=$OATS_INSTANCE_HOME/.work-leftovers
O=/var/tmp/okd-fi/p2s
node=${NODE:-$(command -v node)}
tag=${TAG:-n26}
touch $O/summary-$tag.tsv
while read -r f; do
  cut -f1 $O/summary-$tag.tsv | grep -qxF "$f" && continue
  n=$(echo "$f" | tr '/' '_')
  /var/tmp/okd-fi/p2g/one.sh "$node" "$T" "$T/$f" > $O/$tag-$n.out 2>&1
  code=$?
  left=$(grep '^@@LEFT' $O/$tag-$n.out | sed 's/^@@LEFT //')
  outside=$(grep '^@@OUTSIDE' $O/$tag-$n.out | sed 's/^@@OUTSIDE //')
  counts=$(grep -E '^(ℹ|#) (tests|pass|fail|skipped) ' $O/$tag-$n.out | sed 's/^[ℹ#] //' | tr '\n' ' ')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$f" "$code" "$counts" "$(echo $left | wc -w)" "$(echo $outside | wc -w)" "$left" "$outside" >> $O/summary-$tag.tsv
done < ${LIST:-$O/list.txt}
echo done > $O/done-$tag
