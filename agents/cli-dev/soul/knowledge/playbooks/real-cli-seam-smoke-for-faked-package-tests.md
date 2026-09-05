---
type: Playbook
title: Drive the real CLI once when package tests fake the command they shell out to
description: Unit tests that stub OATS_CLI_BIN prove planner logic but not whether the kernel accepts and forwards the flags the package invents; one end-to-end run with only spawn faked covers the seam.
tags: [review, testing, oats-cli, record]
timestamp: 2026-09-05
---

# When to use this

Use this when a package test points `OATS_CLI_BIN` at a fake script and the
package's behavior depends on flags it passes to `oats`. The fake proves package
planning decisions; it does not prove that `bin/oats.mjs` accepts those flags or
forwards them to the underlying package binaries. The package's own direct-bin
tests can have the opposite gap: they invoke package binaries without the kernel
router.

# The seam to cover

For record harvest, neither side covered:

```bash
oats capture --home
oats recall --thread --json --ids-only --after --until
```

# The check

Build a temp deployment and a CLI wrapper that forwards everything to the real
kernel, faking only the side-effecting command that must not actually run:

```js
const argv = process.argv.slice(2);
if (argv[0] === "spawn") {
  writeFileSync(spawnLog, JSON.stringify({
    args: argv,
    task: readFileSync(argv[argv.indexOf("--task-file") + 1], "utf8")
  }));
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    ok: true,
    result: { instance: "…", tmux: { window: "w" } }
  }));
  process.exit(0);
}
spawnSync(process.execPath, [KERNEL_BIN, ...argv], { stdio: "inherit", env: process.env });
```

Point `HOME` and `TURN_RECORD_ROOT` at the temp base, write a real session file
whose recorded `cwd` is the fake instance home, and run the harvester three
times: once to plan, once after delivering the watermark by hand, and once to
see it skip.

Then take the briefed command out of the spawn log and run it verbatim. That
proves the harvester's instruction is executable and measures what the harvester
will actually receive.

# What this establishes

This cheap end-to-end run covers home filtering against a sibling home, the
window bound, draining across harvests, the terminal skip, and router forwarding
for every newly added flag. It complements the broader rule in
[test conventions](/playbooks/test-conventions.md): regressions must exercise
the layer where the bug can live.
