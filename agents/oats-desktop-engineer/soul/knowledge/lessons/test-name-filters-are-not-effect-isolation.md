---
type: Lesson
title: Test-name filters are selection, not native-effect isolation
description: Node test-name filters match full names and can select unintended native cases, so effect isolation must precede execution and TAP must confirm the actual selection.
tags: [testing, node-test, desktop, tmux, native-effects, verification]
timestamp: 2026-09-24
---

# The trap

A negative lookahead such as `--test-name-pattern='^(?!live tmux:)'` is not a
safe way to make a mixed test module inert. Node applies name filtering to full
test names; a short displayed label is not a reliable model of the matching
context. A green result and a log named “pure” prove neither which cases ran nor
that native effects were excluded.

This was observed during terminal-ownership qualification: an attempted
pure-case selection ran the module's live tmux cases, including a PTY test.
Reporting the actual TAP and stopping for an authorized inspection established
that no damage occurred. That favorable outcome did not make the selection safe
or turn the run into approved native acceptance.

# Safer verification

- Prefer separate inert test entrypoints with injected effects; keep native
  cases in explicitly authorized CI or operator-owned acceptance jobs. This is
  the elimination route, rather than relying permanently on remembering a regex.
- Treat `--test-name-pattern` as an **explicit positive allowlist**. Use an
  explicit runner exclusion such as `--test-skip-pattern` when exclusion is the
  intent, but neither flag is an authorization or effect-isolation boundary.
- Establish protections **before** loading a mixed module. If native work is
  forbidden, do not load it against real process/PTY dependencies. A verified
  pre-dispatch tripwire can supplement reviewed inert entrypoints; cover direct,
  synchronous and promisified process calls rather than only one API spelling.
- Verify selected names and counts from TAP before describing a run as inert.
  Verification after execution is an audit, not prevention; it cannot undo an
  unintended side effect.
- On an unexpected native case, stop, preserve truthful output and report it.
  Do not retry to explain the filter or perform speculative cleanup. Similar
  session names and a present product key table are not evidence of test residue;
  an authorized owner must establish provenance and current use.
- Attribute an operator-state inspection to its actual inspector. Keep incident
  closure separate from release/native acceptance at the reviewed source head.

# Related

- [Pin test-file globs in nested worktrees](/lessons/pin-node-test-globs-in-nested-worktrees.md)
- [No packaged GUI launches on operator machines](/lessons/no-packaged-gui-launches-local.md)
- [Scope destructive cleanup](/lessons/pkill-scoping-discipline.md)
