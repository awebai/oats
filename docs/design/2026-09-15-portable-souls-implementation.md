---
type: Playbook
status: accepted-for-implementation
title: Portable Souls infrastructure delivery and acceptance ledger
description: Fifteen binding decisions mapped clause by clause to dependency-ordered delivery and evidence gates; baseline retention is storage-only.
timestamp: 2026-09-15
---

# Portable Souls infrastructure implementation

## Authority, scope and evidence rules

Direct human authorization on 2026-09-15 permits infrastructure implementation
and eventual deployment under the accepted constraints. It supersedes historical
“not implementation authorized” language, not design boundaries. **Desktop feature
work is later.** This documentation lane owns only `docs/design/`; it performs no
commits/pushes, branch switches, live installation/activation, credential operations,
schedulers, model/GUI launches or session control. Never integrate held capture
patch `54b07ee`. Primary checkout, earlier roster/KB drafts and `soul/knowledge/`
are not edit surfaces for this delivery.

Binding inputs, all portable repository paths:

- [Handoff: 15 decisions](2026-09-15-portable-souls-handoff.md#2-the-decisions-binding).
- [Reconciled proposal](2026-09-14-portable-souls-and-git-workspaces.md), incorporating
  the [complete substantive amendment](2026-09-14-portable-souls-contract-amendments.md).
- [Landed retention contract](2026-09-14-artifact-retention-contract.md), especially
  “Resolution and lock integration proposed next” and “Consumer migration”. Its
  integration requirements are binding despite the historical heading.
- [Reconciled explainer](2026-09-14-portable-souls-explainer.md); LFX examples are
  hypothetical illustrations, not actual repositories, team setups or credentials.
- [Package engine](package-engine-contract.md), [runtime API](package-runtime-api.md)
  and [current knowledge runtime](../knowledge.md) for preserved contracts.
  The [older knowledge brief](2026-09-13-knowledge-and-memory-direction.md) provides
  doctrine, not a competing source/default schema or permission to auto-edit skills.

**Baseline:** `428cd9af615652c4a93d754c1106674abd18545b`, branch
`feat/portable-souls-infrastructure`. Retention source and storage tests are landed.
Installer, lock, runtime and queued-work consumers are not migrated by that patch.
Concurrent uncommitted foundation work is not counted here as landed or qualified.

**Ledger discipline:** “documented” means the accepted clause is reconciled, not
implemented or tested. Every unchecked box below is an acceptance obligation; none
is checked merely because this document exists. Add exact commands, revision/tree
identity, pass/fail/skip counts and evidence paths when a gate actually runs. A
fixture proves only what it executes. Scaffolds are not model learning, storage
A/B execution is not lifecycle A/B dispatch, a PR is not accepted knowledge, and
recording team choices is not enrollment or privacy qualification.

## Fifteen-decision checklist

### D01 — Three responsibilities

Contract: handoff decision 1; proposal §3, §10. Documentation reconciled.

- [ ] Soul declares needs and sources; workspace declares admission/defaults,
  knowledge stores, team references and catalogs; deployment resolves, installs,
  binds credentials and keeps state. Verify each field has the right owner.
- [ ] Source, install location, work target and team membership remain independent;
  changing each cannot silently infer or change another.

### D02 — Source-complete soul declarations

Contract: decision 2; proposal §4. Documentation reconciled; nesting needs parser review.

- [ ] Every intrinsic capability resolves from `git:<repo>@<selector>#<package-path>`
  or a contained `repo:` source; selected package really exports the capability ID.
- [ ] `repo:packages/self-serve-dev` uses the retained source **repository root**;
  nested soul directories, cwd, installation root and work target cannot change it.
- [ ] Reject snapshot escape and broken/escaping symlinks; retain the required
  snapshot resources after the original source disappears.
- [ ] `path:` is explicitly nonportable; no ambiguous `./` source spelling in
  portable declarations or hidden upstream catalog-nickname dependency.

### D03 — Requirements versus defaults

Contract: decision 3; proposal §4, §12. Documentation reconciled.

- [ ] `requires` constrains every successful composition; `defaults` selects fallback
  values within those constraints, not another configuration hierarchy.
- [ ] Abstract requirements can use adopter providers; intrinsic implementation
  requirements cannot be erased by operator/import/workspace defaults.
- [ ] Conflicting sources/requirements fail with **both origins/paths** reported.
  `messaging: any` alone supplies no software, credentials or private team.

### D04 — Two authorities, no repository tier or agent-types

Contract: decision 4; proposal §12. Documentation reconciled.

- [ ] Resolve workspace defaults and soul declarations through **one resolver**;
  no repository capability-default tier and no agent-types/family entity.
- [ ] Import adoption is workspace-side, keyed by qualified source identity, not
  short alias; spawn choice can override it only within hard constraints.
- [ ] Exactly one workspace context is selected; publisher workspace policy cannot
  leak into imported composition. Standalone unresolved bindings report missing.
- [ ] Repository briefing (`agents-md-injection`) and worktree setup follow the
  repository actually worked on, not the soul source; executable trust still applies.
  A no-Git directory target remains valid without invented membership.

### D05 — Reciprocal membership for every member kind

Contract: decision 5; proposal §5–§7. Documentation reconciled.

- [ ] At recorded revisions and qualified identities, operator can read workspace
  and member, workspace admits member, and member names workspace.
- [ ] Apply the same rule to project, experts, capabilities and knowledge repositories.
  A fork with a copied backlink or an adjacent folder is not admitted.
- [ ] Consuming a package, public soul or public knowledge store never implies
  membership or needs a publisher backlink.
- [ ] Index discovery is bounded and data-only, respects authorization context and
  reports stale/unavailable honestly; it executes no repository script and does
  not expose protected descriptions via broad caches/aggregate indexes.
- [ ] Equivalent remotes can be qualified; rename/transfer/source-move cases require
  explicit provenance, not same-filename identity substitution. Exact syntax reviewed.

### D06 — External-soul import by reference

Contract: decision 6; proposal §4 import section and §10. Documentation reconciled.

- [ ] Accept canonical source repository, exported soul path, revision selector and
  adopter-local alias; never copy into an adopter-maintained soul definition.
- [ ] Retain exact source revision and full required source resources. Upstream
  identity, exact revision and local alias are distinct; alias changes do not create
  souls, selector changes do not themselves create new global running identities.
- [ ] Workspace advertisement does not admit publisher; standalone prepare accepts
  the same reference. Private sources still use existing Git access.
- [ ] Adoption defaults map team aliases, default knowledge destinations and providers
  within requirements. Mapping advertises, never enrolls; explicit spawn choices
  have the same bounds. No fork/config-copy workaround is needed.
- [ ] Persistent imported/member souls produce the same resolution shape; retain
  their sources separately, never disguise them as ephemeral capability helpers.

### D07 — Project-first expertise

Contract: decision 7; proposal §9. Documentation reconciled.

- [ ] Project souls live conventionally at `agents/<name>/`, several per repository
  as needed; experts repositories serve cross-repository subjects, not compulsory
  centralization. Role examples are named for expertise, not job assignments.
- [ ] Canonical AGENTS.md and CLAUDE.md alias plus complete curriculum/reference
  closure survive retention; no silent conversion to an ephemeral helper.

### D08 — Knowledge at both levels, provider-neutral kernel

Contract: decision 8; proposal §3 and §10. Documentation reconciled.

- [ ] Workspace advertises stores/default provider; soul carries source-complete
  locators or **explicitly inherited** bindings. Later reads/harvests need no
  workspace fetch. Fixed sources and rebindable defaults are distinguishable.
- [ ] Default OKF `reads` includes store+node; `owns` includes node+optional
  destination. Absent destination inherits an explicitly selected write binding
  or reports `needs configuration`, never silently creates a substitute.
- [ ] Resolved addresses are store-qualified; equal leaf names in different stores
  do not collide. Multiple owned stores work: no one-store-per-soul invariant or
  unapproved single-write-store product limit.
- [ ] Each node has one explicit steward and each promoted concept an explicit
  destination. Steward, proposing harvester and accepting maintainer remain distinct;
  multiple proposers are not conflicting ownership. Git delivery is PR-only,
  public or private, and acceptance requires merge-visible evidence.
- [ ] A public read never publishes adopter notes/captures. Write destination and
  publication intent are explicit; do not invent a disclosure/ACL engine here.
- [ ] Kernel envelope retains effective **non-secret**, provider-owned configuration
  and binding provenance with separate credential references. An alternate provider
  reports its own configuration/readiness without implementing OKF nodes or harvest.

### D09 — Private-first choices, provider qualification required

Contract: decision 9; proposal §12. Documentation reconciled; provider gate unqualified.

- [ ] Messaging-enabled private key uses provider-resolvable **human identity plus
  qualified workspace identity**, reused across the human's machines. OS username,
  checkout path or agent alias is insufficient. Standalone has an explicit context key.
- [ ] Child and scheduled instances inherit responsible human; messaging-disabled
  workers create no team. Required missing provider/bindings block readiness.
- [ ] Wider memberships are opt-in per instance; an explicit wider set replaces
  wider defaults and preserves private floor. Alias map alone never enrolls.
- [ ] One global instance identity supports multiple membership credentials and
  survives widening/narrowing; local process/session/deployment-record IDs and
  team-qualified addresses are not replacement global identity keys.
- [ ] A **named messaging owner** qualifies catalog visibility, live-instance
  visibility, inbound contact and conversation-history access **separately**.
  Wider membership exposes neither earlier private history nor other private
  instances; ordinary members versus host/service administrators are distinguished.
- [ ] Before that qualification, record choices only and explicitly claim **no
  provider privacy guarantee**. No blanket readiness based on fields being present.

### D10 — One default provider per slot, v1 simplification

Contract: decision 10; proposal §12. Documentation reconciled; simultaneous test open.

- [ ] Knowledge/messaging/tasks have zero or one default provider per slot in v1;
  document this as a product simplification, not a universal capability limitation.
- [ ] Examine simultaneous Jira + GitHub: default interface plus service integration
  versus named bindings. Record review outcome before choosing either; do not
  claim solved or build a generalized multi-provider solver by assumption.

### D11 — Captured managed composition and retention

Contract: decision 11; proposal §10–§11; retention contract. Documentation reconciled.

- [ ] Resolve channel/pin once per transaction, consistently across all references;
  captured resolution includes soul snapshot, capability closure, helpers, commands,
  hooks and managed runtime resources, non-secret configuration and provenance.
- [ ] Several artifacts per capability coexist, one artifact per capability ID per
  instance; incompatible closure paths fail with both origins, no newest-wins rule.
- [ ] Publish every required artifact then commit a **complete** resolution before
  launch; failure may leave unreferenced valid trees, never a selectable partial record.
- [ ] Instance and independent queued work retain exact references outside homes;
  launch/restart/retire/recovery/generated commands/runtime packages/helpers use
  those roots after source/home deletion, never today's ambient config/lock.
- [ ] Retain conservatively while instances, pending jobs or supported recovery
  paths reference source trees, artifacts and records; no elaborate GC initially.
- [ ] Immutability is OATS-managed software only, not knowledge contents, credentials,
  membership, work repo, services or host tools. Credential rotation and authorized
  membership change do not silently upgrade software; rollback does not undo external
  writes and shared external-state compatibility belongs to providers.
- [ ] Recurring schedules state capture versus explicit later reprepare policy;
  capture remains proposed pending review. Already queued executions never advance.

### D12 — Trust and explicit freshness

Contract: decision 12; proposal §11. Documentation reconciled.

- [ ] Commands, hooks **or environment (`env`)** make a capability executable;
  changed executable artifact integrity/revision needs fresh approval. Retention,
  catalog identity, publisher continuity and a local download confer none.
- [ ] Declarative skills receive bounded visible change notices without adding an
  execution-approval gate; unchanged artifacts need not lose approval merely for
  unrelated source-repository changes.
- [ ] Explicit prepare/update refreshes once per transaction; show available-unapproved
  beside last-approved usable, never “latest” for the latter. Offline/stale/failure
  states remain visible; failed required updates do not claim successful refresh.
- [ ] No daemon, unattended trust or unattended approval in v1. Any future bounded
  policy is a separate product decision, not a shortcut around an approval prompt.

### D13 — Versioned mode-aware digest at migration

Contract: decision 13; retention “Storage API implemented in this patch”. Documentation reconciled.

- [ ] New digest covers file bytes, symlink targets and regular-file executable flag
  normalized from owner execute, `(mode & 0o100) !== 0`, identically for Git and `path:`.
- [ ] Versioning unambiguously distinguishes formats; old bytes/symlink digests remain
  verifiable and are never reinterpreted as covering modes or silently reapproved.
- [ ] Group/other execute and all other mode bits are outside identity. Retention
  preserves modes, never rewrites them or infers entrypoints by parsing free-form
  command/hook strings. This models execution by the owning deployment operator,
  not arbitrary OS principals. New wire spelling requires schema review.

### D14 — Explicit, honest migration

Contract: decision 14; retention “Consumer migration”. Documentation reconciled.

- [ ] One explicit store/lock migration verifies existing flat artifacts and preserves
  those exact inputs, not refetched moving-source substitutes for overwritten history.
- [ ] Existing instances/jobs report `reconstructed`, `partial` or `unknown`, with
  evidence and unresolved inputs. Partial/unknown cannot pass complete readiness
  in CLI or later Desktop; running sessions remain intact, restart boundary chosen
  by their owners.
- [ ] Follow all five consumer steps: (1) schema/store migration, (2) acquisition and
  preparation retention, (3) new instance/job captured references, (4) evidence-based
  old-record migration, (5) remove mutable lookups and update diagnostics/removal.
  No permanent dual resolver/store model.
- [ ] Check acquisition, restoration, trust, discovery, spawn, launch, retirement,
  package/CLI diagnostics and scheduler/operation callers. A path in metadata is
  not proof of retained implementation. Preserve typed absence/invalid/drift refusals
  and never silently repair damaged retained trees or records.

### D15 — No new infrastructure

Contract: decision 15; proposal §6–§8. Documentation reconciled.

- [ ] Git hosting, selected messaging provider and existing machines are sufficient;
  no registry, discovery daemon or OATS user/permission database is introduced.
- [ ] Standalone/no-Git deployment uses the same explicit-scope APIs, not a fake
  workspace or parent-directory authority scan. Only required source closure is
  acquired; optional caches are optimizations, not authority or activation.

## Dependency-ordered delivery plan

Owners here are **responsibilities**, not assignments to a deployment/person.
Parallel code work may proceed only at settled interfaces; synthesis and adversarial
review bind the exact combined tree. Documentation status does not approve syntax.

| Stage | Prerequisites | Deliverable / boundary | Acceptance evidence needed | Ledger at baseline |
|---|---|---|---|---|
| P0 — Documentation reconciliation | Full handoff, amendment and landed contract | Maintainer: reconcile proposal/explainer/handoff, preserve public amendment, this ledger | Link/fence/checklist/provenance checks; independent clause review | Documentation checks and final read-only review passed; receipt below |
| P1 — Acyclic artifact mechanics | Retention contract; P0 constraints | Foundation: shared copy/digest/publication leaf; core and retention consume it without a cycle; no policy/lifecycle in leaf | Dependency graph/import tests and original retention tests; behavior-preserving baseline digest | Pending acceptance; concurrent code edits not certified here |
| P2 — Versioned records and source custody | P1; schema review | Resolution/storage: explicit-scope records outside homes; separate source retention; exact identity/revision/alias; per-choice provenance and constraints; provider-neutral payload; typed refusals | Invalid/partial/prototype-safe record tests, source resource closure and deletion, atomic publication and damaged-tree refusal | Pending; wire versions/paths require review |
| P3 — Soul declarations | P0; source/parser review coordinated with P2 | Parser: git/repo/path, requires/defaults, fixed versus rebindable knowledge, aliases; no type/repository tier | Nested-source base/containment, conflict origins, missing bindings, source completeness | Pending; examples are not schemas |
| P4 — Workspace and discovery | P3 identities; canonical-remote review | Discovery: reciprocal members of every kind, bounded data-only exports, stores/defaults/catalogs/import advertisements | Two layouts, uncloned/inaccessible/forked/renamed sources, authorization-context cache tests | Pending |
| P5 — Import and bounded composition | P2–P4 | Resolver: by-reference import, qualified adoption defaults, same standalone reference, one workspace, work-target briefing | Same public soul unchanged in org and no-Git standalone; source identity/revision/alias; no copy or false membership | Pending |
| P6 — Explicit preparation transaction | P1–P5 | Acquisition/resolution: select once, publish artifacts, commit complete record before launch; preserve trust/host requirements; no implicit provider default | Failure injection before publication/commit/launch, available-unapproved vs last-approved, env-only gate, visible declarative changes, separate readiness | Pending |
| P7 — Coordinated consumer/migration boundary | P2/P6; reviewed lock/digest migration | Lifecycle: implement retention contract steps 1–5 as one migration; wire acquisition/restore/trust/CLI and all dispatch consumers; no ambient substitutions | A/B end-to-end lifecycle/queued job after source deletion, legacy status evidence, old/new digest tests, referenced-removal protection | Pending; no scheduler activation |
| P8 — CLI/provider readiness | P5–P7 | CLI and provider owners: show provenance/choices/missing configuration, reconstructed/partial/unknown; alternate knowledge payload | JSON/text diagnostic contract checks; alternate provider is not forced into OKF; explicit store-qualified default payload | Pending |
| P9 — Messaging qualification | Named owner; P5–P8; approved provider test plan | Messaging owner: human/context identity, private reuse, wider choices, global identity continuity and four grants | Two humans on two hosts each; child inheritance; widen/narrow; discovery/contact/history/admin limits; messaging-disabled and standalone cases | **Unqualified**; choices only until evidence |
| P10 — Operational rollout | Exact-tree infrastructure review and applicable P1–P9 gates | Deployment owner: deliberate release/install/migration with preserved running sessions and separate operational evidence | Required scaffold-only probes/retirement when authorized for that lane, installed-consumer tests, honest missing/unqualified status; no capture-patch integration | Not performed by this documentation lane |
| Later — Desktop features | Infrastructure APIs/readiness and separate feature delivery | Desktop owner consumes same records and diagnostics, never promotes partial/unknown to complete | Later GUI acceptance; cannot substitute for infrastructure or messaging proof | **Later**, not this phase |

P2 and P3 can refine syntax together; neither silently standardizes examples before
parser review. P7 can be built incrementally, but consumers must not be declared
migrated until the coordinated boundary is complete. P9 does not block recording
choices or honest incomplete CLI diagnostics; it blocks enrollment/privacy claims.
P10 is not permission for this documentation lane to perform any live operation.
Simultaneous Jira/GitHub must be investigated before any related solver/binding
extension; no stage chooses its answer here.

## Acceptance ledger

| Gate | Falsification / required observation | Evidence state |
|---|---|---|
| A0 — Retention prerequisite | A/B trees execute their own storage-test payload after removing original source, flat store and lock; damaged entries not repaired | Landed source/tests at baseline, per retention contract; not rerun or widened into runtime proof by this document |
| A1 — Portable adoption | Same public soul unchanged in organization and no-Git standalone; no publisher workspace; public read and explicit adopter write destination; source/revision/alias independently verified | Pending executable acceptance |
| A2 — Private-first | Two humans, two hosts each; inherited child, same private key across hosts, wider set replace/narrow, stable global identity; four grants separately qualified; no silent knowledge-binding change | Unqualified; named messaging owner required, no privacy guarantee |
| A3 — A/B runtime | Old instance AND independent queued work run A's lifecycle/recovery after source removal while new work uses approved B; no ambient latest lookup | Pending; storage A0 is insufficient |
| A4 — Resolution/trust failure | Conflict provenance, missing bindings, env-only approval, no selectable partial record; explicit refresh notices and no unattended trust | Pending |
| A5 — Knowledge neutrality | Store-qualified nodes/destinations, multi-store stewardship, PR versus acceptance, public reads not publication; alternate provider configuration without OKF semantics | Pending |
| A6 — Migration/digest | Old evidence graded, overwritten artifact honestly unrecoverable, running sessions preserved; versioned owner-execute digest with old-format verification | Pending |
| A7 — Discovery/access | Reciprocal admission every kind; forks/unadmitted excluded; bounded data-only indexes and protected descriptions/authorization caches; no new registry | Pending |
| A8 — Documentation consistency | Full amendment coverage; 15 decisions; portable links; no stale operational/privacy claims; illustrative YAML not presented as final schema | **Passed for documentation only**; validation and final review receipt below |

No live acceptance, deployment, model learning or GUI evidence is manufactured by
this ledger. Consumer/API paths must be inspected at the actual tested revision;
this plan is not an instruction to bypass protected current sessions or trust.

## Documentation validation receipt

Validation on 2026-09-15, documentation only:

- Inline Python static validator: **5 files**, **48 local links/anchors**, **15
  balanced fenced blocks** before adding the reproducible command below; handoff
  decisions **1–15** and checklist sections **D01–D15** present; trailing-whitespace
  and private-path/credential-marker scans passed. This is not a general secret scan.
- The appendix's substantive text was compared byte-for-byte with the complete
  supplied amendment from its “Section 3” heading onward: **identical**. Its SHA-256
  is `053118e61807a4d4d57a0de12a96833c7de76f0fc7d29df0ff49ade646b83e50`.
  The checksum permits future verification without an ignored source file.
- The final reproducible public-only command below ran via `bash -e -c` and
  **passed: 5 files, 48 links/anchors, 16 fenced blocks, 15 decisions/checklists**,
  plus the substantive amendment checksum. No parser/runtime behavior was tested.
- `git diff --check -- docs/design` and
  `git diff --exit-code -- docs/design/2026-09-14-artifact-retention-contract.md`
  **passed** for tracked whitespace and preservation of the landed contract.
  The separate new-file whitespace loop below also passed for all five documents.
- Read-only workflow `binding_design_review`: full clause/amendment/retention review
  passed; explainer review returned three concrete inconsistencies (unconditional
  B selection, approval per source revision rather than changed artifact, and
  publication equated with launch). All three were corrected.
- Read-only workflow `binding_design_final_review`: **passed with no findings**.
  The reviewer read all five documents, rechecked the full explainer and all three
  fixes, and independently confirmed the appendix checksum, trailing whitespace
  and unchanged retention contract. Documentation acceptance only; runtime work,
  parser/schema approval and provider qualification are still separate gates.

No parser acceptance, lifecycle test, model learning, deployment or provider privacy
claim follows from these checks. The landed retention contract remains unchanged.
Runtime/full repository tests belong to the foundation/consumer lanes and are not
claimed run by this documentation task.

Reproducible **public-only documentation check**, from the implementation worktree
root (checks these five files, not implementation behavior):

```bash
python3 - <<'PY'
from pathlib import Path
import hashlib, re
root = Path('docs/design')
files = sorted(root.glob('*portable-souls*.md'))
assert len(files) == 5
links = blocks = 0
for path in files:
    text = path.read_text()
    assert text.endswith('\n') and not text.endswith('\n\n'), path
    assert all(line == line.rstrip() for line in text.splitlines()), path
    # Track Markdown fences, not inline backticks in the displayed checker.
    fence = None
    for line in text.splitlines():
        match = re.match(r'^(`{3,})(.*)$', line)
        if match and fence is None:
            fence = match[1]
            blocks += 1
        elif match and match[1] == fence and not match[2]:
            fence = None
    assert fence is None, path
    for target in re.findall(r'\[[^\]\n]+\]\(([^\s)]+)\)', text):
        if re.match(r'^[a-z]+://', target):
            continue
        name, _, anchor = target.partition('#')
        destination = path.parent / name if name else path
        assert destination.exists(), (path, target)
        if anchor:
            headings = re.findall(r'^#{1,6} (.+)$', destination.read_text(), re.M)
            slugs = [re.sub(r'[^\w\- ]', '', h.lower()).replace(' ', '-') for h in headings]
            assert anchor in slugs, (path, target)
        links += 1
    # This is a narrow marker check, not a credential-discovery operation.
    forbidden = ['/' + 'Users/', 'instances/' + 'oats-expert', 'juan.' + 'aweb.ai']
    assert all(marker not in text for marker in forbidden), path
handoff = (root / '2026-09-15-portable-souls-handoff.md').read_text()
body = handoff.split('## 2. The decisions (binding)\n')[1].split('## 3.')[0]
assert re.findall(r'^(\d+)\. ', body, re.M) == [str(i) for i in range(1, 16)]
ledger = (root / '2026-09-15-portable-souls-implementation.md').read_text()
assert re.findall(r'^### D(\d\d) ', ledger, re.M) == [f'{i:02}' for i in range(1, 16)]
appendix = (root / '2026-09-14-portable-souls-contract-amendments.md').read_text()
marker = '## Section 3: responsibilities and knowledge'
body = marker + appendix.split(marker, 1)[1]
assert hashlib.sha256(body.encode()).hexdigest() == '053118e61807a4d4d57a0de12a96833c7de76f0fc7d29df0ff49ade646b83e50'
print(f'PASS: {len(files)} files, {links} links/anchors, {blocks} fenced blocks; 15 decisions, 15 checklists; amendment checksum')
PY
for file in docs/design/*portable-souls*.md; do
  status=0
  output=$(git diff --no-index --check /dev/null "$file" 2>&1) || status=$?
  # --no-index may return 1 for differences even without whitespace errors.
  test -z "$output" && test "$status" -le 1 || { printf '%s\n' "$output"; exit 1; }
done
git diff --check -- docs/design
git diff --exit-code -- docs/design/2026-09-14-artifact-retention-contract.md
```
