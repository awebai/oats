---
type: Lesson
title: Implicit global is one predicate written twice, and the fix is to stop relying on it
description: The CLI's "materialize implicit global before narrowing" rule and the resolver's "no explicit target means global" rule are the same condition in two files, and writing an explicit global is what keeps a config out of the fragile branch.
tags: [oats-cli, capabilities, config-cascade, resolver, review]
timestamp: 2026-09-05
---

A fundamental-layer entry with no `global:`, no `agent-types:` and no
`souls:` is implicitly global. That rule is spelled out twice, in two files,
as the same four-term condition: the READ side in lib/core.mjs
(`spec.global === undefined && !spec["agent-types"] && !spec.souls`) and the
WRITE side in bin/oats.mjs, which materializes the implicit global into an
explicit one before `oats use --soul/--type` narrows the entry.

The two must agree, and the write side has one term the read side cannot
have: whether the entry already existed. The resolver only ever sees a config
on disk, so for it "untargeted" and "implicitly global" are the same thing.
The CLI also sees entries it just constructed in memory this run (replacing an
explicit `none`, or replacing another capability under `--disable`). Those
look untargeted to the shared condition but have no inherited audience to
preserve, and materializing a global for them activated the capability for
every soul (verified: before the fix, a first `oats use oats.okf --soul dev`
on a `none` layer made the resolver give oats.okf to every other soul too).

The load-bearing consequence is the reverse direction. Both the true and the
false outcome are written as an explicit `global:`, and an explicit `global:`
makes the resolver's implicit branch skip entirely. So every entry the CLI
narrows leaves the implicit-global branch behind for good. That branch is
known-fragile (an entry carrying only a `souls:` exclusion and no `global:`
loses global at scope level; bd oats-utz). Emitting the explicit value is what
stops `oats use` from producing configs that depend on the fragile read;
hand-written and legacy configs stay exposed until the resolver is fixed.

When either side of a duplicated invariant gains a term, check whether the
other side can express it before assuming they still agree.
