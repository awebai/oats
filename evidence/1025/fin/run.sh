#!/bin/sh
# One test file at a time, host Node, in the sandbox; the final head, no debug line.
: > /var/tmp/okd-fi/fin/summary.txt
for n in "$@"; do

  /var/tmp/okd-fi/sbx.sh "$(command -v node)" "$OATS_INSTANCE_HOME/.work-warnings/test/$n.test.mjs" > /var/tmp/okd-fi/fin/$n.out 2>&1
  echo "$n exit=$? $(grep -E '^ℹ (tests|pass|fail)' /var/tmp/okd-fi/fin/$n.out | tr '\n' ' ') lines=$(grep -c 'oats: warning:' /var/tmp/okd-fi/fin/$n.out)" >> /var/tmp/okd-fi/fin/summary.txt
done
echo done >> /var/tmp/okd-fi/fin/summary.txt
