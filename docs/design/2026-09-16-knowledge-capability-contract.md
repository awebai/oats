---
type: Decision
status: accepted-boundary
title: Knowledge and messaging capability contract boundary
description: OATS provides generic selection, lifecycle and execution contracts; knowledge and messaging capabilities implement their own behaviour.
timestamp: 2026-09-16
---

# Knowledge and messaging capability contract boundary

**OATS provides contracts; capabilities provide functionality.** The kernel
has no knowledge model, harvester, messaging backend or identity system of its
own. The official providers are `oats.okf` (knowledge) and `oats.aweb`
(messaging); any other capability may fill either slot with a different model.

## Responsibilities

| Kernel supplies | The capability owns |
|---|---|
| Selection: one provider per slot, resolved from the soul and the workspace defaults, copied into the home at its locked commit | Interpreting its own settings and declarations; the kernel treats them as opaque |
| Lifecycle hooks (`spawn`, `launch`, `retire`) with the hook environment: settings and their origins, the home, the soul, the teams | What happens at each event: registering a source, minting an identity, joining a team, handing off at retirement |
| A required spawn hook's failure rolls the spawn back; every other hook is advisory | Reporting its own outcome truthfully in the hook answer |
| Command and operation dispatch from the copied module, and the readiness relay (`binding.check`) | Its commands, operations and readiness answer |
| The soul's teams, as declarations | Enrolment, membership, transport and wake delivery; a declared team is not proof of enrolment |

The contracts themselves are in [capabilities.md](../capabilities.md): hooks
and their environment, commands, operations and the readiness check.

## Rules

- **No second engine.** A capability does not get its own resolver, config
  parser or command registry in the kernel; a missing generic field is added
  once, to the shared contract, and versioned.
- **Knowledge.** The provider decides where knowledge lives, who reads and
  owns what, how evidence is captured and judged, and how accepted knowledge
  is delivered. `oats.okf`'s model (owned nodes in central bases, independent
  harvest, PR-only Git delivery) is the reference, not a requirement for
  alternatives ([knowledge theory](../knowledge-theory.md)).
- **Messaging.** The provider owns identity, addressing, teams and delivery,
  using only the authority it is given. Configuration never implies privacy or
  access: contact, delivery and history are verified through the provider's
  own mechanisms.
- **No secrets in the contract.** Hooks contribute locators and endpoints,
  never credentials, and nothing credential-bearing is recorded in
  `instance.json` or logs.
- Capability ownership does not waive repository governance, work
  boundaries or truthful lifecycle reporting.
