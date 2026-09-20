# Design documents — navigation

Dated design documents record how decisions were reached and what each implementation slice was bounded to. They are **history with current pointers**: the current architecture is explained in [workspaces](../workspaces.md), [contracts](../layers.md), [souls and instances](../souls-and-instances.md) and [knowledge theory](../knowledge-theory.md); readiness is stated in the [release notes](../release-notes/). When a dated document and a current page disagree, the current page wins.

## Current plan

- [Redesign program board](2026-09-20-redesign-program-board.md) — live status of every work stream (knowledge contract, workspace adoption, messaging readiness, official capabilities, marketplace, five souls, centralised knowledge, Desktop), owners and blockers.
- [Workspace-first adoption plan (2026-09-20)](2026-09-20-workspace-and-portable-adoption-plan.md) — phase order, lane ownership, distribution work packages (`oats.core`, `oats.setup`, official marketplace), exit gates.

## Portable Souls and Git workspaces — the architecture

- [Portable Souls explainer](2026-09-14-portable-souls-explainer.md) — the short version.
- [Portable souls and Git-backed workspaces](2026-09-14-portable-souls-and-git-workspaces.md) — the accepted architecture.
- [Contract amendments (14 Sep)](2026-09-14-portable-souls-contract-amendments.md) · [portable declarations](2026-09-15-portable-declarations.md) · [portable data/digest contract](2026-09-15-portable-data-contract.md) · [source observation](2026-09-15-source-observation.md).
- [Fresh-install-first rollout](2026-09-16-fresh-install-first-rollout.md) · [fresh operator walkthrough](2026-09-16-fresh-operator-walkthrough.md) · [portable onboarding and discovery](2026-09-16-portable-onboarding.md) · [migration evidence](2026-09-16-portable-migration-evidence.md).

## Retained execution — artifacts, approval, capture

- [Artifact retention](2026-09-14-artifact-retention-contract.md) · [selection lock and approval](2026-09-15-selection-lock-and-approval.md) · [captured resolution records](2026-09-15-captured-resolution-records.md).
- [Package preparation](2026-09-15-package-preparation.md) · [command/curriculum preparation](2026-09-16-command-profile-preparation.md) · [prepare request transport](2026-09-16-prepare-request-transport.md) · [public prepare request](2026-09-17-public-prepare-request.md).
- [Captured dispatch](2026-09-15-captured-dispatch.md) · [captured admission](2026-09-16-captured-admission.md) · [retained helper dispatch](2026-09-16-captured-helper-dispatch.md) · [retained launch inputs](2026-09-16-captured-launch-inputs.md).
- [Boundary resources](2026-09-17-portable-boundary-resources.md) · [boundary hookup](2026-09-17-portable-boundary-hookup.md) · [captured native start](2026-09-17-captured-native-start.md) · [public captured start](2026-09-17-public-captured-start.md).
- [Backend parity: tmux and Herdr](2026-09-17-captured-backend-parity.md) · [Herdr protocol compatibility](2026-09-18-herdr-protocol-compatibility.md) · [captured Pi print host](2026-09-18-captured-pi-host.md).
- [First-cut release checklist](2026-09-18-first-cut-release-checklist.md).
- Implementation records: [implementation](2026-09-15-portable-souls-implementation.md) · [handoff](2026-09-15-portable-souls-handoff.md).

## Capabilities and providers

- [Package engine contract](package-engine-contract.md) · [package-runtime API](package-runtime-api.md) · [operations contract](operations-contract.md) · [launch configurations](launch-configurations.md).
- [Provider binding wire v1](2026-09-16-provider-binding-wire.md) · [provider binding codecs](2026-09-16-provider-binding-codecs.md) · [capability helper/input contract](2026-09-17-capability-helper-input-contract.md).
- [Knowledge capability contract](2026-09-16-knowledge-capability-contract.md) · [messaging capability contract](2026-09-16-messaging-capability-contract.md).

## Knowledge and memory

- [Knowledge and memory direction](2026-09-13-knowledge-and-memory-direction.md) · [knowledge location contract](2026-09-13-knowledge-location-contract.md) · [knowledge implementation plan](2026-09-13-knowledge-implementation.md) · [OKF mirror provenance](okf-mirror-provenance.md).

## Product direction and Desktop

- [Architecture reassessment](2026-09-07-architecture-reassessment.md) · [expert-assisted deployment](2026-09-08-expert-assisted-deployment-proposal.md).
- [Desktop UX plan](desktop-ux-plan.md) · [souls and capabilities in Desktop](2026-09-07-desktop-souls-capabilities.md) · [mobile management proposal](2026-09-07-mobile-agent-management-proposal.md).

Adding a design doc: date-prefix it, state its status in the first lines, and add it here under the right theme.
