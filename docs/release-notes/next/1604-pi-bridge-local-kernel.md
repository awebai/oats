## Fixed

- **The pi bridge loads the kernel that launched its instance first**
  ([#1604](https://github.com/awebai/oats/issues/1604)). Pi instances were
  never affected: each home's own `oats` link is first on the PATH pi
  launches with, so the bridge found the launching kernel with no global
  install. Now the bridge reads that link directly, after `OATS_PKG_ROOT`
  and before any PATH or global lookup, so a home loads its own kernel
  whatever PATH pi has. A pi started outside any instance, on a host with no
  global install and an `oats` that is a script rather than a link to the
  kernel, failed with "the pi adapter needs the oats CLI installed
  globally". It now says "OATS kernel not found" and names the three ways
  out: `npm install -g @awebai/oats`, an `oats` on PATH that links to the
  kernel's `bin/oats.mjs` (`npm link` in a checkout), or `OATS_PKG_ROOT`
  ([the bridge's README](../../packages/pi/README.md)).
