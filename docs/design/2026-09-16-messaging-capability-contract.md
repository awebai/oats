---
type: Decision
status: accepted-boundary
title: Messaging capability contract boundary
description: Define generic messaging inputs and outcomes in OATS, then implement their provider behavior in oats.aweb.
timestamp: 2026-09-16
---

# Messaging capability contract boundary

OATS supplies the messaging contracts; the selected messaging capability consumes
them. `oats.aweb` owns the aweb implementation. This follows the accepted
[Portable Souls decisions](2026-09-15-portable-souls-handoff.md), not a new kernel
messaging backend or OATS-hosted identity/permissions system.

## Existing shared contracts

Reuse [provider wire v1](2026-09-16-provider-binding-wire.md), ProviderBinding1,
MessagingChoice1, execution bindings and manifest-owned commands/hooks.

| Contract responsibility | Kernel supplies/enforces | Capability implements/reports |
|---|---|---|
| Selection | One selected provider, exact artifact approval, shared resolver choices | Provider-domain normalization/binding, no hidden precedence |
| Ownership/context | Responsible-human reference; qualified workspace or explicit standalone key; inherited owner for children/jobs | Native reference resolution and proof it addresses the intended human/context |
| Membership intent | Private floor plus explicit wider set; source/team declarations are not enrollment | Native private-team provision/reuse and wider membership reconciliation |
| Invocation | Exact execution binding, validated instance/subject and action/event, own binding and prior provider receipt | Native operation using only supplied authority and supported credential lookup |
| Outcomes | Typed readiness, action/result and cleanup custody; nonsecret retained receipts | Provider-specific identity/team/member references and actual evidence |
| Access | Four distinct expected grants, no privacy inferred from configuration | Verification through actual catalog/live/contact/history mechanisms |

The existing generic wire is implemented. The exact additional captured messaging
lifecycle projection, if required, must be reviewed/versioned before hookup. It
must derive from the captured record and invocation, not ambient team/configuration
or a knowledge-specific source declaration. This table does not invent a second
command table, resolver or readiness protocol.

## Phase and effect boundary

- Normalize/bind compile supplied intent into nonsecret provider data and common
  messaging choices. No identity/team enrollment occurs merely from acquisition.
- Check is read-only and action-specific. A setup action may be admissible when
  authorized to provision; that is not proof membership already exists.
- Explicit capability setup/lifecycle actions perform permitted mutations, retain
  receipts and handle retries/cleanup. Subsequent readiness reflects actual state.
- Unadapted captured actions refuse before using live legacy configuration. No
  hidden fallback, arbitrary team creation or identity borrowing is acceptable.

## Getting the aweb capability working

Investigate and use supported aweb identity, team, membership and transport
mechanisms inside the capability. A missing field in `whoami`, or absence of a
single human/context lookup command, is not sufficient to declare the design
blocked. Establish the native resolution/reuse mechanism and its authority; where
that truly cannot be implemented, report the precise missing backend contract.

The four grants intentionally need not share a native API. Compose their separate
mechanisms without treating contact as history access. Preserve the no-new-OATS-
control-plane constraint and validate cross-host identity/private-team reuse with
real provider evidence before claiming privacy. Fixtures and connectivity alone
remain insufficient. No credential values belong in captured contracts or logs.
