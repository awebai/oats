#!/bin/sh
# One test file at a time, host Node, in the sandbox; each expectation's end is logged.
: > /var/tmp/okd-fi/fb2/summary.txt
for n in "$@"; do
  rm -f /var/tmp/okd-fi/fb2/$n.jsonl
  FIXTURE_FALLBACK_LOG=/var/tmp/okd-fi/fb2/$n.jsonl /var/tmp/okd-fi/sbx.sh "$(command -v node)" "$OATS_INSTANCE_HOME/.work-warnings/test/$n.test.mjs" > /var/tmp/okd-fi/fb2/$n.out 2>&1
  echo "$n exit=$? $(grep -E '^ℹ (tests|pass|fail)' /var/tmp/okd-fi/fb2/$n.out | tr '\n' ' ') lines=$(grep -c 'oats: warning:' /var/tmp/okd-fi/fb2/$n.out)" >> /var/tmp/okd-fi/fb2/summary.txt
done
echo done >> /var/tmp/okd-fi/fb2/summary.txt
