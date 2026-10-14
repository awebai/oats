#!/bin/sh
# usage: sbx-warn.sh <node binary> <absolute path of one test file>   (WARN_PROBE_LOG names the log)
# The maintainer's sandbox (see sbx.sh), with the warning probe loaded in the worker and its node children.
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp sh -c 'NODE_OPTIONS="--import=/var/tmp/okd-fi/probe/stderr-probe.mjs" env -u TMPDIR setsid -w "$0" --test "$1"; c=$?; echo "@@LEFT $(ls -A /tmp | tr "\n" " ")"; exit $c' "$1" "$2"
