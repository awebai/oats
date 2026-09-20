---
type: Decision
title: Proposed Git workspace composition separate from development capability packaging
description: Use a Git-backed workspace definition for shared team composition while keeping reusable development behavior and legacy package compatibility separate.
status: proposed
tags: [workspace, packages, portable-souls, configuration, rollout]
timestamp: 2026-09-20
---

# Status

Latest recommendation for human review: host the OATS development workspace
definition in the `oats` framework repository and keep `oats-dev` focused on
reusable development capabilities. The human raised this alternative after the
initial proposal to reuse `oats-dev` as the workspace repository. Both arrangements
are valid; co-hosting in `oats` preserves the development package's distinct purpose
without adding a repository or repurposing its home.

This does not remove the published package, change a catalog entry, adopt a
workspace, grant membership or migrate a deployment. Concrete source exports,
knowledge visibility and operator choices remain explicit decisions.

The subsequent human-directed order is workspace/portable adoption first, then
knowledge centralisation and the five expertise souls. The
[execution plan](https://github.com/awebai/oats/blob/main/docs/design/2026-09-20-workspace-and-portable-adoption-plan.md)
uses this repository separation as its recommended target and preserves the
published development package during transition. Choosing the workspace home
must not silently choose all portable source identities or approve live cutover.

# The distinction

- A **workspace definition** describes shared organisational composition:
  admitted repositories, source imports, defaults, knowledge-store declarations,
  discovery catalogs and team references.
- A **capability** supplies behavior, instructions, skills and any declared
  operations/helpers. It is selected and approved through the normal contracts.
- A **distribution package** transports capabilities and may offer editable
  config templates. It is not itself workspace membership or an active team.
- A **local deployment** is an operator's realization of those declarations,
  with local mappings, state, credentials, supported execution and approvals.
  Several deployments can use the same workspace without sharing live sessions.

Git-backed workspaces are an existing Portable Souls contract, not a proposed
new configuration parser. The relevant files are `oats-workspace.yaml` for the
workspace and `oats.yaml` for repository exports and optional workspace backlinks.
These two files may coexist in the same repository: the workspace is a logical
role, not a requirement for a dedicated Git repository. Membership still requires
reciprocal admission, including explicit admission/backlink when the host repository
also participates as a member. The existing discovery code has no rule requiring
the workspace and member repository identities to differ; qualify the concrete
same-repository layout during adoption.

Importing an external soul or consuming a package does not automatically make its
repository a member or select its publisher's workspace. This is especially important
when the generic framework and its own development workspace share a repository.

Workspace defaults remain bounded by soul requirements and explicit adoption or
operator choices. Team references are not enrollment, knowledge declarations are
not a ready writer, and a successful parse is not deployment qualification.

# What the existing development package contains

The published `oats.dev`1.0.0 package is not just a name for a team. It exports:

- The `oats.review`1.2.0 capability: a reviewer agent, code/security review skills
  and injected review/developer-delivery discipline.
- A default legacy `oats-config.yaml` template.
- Dependencies on OKF, messaging and authoring packages.

Its manifest at the published source still names the older OKF1.4.1 and messaging
1.8.0 dependency selectors. Installed deployments may have deliberately different
locked versions and local config changes. Package version, exact installed commit,
adopted template baseline and effective local policy must be inspected separately.

The current framework catalog selects `oats.dev`1.0.0. That version number alone
therefore does not establish an outdated installation; its old composition role
may be what needs replacing. A selector without a version remains exact on bare
restore when a valid lock records its source revision and integrity.

# Options and recommendation

1. **Host the workspace definition in `oats`.** Latest recommendation: the
   framework repository carries `oats-workspace.yaml` alongside its own `oats.yaml`
   exports; `oats-dev` remains a development-capability repository. Workspace policy
   shares the framework repository's access and review lifecycle. Generic framework
   consumers are not automatically enrolled in this development workspace.
2. **Use `oats-dev` as the workspace repository.** Valid alternative, initially
   recommended, but mixes that repository's existing capability/package role with
   shared team composition. It is not necessary if retaining its dedicated purpose
   is preferable.
3. **Create a separate workspace repository.** Useful if workspace policy needs
   independent access control or a different review/release lifecycle. No such
   requirement has yet been established. Moving the workspace later is an explicit
   identity/adoption transition, not a transparent directory rename.
4. **Keep a config-template package as the primary composition mechanism.**
   Remains supported for legacy consumers, but does not exercise the proposed Git
   workspace setup.

The recommended separation is:

| Surface | Responsibility |
|---|---|
| Workspace role, hosted in `oats` | `oats-workspace.yaml`, intended repository membership, explicit soul imports, shared defaults and onboarding documentation |
| Framework/source-library role, also in `oats` | Kernel/Desktop code and deliberately published reusable soul definitions through `oats.yaml` |
| Capability repositories, including `oats-dev` | Actual development, knowledge, messaging, tasks and other reusable behavior |
| Knowledge repository | Curated accepted expertise, with explicit visibility and acceptance policy |
| Operator deployment | Local realization, execution state, credentials and operator-owned choices |

The workspace imports the chosen five expertise roles by source reference and
revision rather than copying their definitions. Their final publisher/export
paths remain subject to the [source-edition proposal](/decisions/portable-role-editions-and-bootstrap.md).
Do not silently move those identities merely because a workspace home is selected.

# Safe transition

- Introduce workspace declarations through the existing validated contracts and
  coordinated member backlinks. Do not require every consumer repository to join
  or enroll unrelated deployments in the redesign.
- Keep immutable published tags, exact locked revisions and the existing package
  payload reachable. Do not rename/remove the repository or break old restores.
- Decide whether reusable review behavior is selected in the new setup. It can
  remain a separately selectable capability/skill resource; a workspace file
  does not replace the implementation. Do not delete it merely because the old
  template is no longer the preferred setup path.
- Keep `oats.dev` as the development-capability package if its behavior is useful;
  separately align its requirements, exports and optional legacy template with the
  new composition path. Deprecation of any package/template is a distinct reviewed
  change, not an automatic consequence of adding a workspace file.
- Preserve each deployment's deliberate model, messaging-delivery and helper
  identity policy. Translate intent against the new contracts rather than copy
  old selector spellings blindly; required capabilities may not be disabled to
  obtain readiness.
- Configuration and exact nonsecret provenance may be shared through Git where
  appropriate; never equate that with sharing credentials, live instances or
  machine-local state. Adopting/updating the shared definition remains deliberate.

This fits the proposed [knowledge alignment and expert cutover](/decisions/knowledge-alignment-before-expert-cutover.md):
use the shared workspace to express the agreed setup, then qualify real reading,
learning and delivery before activating the new roster. Choosing a repository
alone does not close provider readiness or supply the migration evidence.

# References

- `docs/oats-workspace.schema.json`, `docs/oats-member.schema.json` and
  `lib/workspace-definition.mjs` in the framework repository.
- `docs/design/2026-09-15-portable-declarations.md`, workspace/export/import section.
- `docs/design/2026-09-14-portable-souls-and-git-workspaces.md`, reciprocal membership.
- [Published development package manifest](https://github.com/awebai/oats-dev/blob/v1.0.0/oats-package/oats-package.json)
  and [review capability manifest](https://github.com/awebai/oats-dev/blob/v1.0.0/oats-package/capabilities/oats-review/oats.json).
