# Migrating OKF v1 knowledge to v2

> **Prepared, not a live migration.** These instructions target oats.okf 2.0.0
> with OATS >=0.23.0 and the prepared framework v0.23.1 integration. Confirm the
> final standalone source tag and dependencies are published before following
> the acquisition path. See [release gates](release-notes/v0.23.1.md).

This is **not** `oats migrate`: kernel lock/package migration and
[OAS name migration](migration-from-oas.md) do not relocate knowledge, establish
v2 ownership or preserve source cursors. Nor does upgrading npm activate a new
knowledge layer. V2 uses external accepted bases and independent workers, not
`soul/knowledge/`, attached harvest commits or source-home watermarks.

## 1. Inventory and preserve before changing activation

- Record each scope's package lock, active knowledge binding, effective settings,
  soul instructions/skills and current knowledge bytes. Do not hand-edit locks.
- Inventory live source homes, state/log/notes, v1 current/prepared watermark
  files, active harvesters, unpublished commits and open PRs. Resolve or preserve
  in-flight work deliberately; do not run old and new writers concurrently.
- Back up source material outside disposable homes/worktrees. Keep v1 artifacts
  available until accepted delivery, owner cutover and fresh-reader verification
  have succeeded. A successful scaffold or command exit is not learned expertise.
- Plan the deployment interruption and test the migration on isolated copies.
  The required v2 spawn hook refuses a legacy `soul/knowledge/`; it never silently
  substitutes an empty bundle.

After publication, bump `packages.oats.okf` in the workspace file and run
`oats sync`: the new version resolves to a commit, is fetched, its integrity is
verified and the lock is rewritten. An existing lock never advances by itself. Package content is
read from the catalog **Git** repository, never from an npm mirror (npm drops
the source worker's canonical `CLAUDE.md` symlink).

## 2. Bind and provision external destinations

Follow [bindings and owner descriptors](knowledge.md#acquire-bind-and-provision-explicitly).
Choose stable base IDs, stable owner IDs, nonoverlapping node paths and durable
`stateDir`. `owns` routes responsibility; `reads` chooses starting context, not
permissions. Confirm aliases and owners explicitly, rather than deriving them
from an instance branch or name.

Configure the absolute `bindings-file` **and** `state-dir` for each source soul
— the oats.okf 2.1.x binding requires both as normalized absolute host paths
(`setting state-dir is required (absolute host path)` is a refusal, not a
default). Remove obsolete v1 settings such as `record-window-turns` and
`record-window-bytes`; v2 accepts exactly `bindings-file`, `state-dir`,
`harvest-runtime` and `harvest-model`. Under the 0.25 workspace model these live
in `oats-local.yaml` `settings.oats.okf` ([configuration.md](configuration.md));
a rebuilt deployment gets a **fresh** `state-dir`
([rebuild-to-v2.md §7b](rebuild-to-v2.md#7b-okf-2-start-a-fresh-state-dir-do-not-re-point-the-old-one)).
Provision **empty owned nodes** using `oats okf init`. Accept Git initialization
through a reviewed PR before migration delivery; directory provisioning requires
explicit confirmation and a genuinely non-Git location.

## 3. Stage and deliver each legacy bundle

From the deployment directory (the one holding `oats-local.yaml`) in an operator
shell without inherited instance identity, selecting the source soul with
`--soul` — the kernel resolves the command exactly as `oats spawn --soul <x>`
would ([knowledge.md](knowledge.md#inspection-and-operator-commands)):

```bash
oats okf migrate --legacy /absolute/soul/knowledge --base project --node expert --output /absolute/empty-migration-stage --soul domain-expert --json
# Use the exact migration.json path returned above:
oats okf migrate --deliver /absolute/state/migrations/UUID/migration.json --soul domain-expert --json
```

Staging preserves the full original in migration custody, rewrites bundle-root
Markdown links into the external node namespace and validates the whole base.
The output must be disjoint from **every** configured accepted base and directory
coordination artifact. The destination node must be empty; migration refuses
ambiguous automatic merges.

Delivery follows the actual provider protocol:

- **Git:** a real PR, never a direct push to the accepted branch. Review and merge
  it, then repeat `migrate --deliver` to confirm merge-visible acceptance.
- **Directory:** recoverable publication with a cooperative lock, baseline check,
  journal and validated acceptance receipt. Resolve any journal before proceeding.

A staged bundle, delivered PR or proposed owner mapping is not cutover.

## 4. Deliberate owner cutover

```bash
oats okf migrate --cutover /absolute/state/migrations/UUID/migration.json --soul-dir /absolute/soul --soul domain-expert --json
```

Cutover requires accepted delivery, unchanged legacy bytes and current bindings
still pointing to the frozen delivered base. It verifies accepted readiness,
node owner/path and delivered content, then renames the old bundle into durable
custody and updates `soul/okf.json`. It changes no skills and leaves no permanent
knowledge symlink in the soul. Cross-device rename fails safely: arrange an
explicit operator cutover rather than deleting originals to force it. An
incomplete cutover marker blocks new source registration until that recorded
cutover is retried.

Explicitly review old soul instruction references to `soul/knowledge/`, direct
promotion and after-commit harvest. Point readers to the capability-provided
accepted views; ordinary agents capture but never edit accepted knowledge. This
instruction review is not an automatic rewrite performed by migration.

## 5. Preserve and re-register existing sources

For every surviving v1 source home:

```bash
oats okf migrate --source-home /absolute/legacy-instance-home --soul domain-expert --json
```

This copies allowlisted state/log/notes and old cursors into migration custody,
**deleting nothing**. Old watermarks are retained as evidence, not trusted as v2
processing proof. After soul migration, explicit `harvest` from that clean deployment context
re-registers a source,
captures visible notes and record, and idempotently verifies its per-source job:

```bash
oats okf harvest --home /absolute/legacy-instance-home --no-launch --soul domain-expert --json
```

`--no-launch` is a scaffold-only worker request, not a read-only operation: it
captures and writes durable state/schedule definitions, but starts no model and
installs no timer. Existing homes retain their composed capability snapshot;
plan refresh/replacement or dispatch through the deliberately selected v2
configuration context. Do not assume updating a package rewrites a running
home's curriculum, trust or native session. Preserve evidence before retiring
or replacing any old home. Replay may legitimately produce merge/drop judgments.

## 6. Verify before retiring old custody

Inspect the durable source descriptor and its receipts. Confirm frozen owners,
accepted view paths, captured notes **and full record windows**, processing and
provider acceptance separately. Verify live inspection only shows the matching
source's state/log/notes. After safe source retirement, `--source` inspection and
read/refresh must still work from durable context; new views belong in state,
not the deleted home or invoking repository.

Enable a host timer only with explicit operator consent after reviewing source
jobs and available worker runtimes. Existing no-launch sources cannot cause
scheduled model launches; do not turn an isolated rehearsal into a deployment.
A source whose final capture is incomplete must retain its home for retry.

Finally start a fresh, deliberately selected runtime instance and verify it can
find **and use** the accepted lesson without the original source. A no-launch
reader verifies layout and links, not model learning. Only then consider old
custody cleanup under an explicit retention decision; v2 does not automatically
remove preserved evidence, old views, migration archives or unresolved runs.
