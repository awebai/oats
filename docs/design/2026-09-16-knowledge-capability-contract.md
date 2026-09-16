---
type: Decision
status: accepted-boundary
title: Knowledge and harvesting capability contract boundary
description: OATS provides generic context, binding, lifecycle and execution contracts; capabilities implement knowledge and harvesting functionality.
timestamp: 2026-09-16
---

# Knowledge and harvesting capability contract boundary

**OATS provides contracts; capabilities provide functionality.** Knowledge and
harvesting follow the same separation as the
[messaging capability contract](2026-09-16-messaging-capability-contract.md).
The reference knowledge theory remains optional authoring guidance, not a mandatory
runtime model or a kernel-owned harvester.

## Responsibilities

| Kernel contract/support | Capability functionality |
|---|---|
| Selection, exact executable approval and the shared resolver | Interpret provider-owned declarations; validate and render its nonsecret bindings |
| Verified captured source/instance/context and bounded invocation data | Select/read the knowledge relevant to that context through its own model/tools |
| Generic lifecycle events, hook outcomes and cleanup custody | Initialize its memory protocol, capture/freeze inputs and perform its own retirement handoff |
| Generic native evidence APIs where applicable | Choose which evidence to collect, how to interpret it and its durable source/cursor format |
| Source-independent helper/job execution, exact artifact/record references and admission identity | Supply harvester helpers, prompts, runtime conventions, schedules and input/destination receipts |
| Truthful execution/uncertainty and declared operation result contracts | Judge promotion, validate, retry, publish and establish provider-specific acceptance |

Reuse ProviderBinding, captured invocation/lifecycle, declared operations and
execution capsules. Any missing generic field is reviewed/versioned once. Do not
introduce a second config parser, resolver, command registry or harvesting engine.
Capability-specific data remains opaque to the kernel.

## Default OKF versus alternatives

`oats.okf` owns stores/nodes, reads/owns, immutable views, STATE/log/notes conventions,
durable source descriptors, harvester judgment and store-specific delivery. Its
existing promotion bar and PR-only Git knowledge publication remain in force.
Other capabilities may use different models, stores and harvesting machinery;
they are not required to imitate OKF's filesystem or workflow.

The knowledge-theory expert is an authoring aid, not a runtime dispatcher,
universal harvester or required approval service. Capability ownership does not
waive repository governance, work boundaries, secret exclusions, exact executable
approval or truthful lifecycle/custody reporting.

## Integration checks

- Audit helper memory/injection suppression and source handoff projection for
  accidental kernel-owned knowledge policy. Move new behavior behind neutral
  contracts or capability declarations as appropriate; do not blindly enable
  recursive harvesting or weaken existing fail-closed guards.
- A knowledge-specific source receipt may remain a compatibility input for a
  provider, but must not become the mandatory shape for every alternative.
- Retirement must honor required capture/handoff outcomes before deleting their
  source. The capability supplies the evidence and outcome; the kernel does not
  implement the provider's memory/promotion algorithm.
- Independent work must retain everything it needs through the existing execution
  and provider custody contracts, without a live source/config fallback.

This records the boundary and remaining audit, not a claim that every consumer is
already refactored or that a fresh deployment/live harvester is qualified.
