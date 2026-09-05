---
type: Lesson
title: A saved-route lookup that is per-command strands every route added later
description: lib/servers.mjs resolved the snapshot before the registry only for the command it was written for, so each new route re-implements the fallback or silently requires a registration the design says it must not need.
tags: [cli, servers, remote, routing, review]
timestamp: 2026-09-05
---

`lib/servers.mjs` promises in its header that "a registry entry edited or
deleted later can never orphan a remote home": every remote operation is
supposed to run from the ROUTE SNAPSHOT taken at spawn, and consult
`~/.oats/servers.json` only as a fallback. Two places implement that promise,
and they implemented it differently.

`resolveRoute` (the session routes) does it structurally:

    const target = snap?.target || targetOf(getServer(serverId));

`getServer` is inside the short circuit, so it is never called when a snapshot
exists. `routeCommand` did it by naming the command:

    const snap = cmd === "retire" && instanceArg ? readSnapshot(serverId, instanceArg) : undefined;
    ...
    try { server = getServer(serverId); } catch (e) { if (!snap?.target) throw e; }

The `cmd === "retire"` was the defect surface. Reviewing 5a49b3b, which added
an `okf harvest` route to `routeCommand`, the new branch read its own snapshot
correctly at the bottom of the function, but `getServer` at the top had
already thrown `E_SERVER_UNKNOWN` for a removed registration, so the branch
was never reached. The route read as correct in isolation and failed on
exactly the scenario the module exists to survive.

What makes this hard to catch by reading the diff: the new code is right, and
the bug lives in a line the diff does not touch. It shows up only when you ask
"what does this function do BEFORE my branch runs", and the answer is
different for each `cmd`.

Two checks that find it cheaply:

- for any function whose preamble branches on `cmd`, enumerate the commands and
  ask which preamble each new one inherits;
- the existing tests name the guarantee: `test/servers.test.mjs` has "retire
  from the snapshot after the registration is gone". A new route with the same
  guarantee and no twin test is the tell.

The structural fix is to make the fallback unconditional (resolve the snapshot
for every command that takes an instance name) rather than to add another
`cmd ===` term each time a route is added.

Related: [dispatch-allowlist-strands-its-own-guard](dispatch-allowlist-strands-its-own-guard.md).
