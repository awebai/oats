#!/bin/sh
# usage: sbx.sh <node binary> <absolute path of one test file>
# The maintainer's sandbox: the host's file system as it is, a tmpfs over /tmp, process ids unshared
# with a proc of its own, dying with its parent, the working directory in that tmpfs; inside it
# TMPDIR unset, a session of its own, node --test on the one file. Then what is left in /tmp.
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp sh -c 'env -u TMPDIR setsid -w "$0" --test "$1"; c=$?; echo "@@LEFT $(ls -A /tmp | tr "\n" " ")"; exit $c' "$1" "$2"
