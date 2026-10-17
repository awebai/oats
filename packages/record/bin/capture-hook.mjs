#!/usr/bin/env node
// The capture hook's entry: `capture --hook` under a file name of its own.
// Claude treats a hook's exit 2 as blocking. A release that predates this file
// cannot load it, so after a rollback the persisted hook line fails with exit 1
// ("Cannot find module"), which never blocks Stop or SessionEnd, instead of an
// older capture.mjs rejecting a flag it does not know with exit 2.
process.argv.splice(2, 0, "--hook");
await import("./capture.mjs");
