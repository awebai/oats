---
type: Lesson
title: A locally minted OATS identity has no cross-team first-contact address
description: The aweb messaging capability mints team-local did:key identities, which have no durable global address for cross-team first contact; a seat that other teams must be able to reach needs an owner-minted global identity bound through identity.source for that one spawn.
tags: [oats, aweb, identity, handover]
timestamp: 2026-09-21
---

The `oats.aweb` spawn hook mints an identity with `aw team invite` and `aw team join`: a team-local `did:key` with no `did:aw`, no global first-contact address and no configurable inbound mode. Agents in other teams open first contact by global address, so a locally minted instance has no durable way to be reached from outside its team, even though it can message teammates and may continue an already stored route. A coordination seat that works with other teams therefore cannot be replaced by an ordinary spawn.

The supported path is a global identity minted by the namespace owner into a prepared `.aw` directory and seated through the capability's `identity.source` setting. That setting is per soul, so bind it only for the one spawn and remove it afterwards: the hook records `retained`, `source` and `lock` in the instance's metadata at spawn, and retirement reads that metadata rather than the config, so the seat keeps retained-seat behaviour (lock released, identity and source untouched) after the binding is gone, and later instances of the same soul mint local identities as usual. Retiring the seat is not a provider-side retirement of the identity; that is a separate act with its own receipt. There is no per-spawn settings flag; the temporary config edit is the mechanism, with a byte copy and a restore diff.
