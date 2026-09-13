# Knowledge contracts, integrations, and storage

**Status:** architecture proposal for discussion, 2026-09-13. No implementation
or configuration schema is approved by this document. Accepted direction is
recorded in [external knowledge custody](../../agents/oats-expert/soul/knowledge/decisions/external-knowledge-custody.md)
and [provider-neutral knowledge and harvest](../../agents/oats-expert/soul/knowledge/decisions/provider-neutral-knowledge-and-harvest.md).
This proposal refines the [knowledge and memory direction](2026-09-13-knowledge-and-memory-direction.md).

## 1. Accepted starting points

**Scope:** OATS publishes an opinionated reference knowledge theory; default
OKF follows it, but other knowledge capabilities may choose different models.
The location/harvest design below is for this default-theory workstream and
capabilities that choose to adopt it, not extra kernel requirements.

- All knowledge leaves the soul, including general expertise.
- Working instances read knowledge and capture memory; they do not promote
  into the base. For now this is injection guidance, not an OS sandbox.
- Harvesting is independent of the source instance's execution/work context.
- Git-committed knowledge updates are PRs.
- Access rests on users' existing accounts; for GitHub repositories, their
  GitHub permissions apply. Assume all workspace/team agents can access the
  configured bases. No new public/private classification or per-agent ACLs.
- The first working version must cover Git-backed OKF AND a non-Git knowledge
  store. Non-Git support is not a later optional extension.
- The reference knowledge/memory theory is independent of concrete storage
  tools. An integration using a graph store and its CLI can adopt that theory,
  or choose a different approach; it owns the resulting runtime behavior.
- OATS supplies canonical authoring docs for knowledge injections and skills,
  and a `knowledge-theory-expert` agent to help create knowledge capabilities.
  The expert and full authoring material are planned deliverables, not yet built.
- Every capability provides its own complete runtime instructions, skills,
  memory conventions, harvester and related machinery. The kernel does not
  automatically inject the reference doctrine into every knowledge capability.

The mechanisms below are proposed. In particular, which non-Git implementation
ships first is not yet settled: directory-backed OKF is the simplest candidate;
Omnigraph is a concrete alternative to investigate, not an already verified
integration or an agreed initial dependency.

## 2. Separate the model, the integration, and custody

### OATS reference knowledge/memory model — the recommended approach

- **Instance memory:** task-local state, observations and captured evidence.
- **Durable knowledge:** expertise that survives an instance, with explicit
  ownership, provenance, decisions and supersession.
- **Capture:** preserve observations while doing the work; do not make the
  working instance hold the promotion bar.
- **Harvest:** judge candidates against the common doctrine; promote, merge,
  supersede or drop; preserve exclusions and one authoritative home per claim.
- **Consultation:** discover relevant prior knowledge before re-deriving it,
  using progressive disclosure rather than bulk loading.

These meanings do not require Markdown, YAML frontmatter, `index.md`, local
files, a Git branch, or a particular command. The promotion bar, expertise
rather than code-description doctrine, and capture/judgment separation remain
consistent when an author chooses to implement this theory with another tool.
They are not mandatory policy for a capability that chooses a different model.

### Canonical authoring material and knowledge-theory-expert

OATS maintains the theory in its repository and supplies canonical documentation
for turning it into working-agent injections, skills and harvester instructions.
These references explain the concepts, their rationale, expected behaviors and
examples. An author can point a coding agent at them without needing a special
runtime dependency.

OATS should also provide `knowledge-theory-expert`. Its job is to:

- explain the reference model and the reasons for its distinctions;
- help map it to a chosen tool's actual read/write and storage behavior;
- help author a complete capability, including injections, skills and harvesting;
- identify gaps or deliberate departures and suggest relevant behavioral tests.

It assists authors; it does not run every harvest, police every capability,
serve as a required approval gate, or replace the canonical docs. Its package,
curriculum and instructions are still to design. No agent has been scaffolded
or spawned as part of this scoping discussion.

### Knowledge capability — a complete runtime implementation

Each capability supplies the complete behavior selected by the deployment:
its skills, injections, instance memory and capture protocol, native reader
and writer tools, harvester and judgment instructions where applicable,
lifecycle contributions, validation and delivery. It is not only an adapter
under a mandatory OATS-supplied judge.

For example:

- Default OKF authors use the reference theory and ship concrete OKF injection,
  craft/harvest skills, harvester, hooks and Git/non-Git delivery behavior.
- An Omnigraph capability author may use the same docs/expert to create the
  equivalent package around the native CLI and data model.
- An author choosing a different memory or learning model provides and
  documents that capability's own runtime instructions instead.

Canonical theory stays in one maintained place, but adopting it does not
require a mandatory shared runtime injection or harvester skill. Explicit
resource reuse through supported packaging is fine; mutable documentation is
not fetched into agents as a hidden policy update. Capability releases own
changes to the runtime material they supply.

The kernel keeps generic capability/layer/configuration/lifecycle/operation
and trust contracts. It neither chooses the theory nor implements a universal
harvester. Existing framework/work-mode rules still apply to every capability.

### Custody — how a write becomes accepted knowledge

Format and delivery are separate choices. OKF does not imply Git:

| Implementation | Read path | Write/delivery path |
|---|---|---|
| Git-backed OKF | Accepted revision of an OKF bundle | Independent checkout, validation, PR; accepted after merge |
| Directory-backed OKF | Configured OKF directory | Coordinated, validated update with an observable durable result; no Git or PR |
| CLI-backed graph store | Provider-native discovery/query through its CLI | Provider-native writes and confirmation; no invented Git semantics |

A dedicated knowledge repository can be Git-backed; moving out of the code
repo does not make it non-Git. A non-Git store must work without `.git`, GitHub,
a branch, a remote, or a PR receipt.

## 3. Base, node, binding

Sections 3–7 describe the proposed default location/harvest design and offer a
pattern for authors adopting the reference theory. These nouns and shapes are
not mandatory schema for every knowledge capability.

### Base

A named body of durable knowledge with a canonical provider-resolved location.
It is not intrinsically an OKF bundle or a repository.

An OKF base maps to a bundle root. A different provider can map a base to its
native database/space/collection identifier. Only that provider interprets
its locator, storage structure, validation and consistency behavior.

General expertise, project decisions and team knowledge all live in bases;
none live inside souls. A project or workspace may consult several bases.
The invariant is **one authoritative home per concept**, not one required
physical storage root for everything relevant to a project.

### Node

A logically soul-owned portion of a base, with exactly one owning soul. A soul
can own nodes in several bases. Ownership is responsibility and harvest
routing, not an access-control grant. A provider must make the boundary
addressable; an OKF directory is one representation, not the universal one.

`project/oats-desktop-expert` and `team/oats-desktop-expert` are distinct node
references. Matching leaf names never merge them. Owner identity must also
distinguish same-named souls in different repositories; its exact syntax is open.

### Binding

Workspace/project configuration maps logical references to a selected
integration's concrete locations. A soul declares what it owns and consults,
without embedding knowledge, physical paths, remote URLs or credentials.

Illustrative soul declarations, not an approved schema:

```yaml
# oats-desktop-expert/soul.yaml
knowledge:
  owns: [project/oats-desktop-expert]
  reads: [project/oats-expert]
```

Here `oats-desktop-expert` consults project direction maintained by `oats-expert`
and accumulates its own durable Desktop expertise. Binding `project` to an
embedded OKF bundle, a separate OKF repository, or a non-Git store does not
change the meaning of those declarations.

Aliases are contextual, not global identities. Resolve them before a read or
harvest; persisted jobs retain the resolved destination so later configuration
changes cannot redirect pending work. Changing storage providers is an explicit
migration, not an alias edit that silently converts or copies knowledge.

## 4. Reference-model implementation contract versus concrete location

Do not make a tool pretend to have files or Git metadata. The following is a
checklist for our default implementation and other capabilities adopting this
model. It is not a new universal knowledge-provider API, mandatory theoretical
conformance test, or kernel requirement.

| Concern | Provider-neutral meaning |
|---|---|
| Resolve | Map a logical base/node to an unambiguous provider-owned destination and owner |
| Discover/consult | Give instances a useful entry point and tools to retrieve relevant accepted knowledge |
| Prepare harvest | Preserve bounded source evidence and resolved destinations independently of the source home |
| Apply judgment | Let the harvester maintain knowledge using the provider's native authoring tools |
| Validate | Check the proposed update against the provider's representation and shared semantic requirements |
| Deliver | Report a durable proposal, an applied update, a no-change result, or a failure; distinguish these |
| Refresh/inspect | Explain what readers can see, freshness limitations and pending work without guessing from activity |

The resolved descriptor needs a logical reference, provider identity, opaque
provider locator, node/owner identity, reader/writer instructions or operation
references, delivery semantics, and binding provenance. A version or receipt
is provider-native; a Git commit ID is not a required field for every store.

### OKF location examples

| Placement/custody | Canonical location | Bundle root | Read baseline |
|---|---|---|---|
| Embedded Git | `https://github.com/example/project.git` | `knowledge/` | Configured accepted branch |
| Dedicated Git | `https://github.com/example/project-knowledge.git` | `.` | Configured accepted branch |
| Non-Git directory | Explicit workspace-relative directory, e.g. `./team-knowledge` | That directory | Provider-confirmed current contents |

Git locators include repository, contained root, accepted ref and PR target/head
route. Directory locators include a resolved path and direct-update custody.
A future CLI-backed locator uses the actual identifiers supported by that
provider; do not invent Omnigraph fields or command flags before investigation.

Configuration belongs to the selected knowledge capability's settings and
existing targeting, not a new mandatory kernel registry. Multiple bases do not
require multiple active knowledge layers: `oats.okf` can supply both Git and
directory custody. An Omnigraph integration could replace it in another
deployment. Simultaneous different integrations in one instance are not assumed
here; that would need a separate composition decision.

### Resolution and access rules

1. Bind locations explicitly; do not choose from cwd, source work mode, source
   feature branch or whichever checkout happens to be writable.
2. Relative paths resolve from their declaring scope, with containment checks.
3. Missing required bindings or failed access are visible errors; never create
   an empty substitute or silently choose another base.
4. Reads do not scaffold nodes. Creation and ownership changes are explicit writes.
5. Use the user's existing account/access for the selected system. GitHub governs
   GitHub access; a local directory uses host filesystem access; another tool
   uses its native authentication. No new OATS permission system is implied.
6. All configured workspace/team bases are available to its agents. `reads`
   selects initial context, not an ACL; `owns` selects responsibility/routing.
   Access to other repositories does not auto-bind them.
7. A failed Git delivery cannot fall back to direct writes. Tracked knowledge
   cannot be relabelled local merely to bypass its PR contract.
8. Defer public/private classification and disclosure routing. Keep the existing
   secret/credential and third-party-verbatim promotion exclusions.

## 5. Independent harvest, provider-specific writing

A per-source harvest takes preserved evidence, source/soul identity, bounded
record provenance, claimed note versions, resolved destinations and a stable
input identifier. It does not rely on the source staying alive or keeping the
same worktree/branch. Independent execution does not mean context-free evidence.

The reference-model harvester's reasoning is:

1. Consult existing relevant knowledge through the integration's read tools.
2. Judge the source candidates under the common doctrine.
3. Select each candidate's owned destination; maintain or supersede existing
   knowledge rather than creating duplicate descriptions.
4. Apply changes with the integration's authoring tools, validate, and report
   the actual delivery outcome. Advance source processing state only under the
   agreed durable-result protocol.

Concrete writing differs:

- **Git OKF:** worker-owned destination checkout, starting from the accepted
  branch; knowledge-only PR whether the bundle is embedded or dedicated.
- **Non-Git OKF candidate:** worker-owned execution context, coordinated edits
  to the configured directory, validation and recoverable publication. A plain
  successful edit command alone is not the whole crash/retry contract.
- **Omnigraph scenario:** the harvester uses Omnigraph's native CLI to consult
  and write knowledge; working instances use it to retrieve knowledge. How
  logical nodes, supersession, receipts and consistency map to that CLI must
  be verified. No command surface or transaction guarantee is assumed here.

The integration manages authenticating through the user's available access;
credentials do not travel inside harvest evidence. Source retirement preserves
inputs before removal or reports incomplete retirement. Results are per
explicit destination; cross-store changes are not assumed atomic.

Provider-neutral orchestration does not mean every backend supports identical
transactions or review states. Do not report a proposal as applied, a queued
write as queryable, or a process launch as successful harvesting.

## 6. Visibility, concurrency and validation

For Git OKF, distinguish PR opened, merged, and visible in a refreshed reader.
For non-Git, distinguish proposed/staged changes if supported, durable application,
and reader visibility according to the actual provider. A direct local provider
can have no pending-review phase; it must not fabricate one.

A provider documents its read consistency and available version/freshness
signals. If it cannot offer snapshots, acknowledge that instead of inventing a
Git-like revision. Failed or rejected delivery must remain recoverable after
the source home is gone. Exact watermark and retention mechanics are open.

Concurrency has separate units: source input claims, node updates and storage
publication. Git requires accepted-head validation across PRs; non-Git files
need coordinated/recoverable publication; a service needs its actual concurrency
contract. Test concurrent harvests, retries, and failure after a partial write.

Validate OKF with the OKF validator, including each base's native link namespace.
A graph integration validates its own representation and logical ownership;
it does not run a Markdown validator on a service. Default implementations
must pass behavioral tests for the reference doctrine, provenance, supersession,
exclusions, one canonical home and consultation by a fresh instance. Authors
adopting the theory can reuse these tests; a capability choosing a different
theory is not rejected merely for differing from that model.

## 7. First working version and remaining decisions

There are two related deliverables:

1. **Reference/authoring:** canonical theory and injection/skill guidance plus
   the `knowledge-theory-expert` agent. Useful without a running OKF deployment.
2. **Default implementation:** complete capability-owned runtime behavior,
   applying that theory to working Git and non-Git storage.

**Required:** working Git-backed OKF AND a working non-Git knowledge store.
A Git-only release with a non-Git interface stub does not satisfy this scope.

Recommendation for the smallest initial implementation: `oats.okf` with Git and
plain-directory custody. This exercises both paths without introducing an
unresearched external dependency. The choice is not yet accepted: confirm
whether the first non-Git implementation should instead be Omnigraph itself.
An Omnigraph implementation adopting the reference theory should be possible
without rewriting the theory; this does not oblige every Omnigraph capability
to adopt it.

Acceptance scenarios use `oats-expert` and `oats-desktop-expert`:

1. Git OKF works both inside the code repo and in a dedicated knowledge repo;
   harvest runs independently and opens the appropriate knowledge-only PR.
2. The non-Git implementation persists real harvested knowledge with no Git
   repository or GitHub dependency, and reports a verifiable result.
3. In each implementation, a fresh instance answers from accepted knowledge
   learned by a retired instance, without its home or transcript.
4. Both preserve the same promotion doctrine, provenance and exclusions, and
   handle concurrent updates, failed delivery and safe retirement inputs.
5. A workspace using the OKF integration can consult multiple configured bases
   without ambiguous ownership or destination selection.

Before implementation, settle the authoring-material and expert delivery shape,
non-Git backend, binding/schema and ownership identity, delivery/refresh semantics,
and source input/retention protocol. The kernel stays provider-neutral; each
capability supplies its complete runtime knowledge behavior. No mandatory shared
theory-runtime layer, public/private permission model or multi-provider router
is a prerequisite.
