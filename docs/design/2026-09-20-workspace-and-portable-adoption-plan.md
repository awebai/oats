# OATS adoption plan: workspace first, knowledge and experts second

**Date:** 2026-09-20

**Status:** Phase1 implementation authorised by the human, using the existing developers under lead supervision/review. The workspace home is confirmed as `oats`; `oats-dev` remains development capabilities. This does not claim completed conversion or authorise unspecified new contracts, credential operations or live deployment mutations.

## Goal and order

1. Put OATS development onto the Git-workspace and Portable Souls architecture: a real shared workspace definition, qualified repository exports, by-reference sources and usable local deployments.
2. Centralise the curated knowledge and adopt the five expertise souls on that foundation.
3. Complete Desktop design/feature parity against the resulting supported flows.

A distribution work package (below, D1–D4) accompanies phase1: the kernel's operational skills become the official capabilities `oats.core` and `oats.setup`, every soul declares `oats.core` explicitly by default, onboarding creates an `oats-setup-expert`, and the official marketplace is the reviewed list in this repository.

The second phase does not run as an unrelated bulk migration while the first is still changing underneath it. Necessary generic knowledge/provider boundary fixes belong in phase1; default OKF behavior and the actual corpus/roster cutover belong in phase2.

## Target arrangement

Approved repository responsibilities following the framework-hosted workspace choice. The two-phase order is unchanged:

| Repository | Role in the new setup |
|---|---|
| `oats` | Kernel, adapters, Desktop and portable soul exports through `oats.yaml`; hosts the shared development workspace in `oats-workspace.yaml`; ships the official capabilities `oats.core` and `oats.setup` and the reviewed official package list (`package-catalog.json`) |
| `oats-dev` | Reusable OATS development capabilities, including selected review skills/behavior; no longer responsible for defining the new workspace through a package template |
| `oats-okf` | Reference knowledge capability and its complete reading/capture/judgment/delivery behavior |
| `oats-aweb` | Messaging capability and its provider-owned identity/team/wake behavior |
| `oats-authoring` | Reusable authoring support |
| `oats-jira`, `oats-linear` | Optional task capabilities; workspace membership does not activate them |
| `oats-knowledge` | Curated accepted expertise, not executable soul definitions, working transcripts or a copy of framework documentation |

A workspace is a logical role and does not require a dedicated repository. The human has selected co-hosting in `oats`, preserving `oats-dev`'s capability purpose. Keep the `oats.dev` package where its reusable behavior is useful; separately review compatibility and the legacy template. Preserve published tags/payloads and exact restores. Merely adopting the workspace does not activate every capability.

`oats-workspace.yaml` and `oats.yaml` have separate contracts even when co-located. Admit the framework repository explicitly if it participates as a member, and verify matching reciprocal observations. Importing a public OATS soul or installing the framework must NOT implicitly select or enroll an adopter in the framework's development workspace. A separate workspace repository remains an option if independent permissions or lifecycle become necessary.

The shared workspace is **not a shared live runtime**. Each operator retains local deployment mappings, runtime/authentication, state and explicit approvals. Config and nonsecret lock/template provenance can be Git-shared where supported; credentials and live instance state cannot. Git access, organizational admission, executable approval and messaging enrollment remain distinct.

## Verified starting point

- Kernel/Pi/Desktop0.24.0 and OKF2.1.0 are released. Workspace/source codecs, discovery, retained composition and scoped execution/provider machinery already exist. This is not a kernel rewrite from zero.
- A read-only September20 inventory found no root `oats-workspace.yaml` in either `oats` or `oats-dev` and no root `oats.yaml` in the framework or the six inspected capability/development repositories. The selected knowledge repository is not yet initialized. These observations must be refreshed against exact heads before editing.
- The default development package still supplies a legacy config template and `oats.review`; these are capability/template exports, not a Git workspace definition.
- The checked-in roster remains legacy. A five-role candidate and curated corpus are preserved but not validly published/adopted as the new portable setup.
- Earlier live native/directory-learning evidence is valuable but does not prove our actual Git workspace, two-operator deployment, private messaging or Git-PR learning cutover.
- Current source contains the approved forward correction of the accidentally integrated held record patch. Preserve repaired history and its active-content exclusion; do not reopen that incident or repeat closed test matrices.

# Phase 1 — adopt the workspace and Portable Souls architecture

## P1.1 — freeze the repository, source and runtime map

**Owner:** integration lead, with kernel/provider/deployment owners.

Produce one bounded implementation checklist from the actual current code and chosen package revisions:

- Exact workspace repository and intended member repositories; external consumption is not membership.
- Source/export locations for the necessary transitional roles and the eventual five experts. Recommended reusable soul editions remain in the framework repository, separate from live legacy `agents/` sources.
- Compatible package/source revisions, required capabilities and operator-selectable bindings.
- Actual runtime/backend and messaging-delivery profiles to support, including intentional local differences. Do not replace native credentials/profiles or copy one operator's raw configuration to another.
- Existing support versus declaration/resource drift versus provider work versus genuinely missing kernel/CLI seams. Every missing generic field or authority change gets a concrete proposal; reuse the current parser/resolver/invocation engine.

**Deliverable:** an exact repository/change/owner matrix and a small gap list, not another open-ended architecture investigation.

## P1.2 — author the real workspace

**Owner:** workspace/deployment owner, reviewed by the integration lead.

Add `oats-workspace.yaml` to the confirmed workspace home `oats` using the shipped schema, alongside that repository's separate `oats.yaml` export index:

- Intended members, selected source imports with real reviewed revisions and aliases.
- Shared defaults bounded by soul requirements, not a new repository-level policy hierarchy.
- Provider-owned knowledge declarations and team aliases only where meaningful and safe to publish.
- Explicit discovery/catalog references if needed, not an OATS-hosted registry.

Do not advertise a planned source export or uninitialized knowledge base as usable. Do not commit secrets, private runtime state or machine-specific execution paths into the public workspace. The phase2 knowledge destination can remain deliberately unresolved until it is initialized and approved.

**Deliverable:** validated, reviewable workspace definition and a short explanation of shared versus operator-local choices.

## P1.3 — publish repository indexes and reciprocal admission

**Owner:** each repository/package owner, coordinated by the integration lead.

For every intended member:

- Add `oats.yaml` with the correct workspace backlink and actual exports.
- Advertise package roots containing real `oats-package.json` files, not arbitrary npm roots.
- Advertise only source-complete souls with explicit definition paths; imported souls remain references, not adopter-owned copies.
- Add knowledge exports only when the provider declaration/base actually exists. A metadata-only bootstrap of the knowledge repository must not masquerade as corpus migration or a ready store.
- Preserve package identities, compatible version floors, immutable releases and old locked revisions.

Coordinate publication of backlinks and workspace admission. One side alone is not membership. Resolve the existing contract's default-branch observations and explicit revisions honestly; do not invent mutually dependent future commit pins or guess `main` when the host's default branch is required.

**Deliverable:** discovery can qualify intended membership and enumerate real exports across repositories without requiring every source checkout to be present locally.

## P1.4 — make the declared setup operational

**Owner:** kernel/lifecycle owner and the owners of the selected capabilities.

This is **adoption and validation first**, not a mandate to write new runtime code. Exercise the already shipped paths with correct declarations and inputs before changing them. A new inspection convenience is not automatically an adoption blocker; preserve it as a separate proposal unless necessity is demonstrated. Provider adaptation must identify the minimum usable completion path, not merely replace one refusal with a later refusal.

Close only demonstrated gaps needed by the chosen workspace/profile:

- Public inspection/preparation, explicit artifact approval, retained resolution, scaffold and native start through supported CLI/API paths.
- Complete source/skill/capability closure; independent source, deployment and work-target identities.
- Actual provider bindings, required hooks and their truthful readiness. A parsed team/store declaration is not enrollment or a working provider.
- Required continuation, capture and applicable wake/retire/recovery behavior for the selected profile. A path that is still unsupported must be named and resolved, not hidden behind successful start-only evidence.
- Version-correct operational skills and guidance, including known stale claims that public request/context/launch inputs are unavailable.
- Any minimal Desktop compatibility needed to observe/refuse operations truthfully; full redesign parity is later.

Use an explicitly agreed transitional edition of an existing role for the pilot, not a new fictitious owner or bootstrap host. Retain its actual requirements. Any temporary acceptance store/profile must be explicitly scoped and must not be counted as production knowledge adoption. Do not silently remove messaging, knowledge, plugins or other requirements to make it launch.

New package defaults or executable changes require appropriate release/pinning/approval. Adding metadata does not itself require replacing stable runtime components, but a real runtime change is not deployed merely because it reached main.

**Deliverable:** one reproducible operator path from the shared Git definition to a genuinely usable, retained portable instance under the chosen profile.

## P1.5 — adopt fresh local deployments without disturbing existing work

**Owner:** each local operator; coordinated readiness/evidence review by the integration lead.

- Use a fresh explicit deployment location where existing managed state conflicts. Preserve old configs, locks, knowledge, identities, sessions, worktrees and pending jobs.
- Map local repositories/work targets deliberately; operators need not have identical directory layouts.
- Review exact software and restore/acquire through supported tooling. Keep native auth and deliberately chosen model/delivery behavior local.
- Verify source discovery, reciprocal admission, imported identity, retained composition and actual start/continuation on the approved test host.
- Check the second operator's declarations/readiness and an actual message/reply through its own identity without requesting model or GUI tests on that machine. Existing legacy connectivity is not automatically new-profile qualification.
- Exercise relevant source-unavailability/update safeguards using owned test fixtures, never by deleting working source repositories or modifying retained artifacts.

### Phase1 exit gate

The shared workspace and repository declarations are published and discoverable; a fresh deployment can select a real portable source and complete the supported prepare/approve/scaffold/start path with its declared requirements. Required lifecycle/provider limitations are resolved or explicitly constrain the qualified profile. Both operators understand the same shared definition and their own local differences. Old live deployments remain preserved.

**Seven YAML files alone do not satisfy this gate.** Nor does an isolated fixture establish production provider readiness. No claim that the five new knowledge-backed experts are adopted is made yet.

# Distribution — official capabilities and the official marketplace

**Status:** direction accepted by the human on 2026-09-20 (decision `agents/oats-expert/soul/knowledge/decisions/official-capabilities-oats-core-setup-and-marketplace.md`). Runs alongside phase1 once the current lanes' PRs are integrated; it changes how OATS itself is distributed and must be in place before phase2 souls are published, since those souls declare their capabilities explicitly.

Today the skills that teach an agent to operate OATS (`oats`, `oats-config`, `oats-packages`) and the "you run on OATS" injection are ambient kernel content. Under Portable Souls a soul declares its capabilities and their sources, so this knowledge must be packaged as capabilities a soul can declare, remove or replace.

## D1 — package `oats.core` and `oats.setup` from the oats repository

**Owner:** capability/provider owner (packaging), reviewed by the integration lead.

- `oats.core` — day-to-day operation, present on every soul by default: skill `oats-operate` (status, spawn, retire, doctor, lifecycle, instance layout) and skill `oats-souls` (soul discovery, spawn relations/linkage, roster, workspace-member souls), plus the former `injects/oats.md` injection.
- `oats.setup` — deployment and workspace configuration ("OATS Soul Setup"): the former `oats-config` and `oats-packages` skills, workspace adoption guidance and package acquisition/trust/lock knowledge.
- Both live under the framework's `oats-package/capabilities/` beside `oats-knowledge-theory`, are exported through the repository package manifest and `oats.yaml`, and are versioned/locked like any package. Content is moved from the existing skills, not re-authored; stale claims are corrected in the move.
- The `instance-boundary` injection, work-mode briefings and config-declared injections **stay kernel-owned** — they describe the layout the kernel itself creates.

**Deliverable:** two installable capabilities with manifests and focused inventory tests; the kernel unchanged except for registering nothing new.

## D2 — explicit default `oats.core` on every soul; kernel skills de-ambiented

**Owner:** kernel/lifecycle owner.

- Every soul-creation path (CLI, Desktop, setup guidance) writes `requires.capabilities.oats.core` with its source into the soul definition. It is visible in the file and the user can remove it.
- The kernel does **not** inject `oats.core` when absent; `oats doctor` reports a soul that has neither `oats.core` nor a deliberate opt-out note, as information, not an error.
- The hard-coded kernel skill list and the `kernel:oats` injection are retired once souls carry `oats.core`. Transition: both coexist for one release, with existing kernel-listed skills marked deprecated in favor of the capability.
- Existing checked-in souls in this repository are updated to declare `oats.core` explicitly as part of the same change.

**Deliverable:** soul definitions are honest about OATS operational knowledge; no hidden kernel dependency.

## D3 — onboarding creates and instantiates `oats-setup-expert`

**Owner:** kernel/lifecycle owner, with the workspace/source owner for the soul edition.

- Onboarding a new workspace (or a fresh deployment of one) produces a soul `oats-setup-expert` whose definition declares **both** `oats.core` and `oats.setup`, prepares/approves its artifacts under the normal approval bar, and instantiates it.
- The setup expert then drives adoption: declaring/adopting member repositories, selecting fundamental-layer capabilities, creating further souls (each with explicit `oats.core`), and walking the operator through trust/approval steps. Setup becomes a conversation with a competent soul, not a wall of flags.
- No new bootstrap authority: prepare/approve/scaffold/start remain the shipped path; onboarding only chooses the first soul and its capabilities. The entry point (CLI verb, Desktop flow, or both) and its relation to the version-scoped `oats init`/`oats use` compatibility path is proposed and reviewed separately; do not document a command before it exists.
- The soul edition itself is source-complete and exported from the oats repository like the other framework souls.

**Deliverable:** one reproducible path from "empty workspace" to a running `oats-setup-expert` that can configure the rest.

## D4 — the official marketplace is the reviewed list in the oats repository

**Owner:** workspace/source owner (list and docs); Desktop owner for the view in the parity phase.

- `package-catalog.json` in `awebai/oats` (read today by `officialPackageCatalog()`) **is** the official marketplace. Listing = official. Do not build a second registry.
- Officialness is granted by a reviewed PR to that file — for external packages too. That review is the safety gate: we control what is called official even when we do not host the code. Document the acceptance criteria (source-complete package, pinned immutable ref, payload root, trust posture, maintainer contact).
- First entries: `oats.core`, `oats.setup`, `oats.okf`, `oats.aweb`, `oats.authoring`, `oats.jira`, `oats.linear`, `oats.dev`, `oats.knowledge-theory` (the fundamentals are already listed; add the two new ones once released).
- Discovery is universal (CLI and Desktop marketplace view/search present official packages as assignable to a soul); installation still goes through acquisition, lock and per-capability executable trust. Discoverable is not installed; installed is not approved.

**Deliverable:** documented official-list policy and seeded list; Desktop view tracked under phase3 parity.

### Distribution exit gate

A fresh workspace onboarding yields an `oats-setup-expert` whose definition shows `oats.core` and `oats.setup` resolved from the official list; a soul created by that expert shows `oats.core` explicitly and still runs after the user removes it; the kernel ships no ambient operational skill. Framework souls in this repository declare `oats.core`.

# Phase 2 — centralise knowledge and adopt the five expert souls

## P2.1 — align the reference knowledge profile

**Owner:** OKF owner, with kernel review only for demonstrated generic-boundary gaps.

Apply the accepted knowledge model to actual runtime instructions, skills, bindings and behavior:

- Centralised per-soul homes with stable identity and explicit cross-reads.
- Capability-owned organisation, placement, reading, capture, judgment and delivery—not a kernel-owned mandatory knowledge pipeline.
- Distinct accepted knowledge, local evidence/working state and immutable execution artifacts.
- Supported reading/refresh/capture for both short- and long-running instances; no automatic active-context synchronisation or silent curriculum replacement.
- Independent promotion, reference doctrine and PR-only Git delivery, distinguishing proposal, accepted merge and reader visibility.

Do not implement automatic speciation, redirects, whole-session cloning, a permanent maintenance agent or every alternative provider as prerequisites. Preserve their architectural possibility without claiming them shipped.

## P2.2 — curate and publish the shared knowledge base

**Owner:** knowledge steward, with human publication/visibility decision.

- Confirm public/private visibility and access before publishing corpus or exposing private locators in the workspace.
- Reuse the existing curation and disposition records. Add a focused freshness pass for subsequent accepted decisions and discoveries; do not redo the entire audit or bulk-copy legacy folders.
- Preserve useful expertise, rationale, limitations and maintained slow state. Keep formal contracts/code navigation in docs, repeatable procedures in skills, and task residue/transcripts in local evidence.
- Give each accepted concept one canonical home, valid cross-links and appropriate provenance/freshness.
- Separate administrative repository/bootstrap scaffolding from corpus acceptance. Deliver the corpus through reviewed changes; ongoing runtime Git learning remains PR-only.

**Deliverable:** a small, current, reviewed knowledge base with an explicit owner/read mapping, not merely a passing validator over relocated text.

## P2.3 — publish and adopt the five expertise souls

**Owner:** soul/source maintainer, reviewed by the integration lead and knowledge steward.

The five permanent expertise roles are:

1. `oats-expert` — overall direction and cross-cutting architectural judgment.
2. `oats-kernel-expert` — kernel/capability contract rationale and technical expertise.
3. `oats-desktop-expert` — Desktop/product/interaction expertise.
4. `market-research-expert` — sourced research and positioning evidence.
5. `oats-assistant` — user-facing adoption and onboarding help.

Use source-complete portable declarations, canonical `AGENTS.md` and the `CLAUDE.md` alias, reviewed procedures, explicit capability requirements and stable knowledge bindings. Final export paths must be deliberately chosen before pinning imports. New adopters' learning must not silently default to the source publisher's writer.

The optional knowledge-theory authoring expert is not a sixth mandatory runtime role. The public assistant must work through a real supported adoption path, not only as a maintainer-local role. A distinct cold-bootstrap helper protocol, if needed, requires its own scoped decision; do not invent a persistent owner to bypass helper authority.

**Deliverable:** five indexed reusable sources, imported by the workspace at real compatible revisions, with the intended expertise/reading boundaries—not renamed engineer charters.

## P2.4 — demonstrate learning, then switch writers/readers

**Owner:** integration lead and OKF owner, with local operators.

Use a small real end-to-end path:

1. An expert obtains its accepted foundation and relevant cross-role context.
2. A working instance captures a useful new finding.
3. An independent worker judges it and delivers a Git PR.
4. Authorised review/merge accepts it.
5. A different/fresh instance obtains that accepted learning through the supported reader/refresh path.

Do not seed the conclusion and call that learning. Check representative questions and source/binding correctness for all five roles without running five redundant full matrices.

Then cut over the workspace imports/bindings deliberately. Reconcile or hold outstanding old harvests rather than retarget their frozen destinations; avoid duplicate old/new writers. Do not rename live homes or borrow identities. Keep original knowledge and work recoverable. Retirement/removal of superseded sources is a separately verified cleanup after unfinished work is safe.

### Phase2 exit gate

The five experts run from portable sources in the shared workspace, consult the curated common knowledge, and demonstrate actual reviewed Git learning visible to a subsequent reader. Publication, access, writer ownership and local runtime configuration are known. The old setup is preserved until this is true.

# Execution and review discipline

The initial implementation lanes are deliberately disjoint:

| Lane | Owns | Does not own |
|---|---|---|
| Workspace/source declarations | Framework workspace/member indexes, transitional `souls/oats-expert/` edition preserving its existing logical owner, setup guide and metadata tests; other capability repositories' root `oats.yaml` only | Kernel or provider runtime, provider README/tests, framework mirrors, corpus migration |
| Kernel/onboarding | Public preparation/lifecycle glue, same-repository workspace regression coverage and portable-setup skill | Root workspace/member indexes, soul editions, provider payloads, record optimisation |
| Capability/provider readiness | Canonical OKF/aweb payloads, manifests, skills/docs/tests and actual profile-readiness facts | Kernel/record, root member indexes, soul editions, framework mirrors/catalog |
| Integration lead | Scope/interface arbitration, exact review/integration, shared stewardship, release coordination and combined deployment acceptance | Unilateral changes to another operator's credentials, identity or local deployment |

Distribution lanes (D1–D4) map onto the same owners: capability/provider readiness packages the two capabilities (D1); kernel/onboarding owns the explicit default, kernel de-ambienting and the setup-expert onboarding (D2, D3); workspace/source declarations own the official list and its policy docs (D4). They are assigned only after the current phase1 PRs are integrated, to avoid overlapping edits in `lib/core.mjs` and the skills tree.

The phase1 transitional source is an edition of the existing overall expert, not the full five-role rebuild or an invented bootstrap owner. Source publication precedes workspace import pinning to its actual approved revision. An owner reports a precise cross-lane seam rather than patching another lane's files. No new review agents or per-edit permission loops are required for agreed work.

- One redesign lead owns the cross-repository plan, dependency order, scope questions and integration picture. Contributors deliver bounded agreed work and exact diffs/PRs; no wholesale branch merges that import unrelated or held work.
- Workspace/source metadata and compatibility work can proceed in parallel once their shared identities/contracts are agreed. Provider changes are reviewed against concrete missing seams, not speculative replacement architectures.
- Local operator approval remains necessary for installation, executable trust, identity/team changes, deployment cutover and disclosure. Lead coordination is not authority over unrelated deployments.
- Use focused changed-path checks while developing, then one coherent acceptance gate per usable increment. Keep original failed evidence and distinguish author reports, independent checks, installed bytes and real execution.
- Preserve normal native harness auth and explicit permissions. No implicit credential handling, safety bypasses, source/identity borrowing or model/GUI testing on another operator's machine.
- Publish updated versions only where code/payload changes require them; never move existing tags. Record delivery and actual adoption separately.

# Decisions to settle at the appropriate boundary

- Workspace home is settled: `oats` hosts it and `oats-dev` remains development capabilities. Phase1 authorises the parallel existing-role edition at `souls/oats-expert/`; preserve its logical owner and settle any remaining source-policy details before publishing. Final five-role publication/cutover remains phase2, not permission to replace the live roster now.
- Confirm knowledge visibility and public-safe content before phase2 publication; this need not block the phase1 contract inventory.
- Agree the exact pilot/provider/runtime profile and its supported lifecycle. No hidden fallback to an easier profile.
- Review any newly identified generic contract or bootstrap authority change explicitly. Existing accepted constraints do not need repeated approval.

# References

- [Portable source/workspace declarations](2026-09-15-portable-declarations.md)
- [Workspace schema](../oats-workspace.schema.json) and [repository index schema](../oats-member.schema.json)
- [Fresh onboarding boundary](2026-09-16-portable-onboarding.md) — read historical pending statements with the actual current public routes and release scope
- [Released0.24 scope](../release-notes/v0.24.0.md)
- [Canonical knowledge theory](../knowledge-theory.md)
- [Generic knowledge/capability boundary](2026-09-16-knowledge-capability-contract.md)
