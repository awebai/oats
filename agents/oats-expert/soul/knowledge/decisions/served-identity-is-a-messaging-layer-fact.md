---
type: Decision
title: Per-spawn identity choice (local | global) — the served principal is a messaging-layer fact the kernel binds and shows, never a kernel vocabulary
status: proposed
description: PROPOSED (2026-09-23, to the human) from an OSS request that every instance creation offer a local (instance-lifetime) or global (resident identity served through a grant) messaging identity. Kernel asks reduced to two provider-neutral additions — `decision.effective.providers` binds the merged per-module payloads a spawn applied, and roster/inspect copy a documented messaging-layer meta key `identity` — with NO new `oats spawn` flags; the choice travels through the existing `--provider <cap> k=v` payload and the provider owns every identity-specific rule.
tags: [identity, messaging, provider-payload, spawn, decision-record, desktop, kernel-boundary]
timestamp: 2026-09-23
---

## Context

The OSS deployment asked (via its coordinator, 2026-09-23) that every instance
creation offer an identity choice: **local** — an instance-lifetime messaging
identity with no durable address, minted at spawn and gone at retire — or
**global** — the instance *serves* a durable resident identity that already
exists, through a time-bounded, scope-bounded grant, so that its mail and chat
carry the resident's address. The default is local.

The messaging provider in question (oats.aweb) already has the two building
blocks — session grants (mint / revoke, scopes, TTL, grant bound to one
resident on one team) and the retained-seat mechanism (`identity.source`) —
and its provider recorded elsewhere that "global at spawn" must mean *serve a
resident through a grant*, never *mint a new global identity per instance*.
That reading is adopted here: the kernel never learns what a grant is.

What the kernel has today (0.25.3): a per-module payload merged from base ⊕
`byTeam[<team>]` ⊕ soul slot ⊕ `oats-local.yaml settings.<cap>` ⊕ repeatable
`--provider <cap> k=v`; preview echoes `providers` (as given) and
`settings.<cap>` (as merged); hook meta is persisted as
`instance.json.capabilityMeta[<cap>]` and fed back at retire but is shown by
neither `oats status` nor `oats inspect`; the bound spawn decision
(`decision.effective`) covers repo/work/runtime/model/launchConfig/yolo/
backend/childSpawns/relation and reaches provider payloads only through the
resolution revision.

## Options considered

1. **Kernel flags `oats spawn --identity local|global --resident <name>`**,
   sugar over the payload, plus `decision.effective.identity`. Clear UX, but
   it puts a messaging-layer vocabulary on the kernel's forever-surface and
   every future messaging provider inherits it whether or not it has
   residents.
2. **No new flags; bind the payload.** The choice is `--provider <cap>
   identity.mode=global identity.resident=<name>`, which exists. The kernel
   adds `decision.effective.providers` — the merged per-module payloads the
   spawn actually applied — so a confirmed apply binds *every* provider fact,
   identity included, and roster/inspect copy a documented **layer** meta key
   `identity` through without interpreting it.
3. **Desktop-only choice**, kernel unchanged. The Desktop forwards `--provider`
   pairs; nothing binds them in the decision and nothing shows the served
   identity afterwards — the roster stays blind to who an instance acts as.

## Recommendation (option 2)

- **Kernel (K1′)**: `decision.effective.providers = { <module id>: <merged
  payload> }` for every module the resolution carried a payload for. Exact
  echo of what was fed to `OATS_SETTINGS`; nothing identity-specific.
- **Kernel (K2)**: `oats status --json instances[].identity` and `oats inspect`
  copy `capabilityMeta[<messaging module>].identity` when a module of the
  messaging layer emitted it. Text: `acts as <address> via grant, expires <t>`
  when `grant` is present, else `alias <alias> on <team>`. The key's shape is
  a **messaging-layer contract** documented in the integrations guide:
  `{ mode: "local"|"global", alias, team, address|null, resident|null,
  grant?: { id, expiresAt, scopes } }`. Any messaging provider may emit it.
- **No `--identity` / `--resident` flags.** Desktop shows an *Identity* select
  and a *Resident* field (prefilled from preview `settings.<cap>.identity`) and
  forwards them as `--provider` pairs; its arg allowlist gains one `provider`
  rule (capability id, dotted key, value grammar), not identity-named rules.
- **Provider owns every identity rule** (oats.aweb 1.12): reads `team` and
  `identity.{mode,resident,scopes,ttl,source}` from `OATS_SETTINGS`; the
  host-owned `residents.<name>: /abs/custody` map is accepted **only** from
  `oats-local.yaml settings.<cap>` and **refused** from any committed or
  per-spawn slot (a committed workspace file must never point a spawn at a
  custody root); `mode: global` without a resolvable resident is `E_CONFIG`
  naming the file that should hold it; a grant whose team differs from the
  payload team is revoked and the spawn fails with nothing kept; retire
  revokes and deregisters, a failed revoke is nonzero with the TTL note.
- **Already true, not new asks**: preview echo of the merged payload shipped in
  0.25.2 (R5); the `retained:<seat>` documentation example was removed in
  0.25.2 (R7/R8) — `identity.source` is an absolute path.
- **Later, separate design**: PrincipalRef / Delegation / Assignment as real
  definition-level objects. K2's `identity` is "the principal this instance
  serves" — compatible with that future, and distinct from the soul.

## Consequences

- Kernel additions are two provider-neutral fields; no CLI grammar grows.
- The Desktop's confirmed apply binds provider facts for the first time
  (they were previously covered only through the resolution revision).
- A 0.24 kernel is unaffected; on it the same keys work through capability
  settings, without a per-spawn payload.
- Sequence: provider 1.12 does not wait on the kernel (it emits the meta key
  regardless); K1′/K2 land after the human accepts this decision; Desktop
  follows when its lane resumes.

## Status

Proposed to the human 2026-09-23. Until accepted, no kernel change lands;
the provider work proceeds on its own repo lane under the usual PR review.
