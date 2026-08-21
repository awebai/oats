# @awebai/oats-experimental

**EXPERIMENTAL — unproven by design.** Everything in this package selects
or synthesizes over the turn record: it decides which lived conversation
matters and builds new agents out of it. That is the part of the system
whose value is not yet demonstrated, and the strategy gates it explicitly:
selection sophistication earns its keep only when the continuation-of-self
experiments read out, and a null result is accepted if it comes. Designs
here have already been built and ruled wrong once (the turn-level
librarian survives in the record as a wrong-track example); expect the
same again. Do not depend on these interfaces, and do not treat their
output as record truth — mind-stream notes are rewritable clay until a
design is frozen.

This package is never published. It ships only in the oats repo checkout
and runs through the one runtime:

```bash
oats experimental dress    --task "<task>" | --thread <t> | --segment <id>...
oats experimental segments [query] [--thread t] [--type t] [--include-dead]
oats experimental spawn    --outfit t1:<hex> [--task s] [--cwd dir] [--dry-run]
oats experimental mind     --follow [--engine cmd] | --backfill <thread> | --map <thread>
```

The core it builds on — capture, recall, the store, the spec — is
`packages/record` (`@awebai/turn-record`), which is stable and shipped.
The note conventions these tools write (segments, tags, outfits, spawn
notes) are parsed by the core index so the record can always read its own
contents; the writers live here.

## The tools

- **`lib/reader.mjs` + `lib/segments.mjs` convention — the reader.**
  Follows one agent's recorded life window by window and writes segment
  notes: contiguous stretches of conversation (tool calls and results
  included) that do one thing — exploration, design, implementation,
  review, handoff, admin — each with an outcome (fruitful, dead-end,
  superseded, ongoing) and, for dead ends, the lesson that survives.
  Segments exist because general context cannot be found by retrieval:
  only a reader that follows the conversation can mark it.
- **`lib/jiminy.mjs` + `lib/follow.mjs` — the consciousness.** One jiminy
  per followed life, never per machine: its own identity
  (`jiminy-<session-prefix>`), its own long-lived pi memory session
  (resumed every wake), its own judgment stream
  (`<owner>~mind.<principal>`). Born on first wake, dies by staleness
  after a final wake and a farewell note, revived by journal growth. A
  jiminy is never assigned a jiminy — the guarantee is structural, three
  layers deep, and does not depend on any lookup that can fail open. The
  per-machine `mind --follow` daemon is a pure scheduler with no identity:
  it notices journal growth and wakes the right jiminy with the delta.
- **`lib/librarian.mjs` — task-scoped selection.** `dress --task` gathers
  candidates (FTS, tags, outfits, threads, pins), has a judge engine
  select the constitutive turns, and memoizes the judgment as tag turns
  plus a proposed outfit turn. A spawned agent's recall calls are the
  under-selection signal; outfits graduate from proposed to validated by
  observed success, never by the judge's own say-so.
- **`lib/dress.mjs` — the filter.** Composes a budgeted context from a
  thread or from frozen segments. Deterministic; the record keeps every
  dropped byte.
- **`lib/compile-pi.mjs` — the spawn primitive.** Compiles an outfit (a
  frozen selection of segments) into a native pi session file, so a new
  agent starts life with the selected conversation already in context —
  indistinguishable from an agent that lived those turns: no markers, no
  labels, no harness bookkeeping; thinking and half tool-exchanges are
  dropped; complete tool call/result pairs replay natively. A spawn note
  maps the new agent to the exact segment versions it wears. Tombstoned
  events stay redacted in the dress.

## What would graduate a tool out of here

A tool moves to core when its value survives an honest experiment against
the null hypothesis, on real work, at current prices — the standing gate
is continuation-of-self at full scale: spawn an agent wearing selected
segments of a real life and measure whether it works better than a fresh
agent re-reading the durable thread. Until that reads out, everything
here is a research instrument, and the record — which loses nothing —
is what makes the research safe to run.

## Experiments

`experiments/` keeps the protocols and results of the runs so far
(2026-08-19 successor experiment: the briefing-document arm was ruled
useless — a subagent reading a document is a stranger with testimony, not
the agent re-instantiated; native session compilation replaced it).
