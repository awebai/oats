---
type: Lesson
title: An outer dispatch allowlist can strand the refusal written for the case it excludes
description: Routing `oats okf harvest --server` on `args[1] === "harvest"` at the top-level dispatch made the command handler's own "harvest only" refusal unreachable, so every other okf subcommand with --server silently ran locally.
tags: [cli, dispatch, guards, review, servers]
timestamp: 2026-09-05
---

Two layers decided the same thing in 5a49b3b. The top-level dispatch:

    if (flag("server") !== undefined && (["spawn", "retire", "status", "session"].includes(cmd)
        || (cmd === "okf" && args[1] === "harvest"))) serverRouteCmd();

and, inside `serverRouteCmd`, the handler for that namespace:

    if (args[1] !== "harvest") bail("E_USAGE", "--server routes `okf harvest` only among the okf commands");

The handler's refusal could never fire: the only way into it already required
`args[1] === "harvest"`. Worse than dead code, the excluded case did not fail
at all: `oats okf status --server build` fell through the dispatch chain to
the capability dispatcher and ran LOCALLY, with `--server build` handed to the
capability executable as a stray argument. The operator asked for a remote
action and got a local one with no signal.

The shape to watch for: an allowlist at the dispatcher and a validation inside
the handler that test the SAME predicate. Whichever is narrower wins, and the
other becomes either unreachable (harmless-looking) or a fail-open (this case).
The routing predicate should be the coarse one (the namespace), and the
precise refusal should live where the diagnostic can be written well.

A quick check when adding a routed subcommand: for each argument shape the new
guard rejects, ask what the CLI does with that shape if the guard is deleted.
If the answer is "runs something else silently", the guard is in the wrong
layer.

Related: [snapshot-before-registry-is-per-command](snapshot-before-registry-is-per-command.md).
