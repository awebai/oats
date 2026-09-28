---
name: maintain-dev-docs
description: Keep a repository's development documentation and code comments current in the classic sense (how the code works, its structure, conventions, how to build, test and change it), writing only long-lived facts that won't drift. Use whenever a change affects how the code works or how people work in it, and before handing back.
---

# Maintain the development docs

A repository explains itself to the next developer through its **development docs** and
**comments**. Keep them true in the same change as the code, the way a good maintainer
would. That is where a developer's knowledge lives; there is no separate knowledge base.

## What they are
The classic set; use the repository's existing names and places:
- **The contributor guide** (`AGENTS.md`, `CONTRIBUTING.md`, the README's development
  section): how to build, test and run it; the branch and PR rules; the test gate.
- **Architecture** (`ARCHITECTURE.md`, `docs/architecture/`, a module's README): the parts,
  their responsibilities, how data and control flow between them, where to change what.
- **Conventions:** naming, error handling, logging, file layout, patterns the codebase uses
  and ones it avoids.
- **Comments in the code:** a module's purpose at its top; *why* a non-obvious piece is the
  way it is; the invariant a function relies on; what a public function promises.

## Write what stays true
Development docs describe **how things are and why the design is shaped this way**, facts
that hold as long as the code does. Keep out:
- **Decisions in motion:** "we decided on Tuesday", "for now", who asked for what, PR
  numbers, dates, version-by-version history. These drift and rot. The history is git's;
  decisions under discussion belong with whoever is deciding.
- **Restated code:** comments that say *what* a line does. Say *why*, or nothing.
- **Duplicates:** state a rule once, in the most specific place, and link to it.

A good test: *would this sentence still be true, and still useful, a year from now if the
code hasn't changed?*

## When you change code
- Did the change alter a structure, a flow, a convention, a command or a rule the docs
  describe? Update that doc in the same change.
- Did you add something non-obvious (an invariant, a workaround, a subtle ordering)? Add the
  *why* as a comment next to it.
- Did you find a doc that was already wrong? Fix it, or say so in your handback if it's
  outside your surface.
- Delete docs and comments your change made untrue. A wrong doc is worse than none.

## Keep them lean
Prefer one clear page to five partial ones. Short sections, concrete examples, links to the
code. If a doc keeps needing updates on every change, it's describing the wrong thing:
describe the stable shape instead.
