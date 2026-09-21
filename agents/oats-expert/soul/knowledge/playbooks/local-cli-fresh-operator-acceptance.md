---
type: Playbook
title: Install the tool locally in a throwaway directory when acting as a second operator
description: A fresh-operator acceptance run must not upgrade or reconfigure the machine's working installation, and a directory-local install of the exact published version gives a clean subject while leaving the live deployment untouched.
tags: [acceptance-testing, deployment, isolation, playbook]
timestamp: 2026-09-20
---

Proving that a published definition works for somebody who has never seen it is
worth much more from a machine that holds none of the authoring state. The value
comes from the absence of that state, so the run must not acquire it, and it must
not damage whatever the machine is already running.

The trap is the global upgrade. The acceptance target is usually a newer release
than the one in daily use, and upgrading the global install to test it changes
the working environment out from under its owner, mixes their configuration into
the observations, and makes the result unreproducible.

Instead:

1. Create a directory that exists only for this run.
2. Install the exact published version **locally** inside it — for a node CLI,
   an ordinary non-global install — and invoke it by its path from that
   directory's local binaries, never from `PATH`.
3. Confirm the version you invoke is the one you meant, not the global one.
4. Keep the fresh deployment and the fresh work target inside that directory too,
   as separate paths, so nothing resolves into the live tree.
5. Check for ambient configuration the tool might inherit from the user's home
   before starting; an inherited config silently invalidates "fresh".
6. Preserve the directory after the run. Re-running against the next release is
   then a repeat, not a rebuild, and the retained raw output is the evidence.

Record what you did **not** touch as explicitly as what you did. "The live
deployment and its global install were never modified" is part of the result, and
the reader cannot infer it.
