---
type: Lesson
title: A "read-only" Git observation of someone else's tree is a security boundary
description: Observing an instance's work tree with git is not read-only or safe by default — repo-local config can name executables (external diff, textconv, fsmonitor), status refreshes the index, write-tree creates objects, and HEAD can move mid-read. A kernel observation must disable helpers, not inherit config, take no optional locks, diff against a captured oid, and re-verify after the read.
tags: [kernel, git, security, read-only, desktop]
sources: [Desktop engineer hermetic probe of K1 before wiring it; fix PR56]
---

# A "read-only" Git observation of someone else's tree is a security boundary

## Why

The tree being observed is **worked in by an agent**. Anything that agent can
write — `.git/config`, `.gitattributes` — is input to the observer's `git`
process. `shell: false` and fixed argv protect against argument injection; they
do nothing about Git's own configured helpers:

- `diff.external`, `diff.<driver>.command`, `diff.<driver>.textconv` run
  arbitrary executables **and their output becomes the patch**.
- `core.fsmonitor` runs an executable on every `status`.
- `git status` refreshes the index (writes bytes); `write-tree` creates objects.
- `HEAD` and the index can move between "check" and "read".

## The rule

A kernel observation of a tree it does not own must:

1. run `git` with `--no-optional-locks`, `-c core.fsmonitor=false`,
   `-c core.hooksPath=/dev/null`, `-c diff.external=`, and `--no-ext-diff
   --no-textconv` on diffs;
2. **not inherit** the caller's Git environment, global or system config;
3. derive any "revision of the index" without writing (hash of
   `ls-files --stage`), never `write-tree`;
4. diff against the **captured oid**, never a moving symbolic ref;
5. **re-verify after the read** (HEAD, index, file content) and refuse with the
   fresh observation if anything moved — a consumer's generation guards cannot
   detect an internally inconsistent result;
6. state the contract in the response (`readOnly: {...}`) and test it
   byte-for-byte (`count-objects`, `.git/index`).

## How it was found

The consumer (Desktop engineer) wrote a hermetic probe with an inert helper
and a `git` shim **before** wiring the producer, and refused to compensate in
the wrapper. That is the right division: the wrapper cannot fix what the
producer executes. Probe a producer's security posture from the consumer's
side before trusting its "read-only" label.
