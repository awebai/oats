#!/bin/sh
# The launch configuration's executable for the `enter` run: the real Claude with
# every network operation denied, so its channel gate is read offline and the
# development-channel confirmation appears. Claude's audit version reads
# `unknown` through this wrapper (its path carries no version), which is accepted.
exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' /opt/homebrew/bin/claude "$@"
