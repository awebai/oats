# Successor experiment — pre-registered protocol

Date: 2026-08-19. Registered BEFORE the successor agent was spawned; the
acceptance criteria and metrics below are frozen as of the commit that adds
this file. The successor never sees this file.

## Hypothesis under test

Structural selection (goal + author-marked conclusions + frontier, with
omissions recallable on demand) is sufficient spawning context for a fresh
agent to continue this project's work without the accumulated session —
avoiding the observed failure mode that full-context agents get dumb, and
without needing an intelligent tagger (real-time or at-rest).

## Setup

- **Successor (Arm A)**: a fresh general-purpose agent in an isolated git
  worktree of the oats repo. Its ONLY project context: a dress briefing of
  the main session (`turn-record dress --thread cc:session:091fd29e-… ` with
  pinned conclusion turns, budget 30,000 chars) inlined in its prompt, plus
  the task statement. It may and should use `node packages/record/bin/recall.mjs`
  against the live record (`~/.turn-record`) whenever context is missing.
  It must not read `~/.claude-aweb/projects/*/memory/` (the incumbent's
  private memory) and must not commit.
- **Baseline**: the incumbent agent's own judgment of the same task,
  expressed as the acceptance criteria below, written before spawning.
- **Measurement source**: the successor's own session transcript, captured
  into the record like any other session — the experiment is measured by
  the system it tests.

## Task given to the successor (verbatim)

Add an ignore mechanism to turn-record capture so that designated sessions
or paths are never captured (a privacy control). It must prevent capture
entirely — not merely indexing — be configurable per record root, be
documented, be tested, and fit the package's existing design principles.
Deliver working code and tests in the worktree; run the package suite; do
not commit.

## Acceptance criteria (frozen; successor does not see these)

1. Patterns are configurable per record root (file under the root, env var,
   or flag — any sensible surface), with a documented location.
2. Ignoring happens at capture time BEFORE any write: no blob stored, no
   turn appended for an ignored source file.
3. Applies to all three session formats (cc, pi, codex).
4. Ignored files are counted in the pass results (visible, not silent).
5. Un-ignoring later works: the seen-cache must not have swallowed the file
   while it was ignored (next pass captures it).
6. Tests cover: ignored not captured, non-ignored captured, un-ignore
   recovery; full suite stays green.
7. README documents the mechanism and states honestly that ignoring is
   forward-looking (already-captured turns need tombstones).

## Amendment (pre-spawn, before the successor existed)

The 15 pinned conclusion turns alone measure 84,423 chars — the planned
30,000 budget was consumed by pins with no room for frontier turns (pins
are honored beyond budget by documented design). Budget raised to 100,000
chars so the frontier is present as designed. No other change; the
successor had not been spawned when this amendment was made.

## Metrics

- **M1 — recall calls**: count of `recall.mjs` invocations in the captured
  successor transcript, each classified as targeted (fetched something the
  briefing referenced or the task needed) or floundering (searching for
  bearings).
- **M2 — re-derivations**: events where the successor re-establishes a fact
  the briefing already stated (re-reading strategy/SOT documents, re-asking
  why the store is append-only). Reading code it is about to modify does
  NOT count.
- **M3 — acceptance criteria met**: 0–7 against the frozen list.
- **M4 — context hallucinations**: claims about prior decisions that the
  record contradicts.
- **M5 — cost**: subagent tokens and wall time.

## Pre-registered interpretation

- Structural selection SUFFICIENT: M3 ≥ 6, M4 = 0, M1 ≤ 5 with all recalls
  targeted.
- Structural selection INSUFFICIENT (strengthens the distill-at-rest case):
  M3 ≤ 4, or M4 > 0, or recall usage dominated by floundering.
- Between those: judgment call, reported as such.
