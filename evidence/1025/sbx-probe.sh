#!/bin/sh
# usage: sbx-probe.sh <node binary> <absolute path of one test file>
# The maintainer's sandbox (see sbx.sh), with the probe loaded in the test worker.
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp sh -c 'env -u TMPDIR setsid -w "$0" --import /var/tmp/okd-fi/probe/probe.mjs --test "$1"; c=$?; echo "@@LEFT $(ls -A /tmp | tr "\n" " ")"; exit $c' "$1" "$2"
