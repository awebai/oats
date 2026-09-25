# The OATS contracts

OATS supplies common contracts; capabilities supply behavior. The current architecture combines [Git workspaces and portable sources](workspaces.md), retained instance execution and provider-owned knowledge, messaging and tasks.

This page is the current conceptual map, not a replacement for the versioned schemas or a claim that every provider/profile is implemented. Use [release scope](release-notes/v0.24.0.md) and actual readiness results. Earlier contract inventories remain in [Git history](https://github.com/awebai/oats/blob/249899a9a1ae865cc640fbc52b3585765fba473f/docs/layers.md); dated designs are navigated through the [design index](design/README.md).

## How the pieces fit

```text
Git workspace definition
  ├── admits repositories with reciprocal backlinks
  ├── supplies bounded defaults and provider declarations
  └── imports exported souls by source reference and revision
        └── soul declares requirements, defaults and software sources
              └── resolution pins and records an exact composition
                    └── instance runs against an independent work target
                          ├── knowledge capability
                          ├── messaging capability
                          ├── tasks capability
                          └── any additional capabilities
```

The workspace definition, source repository, local deployment, work target and messaging team are different identities. They may share a repository or machine without becoming interchangeable authority.

## Soul format

Portable `soul.yaml` uses `schemaVersion: 1`, a name, optional role/runtime/work preferences and explicit requirements/defaults. Canonical `AGENTS.md`, its `CLAUDE.md` alias and the declared resources provide the operating curriculum. See the [schema](soul.schema.json).

A soul can require a concrete implementation **and its source**, or require a provider by presence with supported defaults/operator choice. Naming OKF or a tracker does not make a soul malformed: it makes a particular source policy explicit. A source that genuinely promises interchangeable implementations must use compatible requirements and test that claim.

Concrete capability selections carry `source`; software must not be inferred from an ambient installation or the publisher's unshared config. Imports retain source identity and revision rather than creating local forks. Source updates do not silently rewrite an existing instance's retained curriculum.

Classic `kind`/`type`/`repo` declarations and config-targeted agent types are a compatibility model, not mandatory fields or a third policy tier in portable resolution. See [souls and instances](souls-and-instances.md) and [classic configuration](configuration.md).

## Workspace, repository and adoption contracts

- `oats-workspace.yaml` (v2) declares members, the pinned `packages:`, team labels, defaults per slot and per team, stores, the messaging payload and pinned `external:` souls.
- `oats-membership.yaml` is a repository's half of the handshake: the workspace backlink plus an optional default team label. Everything under `souls/` and `capabilities/` is discoverable by convention (`private: true` opts out); there are no export lists.
- Membership requires compatible observations on both sides; folder adjacency or a copied declaration is not admission.
- External source import does not adopt the publisher's workspace. A framework repository may host its own development workspace without imposing it on consumers.
- Operator choices and workspace defaults must respect source requirements. Git read access is not write permission, a trust declaration or messaging enrollment.

The [workspace guide](workspaces.md) explains these boundaries and the [declaration contract](design/2026-09-15-portable-declarations.md) defines their versioned forms.

## Capability manifest and lifecycle events

A capability's `oats.json` declares its identity, an optional `layer` field (which names the core capability it is, if any), resources, host/runtime prerequisites, commands, operations and supported lifecycle contributions. A distribution package's `oats-package.json` exports one or more capabilities; a package is not itself an active capability or workspace.

The current [manifest schema](capability-manifest.schema.json) includes the published binding interface and helper/input declarations. A manifest shape alone does not certify its implementation:

- Captured core capabilities expose their declared normalize/bind/check phases through the existing broker. The kernel resolves their fields without implementing their domain model.
- Commands/hooks execute only from a declared source (a member, or a package the workspace declares, at its locked commit and integrity) — or, for a prepared artifact, its exact `oats trust` approval — and with invocation authority.
- Helper behavior and optional source-receipt inputs are declared by their owner, not guessed from a layer name.
- Required setup/capture outcomes cannot be silently omitted to make a launch or cleanup appear successful.
- Legacy hook environment and captured binding/invocation inputs are distinct contracts. A legacy hook is not automatically safe for retained execution.

Use [capability details](capabilities.md), the [provider wire](design/2026-09-16-provider-binding-wire.md), [helper/input contract](design/2026-09-17-capability-helper-input-contract.md) and [package runtime boundary](design/package-runtime-api.md).

## The three core capabilities

Knowledge, messaging and tasks are the **core capabilities**: at most one of each per soul, each filling its own slot. `none` is an explicit permitted choice only where requirements allow it; it empties that slot. Other capabilities are unlimited and nonexclusive; the three core capabilities do not limit domain tools or workflows.

### The knowledge contract

The kernel supplies selection, retained identity/resources, exact locking, invocation/lifecycle context, independent helper execution and truthful outcomes. It does not mandate OKF, memory filenames, a taxonomy, a harvester or external-only mutable placement.

The knowledge capability supplies organization, stores, readers, evidence capture, judgment, maintenance and delivery/acceptance policy. Mutable knowledge is never permission to alter immutable retained software/source artifacts.

The reference OKF model uses centralised per-soul knowledge, stable ownership/read routing, independent promotion and PR-only Git delivery. `owns` routes harvests; `reads` selects context; neither is an ACL. Directory publication, a proposed PR, an accepted merge and a fresh reader's observation are separate facts.

Alternatives may choose different placement or learning procedures. A supported co-located profile is not implied merely because the architecture allows one. See [knowledge theory](knowledge-theory.md), [version-scoped operations](knowledge.md) and [provider-neutral boundary](design/2026-09-16-knowledge-capability-contract.md).

### The tasks contract

The tasks core capability owns work assignment, claims, status, blockers, outcomes and handoff procedures. OATS supplies the selected capability/runtime boundary, not one mandatory tracker workflow. Jira and Linear are available tasks capabilities; none is mandatory when source requirements permit `none`.

Messaging is conversation, not automatically task state. Accepted knowledge may explain a decision or important situation without duplicating the tracker.

### The communication contract

The current slot name is **`messaging`**. The capability owns native identity, addressing, team membership, transport, wake delivery and qualification. A team alias in a workspace is a declaration, not proof that an actor is enrolled or a privacy property is enforced.

aweb 1.10.3 supports its legacy setup/lifecycle path but lacks the captured provider-binding interface. **aweb 1.11.0** (OATS >=0.24.2) adds it (1.11.2, OATS >=0.24.4, is code-identical and declares its fixed reasons and `helperInjection: omit`): `check` qualifies HOME-route operational custody for an input-capable Claude/Codex primary with an explicit private team and `delivery: session`; a strict-Pi print primary reports `needs-configuration` rather than dropping the requirement. Qualification is not account delegation, broker delivery or model consumption.

The earlier proposed `reach` ladder is **not an enforced universal field**. In particular, aweb's `team_and_contacts` includes verified same-team senders; the compatibility spellings `contacts-only` and `contacts_only` do not establish owner-only admission. A config command succeeding proves neither inbound/outbound restrictions nor knowledge visibility. See the [identity/membership amendment](design/2026-09-08-expert-assisted-deployment-proposal.md#membership-reach-and-visibility-are-separate) and [messaging boundary](design/2026-09-16-messaging-capability-contract.md).

Roster membership is not a live process or a responsive session. Retirement may leave provider-side records or incomplete cleanup; inspect the actual outcome rather than promising aliases disappear.

## Runtime and work-target contracts

The selected runtime owns its normal model/authentication/profile mechanisms. OATS supplies complete composed resources, task, work selection and retained execution authority; it does not copy or repair credentials or enable permission bypass merely because a session is unattended.

Pi, Claude Code and Codex have version/profile-specific support. Claude Code and Codex retain normal native context and permissions; strict selected Pi execution has its own verified profile limits. Tmux and Herdr are backend choices, not soul identities. A source can support several realizations without every combination being qualified.

The work target is independent of source publication and knowledge placement. Preserve the selected work-mode discipline and ownership. Unsupported required lifecycle, wake, plugin or recovery behavior must remain explicit, not be replaced with an easier hidden profile. See [execution targets](execution-targets.md) and the [release notes](release-notes/v0.24.0.md).

## Kernel briefings versus operational capabilities

The kernel owns only what describes the layout it creates: the `instance-boundary` briefing (home versus `work/`), the selected work-mode briefing and config-declared injections. Knowing how to *operate* OATS (status, spawn, retire, soul discovery) and how to *configure* it (workspaces, packages, the lock) is capability content — the official capabilities `oats.core` (a workspace default via `defaults.capabilities`, removable per soul with `off`) and `oats.setup` (held by an onboarding expert), both provided by the `oats.framework` package; see [souls and instances](souls-and-instances.md#oats-operational-knowledge-is-a-capability).

## Capture and knowledge are separate

The native turn record is an evidence substrate, not accepted knowledge or a compulsory fourth core capability. A capability decides which evidence it consumes and how it judges it. Source attribution, before-read custody and incomplete-outcome handling remain necessary wherever those guarantees are promised.

A successful capture is not a completed judgment; completed judgment is not accepted Git knowledge. Source loss or retirement must not erase pending obligations or make an uncertain record complete. See [the record package](../packages/record/README.md) and the relevant versioned lifecycle contracts.

## Replaceability without invented readiness

A capability boundary is useful when implementations can differ without a new kernel-owned version of their behavior. But:

- Two stores within OKF are not proof of a genuinely different knowledge model.
- Schema validation is not native authority, provider readiness or learning.
- A working old configuration does not prove compatibility with a new captured profile.
- Workspace membership does not select every capability a member exports.
- Published primitives and documentation do not constitute a completed deployment.

Use the same kernel contracts, preserve declared requirements and verify the specific supported profile. New generic authority or schema semantics require an explicit decision rather than an undocumented bypass.
