#!/bin/sh
# One test file at a time, host Node, in the sandbox, with the warning probe.
echo "head $(git -C $OATS_INSTANCE_HOME/.work-warnings rev-parse --short HEAD) node $(node --version)" > /var/tmp/okd-fi/warn/summary.txt
while read f; do
  n=$(basename "$f" .test.mjs)
  rm -f /var/tmp/okd-fi/warn/$n.jsonl
  WARN_PROBE_LOG=/var/tmp/okd-fi/warn/$n.jsonl /var/tmp/okd-fi/sbx-warn.sh "$(command -v node)" "$OATS_INSTANCE_HOME/.work-warnings/$f" > /var/tmp/okd-fi/warn/$n.out 2>&1
  echo "$f exit=$? $(grep -E '^ℹ (tests|pass|fail)' /var/tmp/okd-fi/warn/$n.out | tr '\n' ' ') lines=$(grep -c 'oats: warning:' /var/tmp/okd-fi/warn/$n.out) probe=$(cat /var/tmp/okd-fi/warn/$n.jsonl 2>/dev/null | wc -l) $(grep '^@@LEFT' /var/tmp/okd-fi/warn/$n.out | cut -c1-60)" >> /var/tmp/okd-fi/warn/summary.txt
done < /var/tmp/okd-fi/warn/list.txt
echo done >> /var/tmp/okd-fi/warn/summary.txt
