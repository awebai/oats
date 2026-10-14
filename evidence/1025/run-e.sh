#!/bin/sh
# One test file at a time, host Node, each in the sandbox (sbx.sh). Results beside this script.
echo "head $(git -C $OATS_INSTANCE_HOME/.work-real-env rev-parse --short HEAD) node $(node --version)" > /var/tmp/okd-fi/summary-e.txt
while read f; do
  n=$(basename "$f" .mjs)
  /var/tmp/okd-fi/sbx.sh "$(command -v node)" "$OATS_INSTANCE_HOME/.work-real-env/$f" > /var/tmp/okd-fi/out/e-$n.out 2>&1
  echo "$f exit=$? $(grep -E '^ℹ (tests|pass|fail|skipped)' /var/tmp/okd-fi/out/e-$n.out | tr '\n' ' ') $(grep '^@@LEFT' /var/tmp/okd-fi/out/e-$n.out)" >> /var/tmp/okd-fi/summary-e.txt
done < /var/tmp/okd-fi/list-e.txt
echo done >> /var/tmp/okd-fi/summary-e.txt
