---
type: Decision
title: Proposed Git workspace composition separate from development capability packaging
description: Use a Git-backed workspace definition for shared team composition while keeping reusable development behavior and legacy package compatibility separate.
status: proposed
tags: [workspace, packages, portable-souls, configuration, rollout]
timestamp: 2026-09-20
---

# Status

Proposed for human review: use the existing official `oats-dev` repository as the
OATS development workspace repository rather than create a redundant workspace
repository or keep expressing new team composition primarily as the `oats.dev`
package's legacy config template.

This does not remove the published package, change a catalog entry, adopt a
workspace, grant membership or migrate a deployment. Concrete source exports,
knowledge visibility and operator choices remain explicit decisions.

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
Membership requires reciprocal admission; importing an external soul or consuming
a package does not automatically make its repository a member.

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

1. **Create a separate workspace repository.** Clear naming, but adds another
   repository without an identified architectural need.
2. **Use `oats-dev` as the workspace repository.** Recommended: give its root a
   clear workspace purpose while retaining legacy package sources/tags as needed.
3. **Keep a config-template package as the primary composition mechanism.**
   Retains the old setup approach instead of exercising the shipped Git workspace
   model; still valid for legacy consumers, but not the proposed new default.

The recommended separation is:

| Surface | Responsibility |
|---|---|
| Workspace repository | `oats-workspace.yaml`, intended repository membership, explicit soul imports, shared defaults and onboarding documentation |
| Framework/source libraries | Kernel/Desktop code and deliberately published reusable soul definitions/exports |
| Capability repositories | Actual knowledge, messaging, tasks and other reusable behavior |
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
- Deprecating the legacy package/template is a separate reviewed change with
  explicit guidance, not an automatic consequence of adding a workspace file.
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
