#!/bin/sh
# As sbx.sh, with node's arguments given whole: sbx-args.sh <node> <args...>
node=$1; shift
exec bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp env -u TMPDIR setsid -w "$node" "$@"
