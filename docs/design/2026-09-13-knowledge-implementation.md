# Knowledge implementation plan

Status: implementation authorized by the human on 2026-09-13, including main
pushes and framework/OKF releases. Execute bounded batches with adversarial
review after approximately every two new commits, including fix commits.
The [location contract](2026-09-13-knowledge-location-contract.md) and its
[reference-theory boundary](../../agents/oats-expert/soul/knowledge/decisions/provider-neutral-knowledge-and-harvest.md)
remain the architectural context. This document resolves implementation choices
under that authorization; it does not impose OKF policy on other integrations.

## First delivery

- Canonical reference theory and injection/skill authoring guidance.
- An optional, installed-artifact-usable `knowledge-theory-expert`.
- Default OKF with working Git and ordinary directory custody. Omnigraph is an
  authoring example, not a dependency or a required first implementation.
- Explicit external base/node ownership and initial reads; independent,
  automatically requested per-source harvest; preserved evidence before
  retirement; Git deliveries always PRs; no Git dependency for directory mode.
- Explicit migration with preservation and cutover, never silently discarding
  an old soul bundle or treating a missing base as empty knowledge.

## Implementation choices

1. **Capability-owned configuration.** Initially accept one absolute
   `bindings-file` setting, avoiding ambiguous relative-setting provenance.
   Paths inside it resolve from that file's directory. The document contains
   version, durable state directory, named Git/directory bases and cadence.
2. **Capability-owned soul declarations.** Use `soul/okf.json` rather than
   teaching the kernel an OKF-specific nested YAML schema. It declares stable
   owner identity, `owns` and `reads`. Accepted bases carry matching identity
   and node ownership metadata. No knowledge content resides in the soul.
3. **One link namespace per OKF base.** Nodes are owned, nonoverlapping
   subdirectories. Reads are selective, index-first and non-mutating. Every
   configured base is discoverable; `reads` is not an ACL.
4. **Durable per-source input.** Keep copied evidence, note hashes, bounded
   record content, frozen destinations and processing receipts outside source
   homes/worktrees and accepted bases. Separate capture, delivered judgment,
   and accepted/reader-visible state. No automatic evidence garbage collection
   in the first implementation.
5. **Directory custody is real.** Independent workers must not require a fake
   Git repository. Add only the generic non-Git execution support actually
   needed; preserve work-mode, trust and retirement safety.
6. **Delivery.** Git workers edit their own accepted-baseline checkout and
   produce a verified PR receipt. Directory workers stage changes and publish
   with baseline checks, coordination and crash-recoverable receipts. Never
   downgrade Git failures into direct writes. Initial directory coordination
   is single-host/cooperative, not a distributed-lock claim.
7. **Automation.** Reuse generic scheduler command jobs for per-source work;
   retain pending work after its source is gone. Source registration is
   automatic; host timer installation is an explicit setup action. Retire
   captures/enqueues, not synchronously waits for model judgment or GitHub.
8. **Optional authoring distribution in this repository.** Ship a dedicated
   `oats.knowledge-theory` package under `oats-package/`, using an enumerated
   self-contained capability subtree. This keeps release scope to the two
   authorized repositories and avoids pretending an edit to the bundled
   `oats.authoring` changes its separately released catalog package. The new
   package supplies the expert and authoring skill/reference closure, has no
   knowledge-layer binding or mandatory injection, and does not depend on OKF.
9. **Minimal generic fixes.** Hooks must receive the running kernel's absolute
   CLI path; scheduled dispatch must not inherit another instance's identity;
   final record capture must distinguish completion from a skipped/held pass.
   Do not add a knowledge registry or compulsory reference doctrine to core.

## Source and delivery discipline

The standalone OKF repository's enumerated runtime subtree is
`oats-package/capabilities/oats-okf/`. Its published `v1.6.1` is the starting
baseline; stale unenumerated duplicates are not implementation targets. The
framework's bundled copy is synchronized only at integration, with parity tests.
Existing release tags are immutable.

Implementation helpers edit explicitly assigned files and do not commit,
push, change branches or release. The maintainer integrates small commits and
runs exact-range adversarial review every two commits, closing blocking
findings before dependent work advances. Reviews cover product boundary,
correctness, security and release/merge readiness, not just test results.

## Verification and release gates

- Standalone tests exercise its actual exported payload, not stale root copies.
- Framework tests include generic non-Git execution, hook/dispatch identity,
  capture-completeness and alternative-provider isolation.
- Real temporary Git repositories test embedded/dedicated Git knowledge; real
  directories outside Git test directory custody, concurrent updates and crash
  recovery. Failed/uncertain publication stays recoverable.
- Source deletion and name reuse cannot lose or misattribute pending evidence.
- Installed-artifact acquire/lock/trust/activate/scaffold/retire probes validate
  the complete expert curriculum and OKF's real compatibility floor.
- A fresh selected-runtime instance must answer from delivered knowledge without
  the source home/transcript. Scaffolding alone is not this learning gate.
- Run strict knowledge validation, all affected tests, full framework gates,
  tarball smoke, and a final cross-repository adversarial review before release.

Version targets are provisional: framework 0.23.0 for generic support, OKF 2.0.0
for breaking external-knowledge custody, optional theory package 1.0.0, then a
framework patch for catalog/payload updates if required. Publish dependency
sources before advancing catalog pins; follow actual current release scripts,
not historical instructions contradicted by the implemented release lane.
