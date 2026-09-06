---
type: Lesson
title: The --help allowlist is a hand-copied mirror of the dispatch chain with nothing pinning them together
description: KERNEL_COMMANDS must list every cmd === "..." branch to keep --help from executing, but no test ties the two, so the next command added silently gets the side-effecting --help back.
tags: [cli, dispatch, guards, review, allowlists]
timestamp: 2026-09-06
---

# The shape

`bin/oats.mjs` fixes "`--help` executes the command" with an intercept placed
ahead of the whole dispatch chain:

    const KERNEL_COMMANDS = new Set(["capture", "config", ... "use", "version"]);
    const wantsHelp = args.slice(1).some((a) => a === "--help" || a === "-h");
    if (cmd && KERNEL_COMMANDS.has(cmd) && wantsHelp) { ...usageFor(cmd); process.exit(0); }

Verified at 6d2216e: the set is exactly the 25 `cmd === "..."` names in the
chain — complete today. `--version` and `-v` are the only dispatch names left
out, correctly, since they are flag spellings and `oats version --help` covers
the command.

# Why it will drift

The set is a **hand-copied mirror** of a dispatch chain that lives 200 lines
below it, and `grep -rn KERNEL_COMMANDS bin/ lib/ test/` returns only the two
lines above — nothing pins the correspondence. Adding a new
`else if (cmd === "foo") fooCmd();` without touching the set silently restores
the original P1 for `foo`, and restores it in the worst way: the omission is
invisible at the call site, the new command's `--help` executes rather than
erroring, and the only test that would notice is one nobody wrote.

This is the same family as
[dispatch-allowlist-strands-its-own-guard](/lessons/dispatch-allowlist-strands-its-own-guard.md)
and [snapshot-before-registry-is-per-command](/lessons/snapshot-before-registry-is-per-command.md):
a per-command enumeration standing in for a structural property. The difference
is the failure direction — those fail open on the excluded case at runtime, this
one fails open on whatever is added next.

# The cheap pin

The correspondence is mechanically checkable, because both sides are literals in
one file. A test can read `bin/oats.mjs`, extract the `cmd === "..."` names from
the dispatch region and the set members, and assert set equality modulo the two
flag spellings. That converts "remember to update the set" into a failing test,
which is the only form of that instruction that survives.

The structural alternative — derive the dispatch from a command table and make
the allowlist its keys — is the real fix, but it is a much larger change to a
chain that is deliberately written as `else if` for `git blame` legibility (the
comment above `TYPED_CLI_FAILURES` says so).
