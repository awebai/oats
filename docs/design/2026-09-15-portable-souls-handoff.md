---
type: Playbook
status: accepted-for-implementation
title: Portable Souls infrastructure implementation handoff
description: Portable binding contracts, fifteen decisions, storage-only baseline and dependency-ordered delivery gates; Desktop features later.
timestamp: 2026-09-15
---

# Portable Souls infrastructure implementation handoff

**Direct human authorization now permits infrastructure implementation/deployment.**
It supersedes the previous “not implementation authorized” status, not any of the
15 decisions or the landed retention contract. This documentation-only lane makes
no operational changes: no commits/pushes, branch switches, live installation or
activation, credential work, schedulers, models/GUI/session control. The held
capture patch `54b07ee` must never be integrated. **Desktop feature work is later.**

**Rollout amendment (2026-09-16):** [fresh installation is the current delivery path](2026-09-16-fresh-install-first-rollout.md).
General historical conversion/reconstruction and more migration CLI work are deferred,
not release-critical. The architecture and evidence/custody rules below still apply;
existing knowledge, work, histories and identities are not implicitly disposable.

## 1. Portable contract reading order and baseline

All required design text now lives at repository-relative paths; no private
instance review file or original conversation is an acceptance dependency.

| Order | Document | Authority / state |
|---|---|---|
| 1 | [Explainer](2026-09-14-portable-souls-explainer.md) | Reconciled illustrations; all LFX examples hypothetical, not deployment facts. |
| 2 | [Proposal](2026-09-14-portable-souls-and-git-workspaces.md) | Accepted design; full substantive amendment integrated coherently. |
| 3 | [Verbatim substantive amendment](2026-09-14-portable-souls-contract-amendments.md) | Public universal design appendix; transport metadata omitted, technical text preserved. |
| 4 | [Retention contract](2026-09-14-artifact-retention-contract.md) | Landed and binding: store semantics, captured resolution and consumer migration. |
| 5 | [Implementation checklist/ledger](2026-09-15-portable-souls-implementation.md) | Clause-by-clause mapping, dependency order, evidence and pending gates. |
| 6 | [Knowledge direction](2026-09-13-knowledge-and-memory-direction.md) and [current knowledge runtime](../knowledge.md) | Doctrine/context; the older brief's §4.9 automatic skill-delivery account is superseded by OKF v2 (no automatic soul-skill edits). Its older location/type mechanisms are not a second Portable Souls authority. |
| 7 | [Package engine](package-engine-contract.md) and [runtime API](package-runtime-api.md) | Existing acquisition/trust/runtime invariants; explicit Portable Souls migration changes store/resolution semantics, not silently these contracts. |
| 8 | [Retention source](../../lib/capability-artifacts.mjs) and [tests](../../test/capability-artifacts.test.mjs) | Storage prerequisite; not complete instance/job dispatch. |

Implementation baseline: `428cd9af615652c4a93d754c1106674abd18545b` on the isolated
`feat/portable-souls-infrastructure` worktree. There is no instruction to merge,
rebase or switch branches. Primary checkout and older roster/knowledge drafts are
outside this delivery lane. This handoff describes baseline evidence, not a claim
that concurrent worktree edits are landed or deployed.

## 2. The decisions (binding)

1. **Three responsibilities.** The soul declares what it needs and where it comes from; the workspace definition declares admission, defaults, knowledge stores, team references and catalogs; the local deployment resolves, installs, binds credentials and keeps state. Source location, install location, work target and team membership are four separate facts; none is inferred from another.
2. **Source-complete soul declarations.** Every intrinsic capability carries a source (`git:<repo>@<selector>#<package-path>`); same-repository packages use `repo:<path from repository root>` at the soul's retained snapshot; `path:` is reserved for honestly nonportable local inputs. Never `./`.
3. **`requires` vs `defaults` in a soul.** Requirements are constraints every composition satisfies; defaults are fallbacks an operator or import entry may rebind. Conflicting requirements fail with both origins reported.
4. **Precedence: two levels, no repository tier, no agent-types.** Workspace defaults, then the soul's declarations; explicit operator choice (import-entry adoption defaults or spawn-time choice) is bounded: it may rebind defaults and bindings, never erase a hard requirement. Two authorities, one resolver. Repository briefing (`agents-md-injection`) and worktree setup stay as work-target behaviour, selected from the repository actually worked on.
5. **Reciprocal membership for every member kind.** A repository is a member when the workspace admits it and it names the workspace, at recorded revisions with qualified identities. Applies equally to project, experts, capabilities and knowledge repositories. Consuming a source (package, public soul, public store) is never membership. Forks with a copied backlink are not members.
6. **External-soul import by reference, never by copy.** Fields: canonical source repository, exported soul path, revision selector, adopter-local alias. Exact revision and needed source files retained; upstream identity, revision and alias are distinct. Workspace may advertise the import without admitting the source repository; standalone prepare accepts the same reference. Adoption defaults on the entry (team-alias map, knowledge destination, provider rebindings) are workspace-side, keyed to the qualified upstream identity, bounded as in 4.
7. **Souls live in project repositories first**, under `agents/<name>/`, as many per repository as wanted; an experts repository is for subjects spanning repositories. Souls are named for expertise, not job titles.
8. **Knowledge.** Declared at both levels: the workspace lists stores and the default provider (discoverability); the soul carries store-qualified `reads` and `owns` with optional destinations so it can read and harvest without the workspace repository. One explicit steward per node; explicit destination per promoted concept; no "one store per soul" invariant. Public PRs are fine: steward, proposing harvester and accepting maintainer are three roles. Open-source souls may consume open-source stores; reading a public store never publishes adopter notes. The kernel's knowledge contract is provider-neutral; owns/reads and harvester promotion describe the default provider (OKF).
9. **Teams: private first, wider by choice.** Each human's instances in a workspace auto-join a private team keyed by a provider-resolvable human identity plus qualified workspace identity, reused across that person's machines; children and scheduled instances inherit the owner; messaging-disabled workers create no team. Wider teams the soul lists are opt-in per instance; an explicit wider set replaces wider defaults but keeps the private floor. Catalog visibility, live-instance visibility, contact and conversation-history access are four separate grants; contact is not history. **No privacy guarantee is claimed until a named messaging owner qualifies provider behaviour.**
10. **One default provider per fundamental slot** is a v1 product simplification, labelled as such; simultaneous Jira + GitHub stays an explicit design test.
11. **Immutability.** Humans pick a channel or a pin; preparation resolves once per transaction into a captured resolution (soul snapshot, capability closure, helpers, commands/hooks, non-secret config and binding provenance); instances and queued work dispatch from that record, never from the ambient lock; several artifacts per capability coexist; one artifact per capability id per instance; conflicts fail with both paths. Pinned = OATS-managed composition only; not knowledge contents, credentials, memberships, work repo, external services, host tools.
12. **Trust.** Executable = commands, hooks or environment; a changed executable artifact needs fresh approval per revision; declarative skill changes are visible in the update notice but not gated. Freshness v1: refresh on explicit prepare/update, show available-unapproved beside last-approved (never "latest"), no daemon, no unattended approval.
13. **Digest.** At the migration boundary, a versioned digest over file bytes, symlink targets and each regular file's executable flag normalised from the owner-execute bit, same for Git and `path:` sources; old digests stay verifiable and are never reinterpreted.
14. **Migration.** One-time explicit store/lock migration; existing instances recorded as `reconstructed`, `partial` or `unknown` with evidence; partial/unknown never passes for complete in CLI or Desktop readiness; never claim recovery of an artifact the flat store overwrote; running sessions preserved.
15. **No new infrastructure.** No registry, discovery daemon or OATS user database; Git hosting, the messaging provider and existing machines are the substrate.

## 3. What is built at the baseline

`lib/capability-artifacts.mjs` retains/verifies exact capability trees side by side,
without activation, approval or selection. Absence (`artifact-not-found`) is
distinct from invalid artifact/store shape or integrity drift; damaged retained
state is never silently repaired. The contract also covers invalid references and
containment refusals. Source copying preserves file permissions, but the **baseline
digest does not cover mode bits**; the mode-aware version is migration work.

The installer still overwrites `installed/<id>`, `prepareLaunchHooks` reloads
manifests by ID, and scheduled operations resolve at run time. Storage A/B tests
are not proof that an old instance or queued job dispatches A while new work uses
B. The [ledger](2026-09-15-portable-souls-implementation.md) separates these gates.

## 4. Dependency-ordered work

1. Reconcile proposal/explainer/handoff with the complete amendment and record the
   fifteen-clause checklist. This documentation lane owns only `docs/design/`.
2. Extract shared tree-copy/digest/publication mechanics into a narrow acyclic
   leaf before core imports retention; no policy or lifecycle logic in the leaf.
3. Define reviewed versioned captured-resolution and lock schemas; retain soul
   source separately by qualified identity/digest, with typed refusals. Source
   identity, exact revision and adopter alias are distinct. Store records outside
   homes, retain per-choice provenance/constraints and provider-neutral bindings.
4. Review/implement soul declarations: source-complete `git:`/`repo:`/`path:`,
   requires/defaults, store-qualified knowledge payload, teams. Validate containment.
5. Review/implement workspace/member descriptors (`oats-workspace.yaml`, `oats.yaml`
   are illustrative spellings): qualified reciprocal admission for every member
   kind, defaults/stores/team references/catalogs/imports; bounded data-only indexes.
6. Integrate four-field by-reference imports and workspace-side adoption defaults;
   identical standalone preparation, no copied soul or publisher backlink.
7. Preparation resolves once; publishes all artifacts; commits a complete resolution
   before launch; reports installed/trusted/configured/enrolled separately.
8. Complete the retention contract's five-step consumer migration: acquisition,
   launch/restart/retirement/recovery and independent queued work use captured
   records; evidence-grade old records; remove ambient lookups; version the digest.
9. CLI diagnostics expose choices, provenance, explicit freshness and incomplete
   migration honestly. Provider-neutral payloads do not compel OKF node semantics.
10. Private-team enrollment/privacy requires a **named messaging owner** and provider
    qualification. Until then record choices only, not guarantees. The simultaneous
    Jira + GitHub case stays a review test, not a new solver requirement.
11. Later Desktop features consume the same preparation/readiness APIs; do not bring
    GUI work, live model/session controls or scheduling into this infrastructure lane.

The [implementation plan](2026-09-15-portable-souls-implementation.md) supplies
prerequisites, owners by responsibility, tests and an acceptance ledger. Dependency
order is not permission to make undecided schema/product choices silently.

## 5. Acceptance that must be demonstrated

The complete explainer/proposal checks apply; these three scenarios are mandatory:

1. Import the **same unchanged public soul** into an organization and a standalone
   no-Git work target. Read public knowledge; bind an explicit adopter write
   destination; prepare without publisher workspace access. Verify upstream identity,
   exact retained revision and alias independently. Missing bindings stay incomplete.
2. Two humans on two hosts **each**, one workspace: reuse each private team across
   hosts; a child or scheduled instance inherits its human; widen/narrow one
   representative without changing global identity or knowledge bindings. Separately
   qualify catalog/live visibility, contact and history. No current privacy guarantee.
3. Existing instance and independent queued job stay on A; a new instance prepares
   approved B; remove original source and prove A still executes lifecycle/recovery
   resources without ambient substitution. Storage-only execution is insufficient.

Useful output and accepted knowledge are distinct from scaffold/launch/PR activity.
Live evidence and provider qualification are separate from this documentation pass.

## 6. Safety and unresolved review gates

- Keep the capture patch held; preserve running sessions and existing deployment
  inputs; never claim recovery of overwritten historical artifacts.
- Readiness must distinguish `reconstructed`, `partial`, `unknown`; partial/unknown
  cannot pass as complete. Software pins do not freeze knowledge, credentials,
  membership, work repositories, services or host tools.
- Parser/schema syntax for `repo:`, imports/adoption, reads/owns, requires/defaults,
  workspace exports, wire versions and store/lock migration details remain review
  work. Illustrative field names are not another parser or approved CLI flags.
- Canonical remote handling across renames/transfers requires explicit provenance.
- Private context identity requires provider-resolvable human plus qualified
  workspace, or an explicit standalone context key. Messaging-disabled workers
  create no team. Do not name a provider privacy guarantee without qualification.
- Zero or one default provider per slot is the v1 simplification; simultaneous
  Jira + GitHub is not yet solved. Unattended approval is not part of v1.
- Recurring schedules must declare capture versus explicit future reprepare policy;
  capture remains proposed. Already queued work never silently advances.

Human authorization closes the old implementation-approval hold only; contract
constraints, parser review and provider qualification remain in force.
