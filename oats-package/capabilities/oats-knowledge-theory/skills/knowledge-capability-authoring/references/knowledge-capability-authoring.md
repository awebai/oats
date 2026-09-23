# Authoring a knowledge capability

This is the canonical source for the optional `oats.knowledge-theory` authoring
curriculum. Its linked reference documents form a self-contained local set.
The released skill includes checked copies of this set; authors and the
`knowledge-theory-expert` can use it without a framework checkout or network.

## Authority and scope

OATS offers an opinionated reference knowledge theory. Default OKF follows it;
other capabilities may adopt, adapt, or replace it. The kernel owns generic
layer selection, configuration, composition, lifecycle, work-mode boundaries
and executable trust, not a compulsory memory ontology or universal judge.

This guide distills the approved 2026-09-13 knowledge scoping session. The
reference derivation comes from OATS's knowledge theory; its historical
references to physical soul bundles are replaced here by external knowledge
custody. The approved implementation plan settles plain-directory OKF as the
first non-Git path and keeps Omnigraph an uninvestigated authoring scenario.
Earlier drafts' open choices are not implementation facts. The curriculum is
a design/authoring reference, not a claim that all default runtime behavior
has already shipped. Verify the capability version actually being evaluated.

Every implementing capability supplies its full runtime package: reader tools,
injections, capture conventions, judgment instructions, harvester if any,
lifecycle/scheduling machinery, validation, delivery and diagnostics. Reuse
may be explicit and versioned, never a hidden fetch of mutable doctrine.
The theory expert advises authors; it does not operate their stores or approve
their compatibility. Installing the theory package activates nothing.

## Install the optional authoring package

The kernel's npm package ships this public guide and the CLI, **not** the
optional expert payload. The catalog selects `oats.knowledge-theory` 1.0.0
from the already-published framework v0.23.0 Git `oats-package/` subtree. Git preserves the canonical
source `CLAUDE.md -> AGENTS.md` symlink; npm omits symlinks, so a partial npm
copy is not a supported distribution. Acquisition does not repair source
aliases or relax installed-artifact integrity checks.

Select a deployment scope explicitly and acquire the published source, then
opt in for an author soul:

```yaml
# oats-workspace.yaml
packages:
  oats.framework: v1.1.3            # provides oats.core, oats.setup, oats.knowledge-theory

# souls/<author-soul>/soul.yaml
capabilities:
  oats.knowledge-theory: { from: package }
```

`oats sync` resolves the version to a commit and locks it; the package is read
at `oats-package/` of its repository.
The `oats.knowledge-theory` catalog shortcut uses that same published v0.23.0
source. The current authoring-reference patch is package 1.0.1: once framework
v0.23.1 is published, an explicit initial Git acquisition at that tag selects
the patch instead. It does not silently change the catalog's 1.0.0 selection
or an existing lock. For local development, use an explicit complete source
package path instead. Activation exposes the expert and targets
the authoring skill, without selecting or replacing a knowledge integration.
There are no executable surfaces to trust in this package. Installed experts
use their materialized local curriculum, not this repository at runtime.

## A bounded authoring session

1. **Choose a model.** Read the [reference model](knowledge-reference/model.md)
   and [adoption choices](knowledge-reference/adoption.md). Record what the
   author is choosing, not what the kernel supposedly requires.
2. **Establish real custody.** Fill the [provider map](knowledge-reference/provider-mapping.md)
   from tool/version evidence. A Git-backed knowledge repository is still Git;
   a directory implementation must work without Git/GitHub. Do not invent
   native graph operations to fill gaps in the table.
3. **Author working behavior.** Use the [reader/capture pattern](knowledge-reference/reader-capture.md).
   Keep every-session instructions short; load detailed native operations from
   that capability's own skills.
4. **Author deliberate judgment.** Use the [harvester pattern](knowledge-reference/harvester.md)
   if adopting this model. Freeze inputs and destinations before execution,
   separate semantic outcomes from delivery outcomes, and define recovery.
5. **Deliver an independently usable package.** Follow [package craft](knowledge-reference/package-craft.md).
   No path in a released soul or skill may depend on an author's checkout.
6. **Verify observable outcomes.** Run the relevant [acceptance cases](knowledge-reference/acceptance.md).
   Structural success is not proof that an agent learned or that a store is safe
   under crashes. State the limit of each test.

## Hand-off template

- Model: adopt / adapt / alternative; rationale and deliberate departures.
- Provider and version: verified tools, evidence, unknown guarantees.
- Responsibility map: who supplies reader, capture, judgment, delivery,
  lifecycle, scheduling and diagnostics; no unowned runtime step.
- Custody: named destinations, owner identity, accepted state, concurrency,
  retry and reader-refresh semantics. No credentials in the report.
- Proposed artifacts: capability manifest, local resources, instructions,
  skills, optional agent, hooks/operations and declared trust surface.
- Verification: tests run, actual receipts/visibility, failures, untested claims
  and the next required approvals. Do not call scaffold-only an agent trial.

## Maintaining these references

Edit this file and `docs/knowledge-reference/` in the framework source, then
run `node scripts/check-knowledge-theory-package.mjs --write` from that checkout.
Run `node scripts/check-knowledge-theory-package.mjs` and
`node --test test/knowledge-theory-package.test.mjs` to verify parity and the
installed artifact. These are maintainer commands, not tools required in an
installed expert's work tree. The copies belong to a package release; edits to
repository docs do not change any installed capability at runtime.
