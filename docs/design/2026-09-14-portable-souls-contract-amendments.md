# Portable Souls — substantive contract amendment (14 September 2026)

**Public universal design appendix.** The complete substantive amendment below
is preserved verbatim, from “Section 3” through the final drafting instruction.
Only its transmission preamble (message addresses/IDs and relay conversation) is
omitted; no technical clause is omitted. This is design text, not a transcript.
The [reconciled proposal](2026-09-14-portable-souls-and-git-workspaces.md) integrates
these clauses as one coherent update; the [implementation ledger](2026-09-15-portable-souls-implementation.md)
maps them to the binding handoff decisions and acceptance gates.

**Status reconciliation, 15 September 2026:** the amendment's historical “not
implementation authorization” wording distinguished review from human approval.
Direct human authorization now permits infrastructure implementation/deployment
under the [handoff](2026-09-15-portable-souls-handoff.md) and
[landed retention contract](2026-09-14-artifact-retention-contract.md); it does not
waive constraints, finalize parser syntax, qualify provider privacy or advance
Desktop feature work. No operational change is performed by this documentation
pass. The held capture patch remains excluded. Personal references in the preserved
text identify design participants, not adopter configuration or deployment facts.

---

## Section 3: responsibilities and knowledge

A soul records portable capability requirements and knowledge declarations. Its durable knowledge remains outside the soul. A knowledge declaration identifies nodes and either a source-complete store locator or an explicitly inherited binding. The workspace advertises stores and supplies defaults; the deployment resolves bindings and credentials. The resolved instance can access its knowledge without fetching the workspace definition again.

Keep the kernel's knowledge contract provider-neutral. The owns/reads node model and harvester promotion rules below describe the default knowledge implementation; a replacement provider must expose its required configuration and readiness through the capability contract without being forced to adopt OKF's storage or internal authoring model.

For that default implementation, accept `reads` entries with store and node, and `owns` entries with node and an optional destination. A missing destination inherits an explicitly selected write binding; absent configuration is reported. These are conceptual fields, not a final schema. Resolved node addresses include their store: a short node name alone is not globally unique. Explicit fixed sources and rebindable defaults must be distinguishable.

There is no architectural invariant restricting owned nodes to one store. Each resolved node has one declared steward; a promoting worker has an explicit destination; an accepting maintainer decides whether a public contribution lands. Multiple instances or deployments may propose contributions without acquiring conflicting ownership. Reading a public store does not authorize publishing private captures or notes to it.

## New section after section 4: importing an external soul

An import references a canonical source repository, an exported soul path, a revision selector and an adopter-local alias. Preparation retains the exact resolved source revision and the source files needed by the soul. Upstream soul identity, source revision and local alias are distinct fields. Changing an alias does not create a new upstream soul; selecting a newer revision does not create a new running instance identity by itself. Source moves require explicit provenance handling, not filename matching.

The workspace may advertise an external import without admitting its source repository. A standalone prepare accepts the same reference. Acquiring it neither copies it into an adopter-maintained soul definition nor requires a backlink from the publisher. Existing Git access remains necessary for private sources.

Accept adoption defaults on the import entry: team-alias mappings, default knowledge destinations and provider bindings. This is workspace-side configuration for that imported soul, not another precedence tier. It may bind declared extension points and override rebindable defaults; it cannot replace hard requirements. A team-alias mapping advertises a destination and does not enroll the instance. An explicit spawn choice may override adoption defaults within the same bounds.

## Section 4: source bases and requirement strength

Accept `repo:packages/self-serve-dev` as the proposed spelling for a path from the root of the soul's source repository at its retained snapshot. Nested soul directories, installation paths and work targets never affect this base. Paths remain contained in that snapshot. Reserve explicit local-path references for honestly nonportable development inputs. Final parser/schema syntax still needs review.

Accept the distinction `requires` versus `defaults`. Requirements are constraints that every successful composition satisfies; defaults select among the choices those constraints permit. An abstract messaging requirement can therefore be satisfied by an adopter's provider default, while an intrinsic implementation requirement cannot be erased by an override. Explain this as constraints plus fallback values, not three competing configuration hierarchies. Conflicting source requirements fail with both origins reported.

## Sections 5 and 12: context and precedence

Policy has workspace defaults and soul declarations, with explicit operator choices constrained by the requirements. Import-entry defaults belong to the workspace side. They are keyed to the qualified imported soul identity/reference, not an ambiguous short name. No repository capability-default tier and no separate agent-family entity are needed.

Repository briefing and setup remain work-target behavior. They are selected from the repository actually being worked on, not accidentally from the imported soul's source repository. Applicable executable trust remains required. A directory work target remains valid without inventing a Git repository or an organizational membership.

An instance selects one workspace context explicitly. An imported soul's original organization does not become a second source of policy. When there is no workspace, preparation uses explicit standalone bindings for unresolved requirements. In particular, `messaging: any` does not supply messaging software, credentials or a private team by itself. The solo walkthrough must report missing bindings, or name the product default it relies on.

## Section 12: private membership and identity

For messaging-enabled instances, the private team is keyed by a provider-resolvable human identity and a qualified workspace identity. It is reused across that person's machines; an operating-system username, checkout path or agent alias is insufficient. Child and scheduled instances inherit their responsible human. A messaging-disabled worker need not create any team. Standalone deployments need an explicit context key; do not pretend a nonexistent workspace provides one.

Wider memberships are opt-in per instance. An explicit wider set replaces wider defaults while retaining the private team. The same global instance identity holds multiple provider membership credentials and survives joining or leaving teams. Local process, session and deployment-record identifiers are not global instance identities. Team-qualified aliases are addresses, not replacement identity keys.

Distinguish catalog visibility, live-instance visibility, contact permission and conversation-history access. Joining a wider team must not grant access to earlier private conversations or other agents in the human's private team. Actual provider behavior must be qualified before these are product guarantees. Ordinary team members and administrators with control of the host or service are different access contexts; describe the intended boundary accurately.

Zero or one default provider per fundamental role is a v1 product simplification, not a universal limitation on capabilities. Juan's simultaneous Jira/GitHub case remains an explicit design test: can one default task interface coexist with another service integration, or does the task contract require named bindings? Do not claim that use case solved or build a generalized multi-provider solver before examining it.

## Sections 10 and 11: resolution and updates

A captured composition includes the soul snapshot, selected capability closure, helper definitions, commands/hooks and other managed resources, plus effective non-secret configuration and binding provenance. Lifecycle dispatch, retirement, recovery and independent queued work use that captured resolution rather than a newly read ambient config. Installation supports distinct immutable artifacts side by side; an instance selects one artifact per capability ID.

Immutability applies to OATS-managed software composition. It does not freeze knowledge contents, credentials, live team memberships, the work repository, external services or host tools. Authorized membership changes and credential rotation remain possible without silently upgrading software. External state compatibility is a provider responsibility, and software rollback does not undo external writes.

Refresh selected channels during explicit prepare or update, once per transaction. Show an available unapproved revision alongside the last approved usable revision; do not describe the latter as latest. Accept visible declarative skill changes without adding an execution-approval gate for them. A bounded change notice is sufficient; no new review framework or unattended trust service is required.

Retain everything referenced by instances, pending jobs and supported recovery paths, including workers whose original source has been deleted. Initially retain conservatively rather than implementing elaborate garbage collection. One explicit migration preserves verified existing artifacts and reports unrecoverable overwritten revisions honestly; no permanent parallel resolver/store model is required.

## Section 14: concrete acceptance additions

1. Import the same public soul unchanged into an organization and into a standalone deployment with no Git work target. Read its public knowledge, bind an explicit adopter write destination, and prepare without consulting its publisher's workspace configuration. Verify source identity and exact retained revision.
2. Use two humans on two hosts in one workspace. Reuse each person's private team, include a spawned child or scheduled instance, widen and narrow one representative's memberships without changing its global identity, and verify discovery, inbound contact and historical conversation access separately.
3. Keep an existing instance and independent queued job on revision A, prepare a new instance on approved revision B, remove the original source, and prove A still executes the relevant managed lifecycle/recovery resources. No ambient shared latest lookup may substitute B.

## Explainer corrections

Remove stale statements that lead review is pending, external import is deferred, ownership implies one store, or contact includes history access. Distinguish accepted design directions from the remaining schema and provider qualifications. Correct the relative-source example. Describe one default task provider as provisional. Bound the claim that a committed soul is complete: its software sources are complete; deployment inputs can still be missing. The general OATS architecture must not make OKF's node/harvester model mandatory for replacement knowledge systems.

Please have the maintainer apply these as one coherent document update, and have the expert review that exact text. None of this starts implementation.
