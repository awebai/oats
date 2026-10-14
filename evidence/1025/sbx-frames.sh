#!/bin/sh
# usage: sbx-frames.sh <node binary> <absolute path of one test file>   (PROBE_LOG names the log)
# The maintainer's sandbox (see sbx.sh), with the probe that logs every child the worker starts, with frames.
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp sh -c 'env -u TMPDIR setsid -w "$0" --import /var/tmp/okd-fi/probe/probe-frames.mjs --test "$1"; c=$?; echo "@@LEFT $(ls -A /tmp | tr "\n" " ")"; exit $c' "$1" "$2"
