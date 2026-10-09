# The runnerless release lane

`scripts/release-lane.mjs` releases OATS without GitHub Actions. It is the
same release as [`.github/workflows/release.yml`](../.github/workflows/release.yml),
run phase by phase on operator machines, with every output written under a
stage directory so the release can stop and resume at any phase.

The policy it satisfies: no release capability may permanently depend on
GitHub or GitHub Actions. Registry publish works on its own; tags and hosted
release assets can follow later.

The last two sections cover the post-publish Desktop check and mirroring a
released `oats.okf`.

## When to use it

- **Runner outage.** GitHub Actions is down, queued, or a runner image has
  broken under the workflow. Build and publish here; push the tag and let the
  workflow catch up when it can.
- **Urgent release.** The kernel fix must reach npm now. `build` and
  `publish-npm` are enough for that; Desktop installers and the GitHub Release
  follow when they are ready.
- **By choice.** Any release may be cut this way. The gates are the workflow's
  gates; only the host differs.

## Phases

Every phase takes `--tag vX.Y.Z` and reads or writes `stage/<tag>/`
(gitignored; `--stage <dir>` overrides). `MANIFEST.json` there records the
SHA, the tarballs and their digests, the assets, and which phases completed.
Every external command is printed before it runs and its output is logged
under `stage/<tag>/logs/`; a failing step exits non-zero with the log path.

| Phase | Mirrors in `release.yml` | Writes |
| --- | --- | --- |
| `build --tag vX.Y.Z [--sha <commit>]` | jobs `build-and-test` and `tests` (the lane runs the suite unsharded): notes gate, three-manifest bump, `node --check`, `npm ci`, `npm run check`, Desktop test deps, `npm test`, `pack:check` and the tarball greps, `smoke:tarball`, the `version --json` probe | `npm/*.tgz`, `MANIFEST.json` |
| `desktop --tag vX.Y.Z --arch arm64\|x64` | one `desktop-build` matrix leg: desktop `npm ci`, `npm test`, `npm run dist -- --<arch>`, strict deep `codesign --verify` (macOS), `dist:smoke` in build-verify mode | `assets/oats-desktop-*` |
| `stage --tag vX.Y.Z` | publish job, "Checksums" (`shasum -a 256`) | `assets/SHA256SUMS.txt` |
| `publish-npm --tag vX.Y.Z [--dry-run] --yes` | publish job, the two guarded `npm publish --access public` steps, kernel then adapter | — |
| `tag --tag vX.Y.Z [--push --yes]` | the tag push that triggers the workflow | annotated tag |
| `release-github --tag vX.Y.Z --yes` | publish job, `gh release create` / `gh release upload --clobber` | GitHub Release |
| `status --tag vX.Y.Z` | — | prints what ran, what exists, what remains |

`build` refuses on a dirty working tree and, like the workflow, refuses a SHA
that is not on `origin/main` (`--allow-off-main` is the explicit human
override; report the risk you accepted). It never touches the checkout it
runs from: it exports the SHA into a detached worktree under the system
temporary directory (recorded in `MANIFEST.json`, `--export <dir>` overrides)
and runs every build step there. The bumped manifests exist only in that
export; the version-bump commit reaches `main` through the pull request the
workflow opens (or a manual one), merged by a maintainer.

`publish-npm` and `release-github` print their plan and refuse without
`--yes`. `tag` creates the local tag without `--yes` but pushes only with
`--push --yes`. Authentication for npm is whatever `npm whoami` reports, or
`NPM_TOKEN` when set: the token goes into a temporary `.npmrc` handed to npm
through `NPM_CONFIG_USERCONFIG` and deleted afterwards, never into the repo.

## A full release from a Mac plus a Linux host

Release notes must exist at `docs/release-notes/<tag>.md` on the commit being
released, and the commit must be on `origin/main`. On the Mac:

```bash
git fetch origin
node scripts/release-lane.mjs build --tag v0.22.0                 # minutes
node scripts/release-lane.mjs desktop --tag v0.22.0 --arch arm64
node scripts/release-lane.mjs desktop --tag v0.22.0 --arch x64    # needs Rosetta on an arm64 Mac
node scripts/release-lane.mjs status --tag v0.22.0
```

On the Linux host, from a checkout of the same commit:

```bash
node scripts/release-lane.mjs build --tag v0.22.0
node scripts/release-lane.mjs desktop --tag v0.22.0 --arch x64
# then copy stage/v0.22.0/assets/oats-desktop-*-linux-x64.* back to the Mac's stage/v0.22.0/assets/
```

The Linux `build` repeats the kernel checks on that host; its tarballs are
not used. Only the assets travel. Back on the Mac:

```bash
node scripts/release-lane.mjs stage --tag v0.22.0                 # SHA256SUMS.txt over all six assets
node scripts/release-lane.mjs publish-npm --tag v0.22.0 --dry-run --yes
node scripts/release-lane.mjs publish-npm --tag v0.22.0 --yes     # kernel, then adapter
node scripts/release-lane.mjs tag --tag v0.22.0 --push --yes
node scripts/release-lane.mjs release-github --tag v0.22.0 --yes
```

An urgent kernel-only release is `build`, `publish-npm --yes`, and `tag --push
--yes`; the Desktop legs, `stage`, and `release-github` run later against the
same stage directory.

## What is resumable

Everything after `build` reads `MANIFEST.json` and the files already staged:

- A failed step is rerun by rerunning its phase. `build` is build-once: it
  recreates the export and the tarballs; it refuses a stage directory built
  from a different SHA unless `--force`.
- `desktop` legs run in any order, on any number of hosts, days apart. A
  missing export is recreated from the recorded SHA.
- `stage` recomputes the checksums over whatever is in `assets/` and lists
  the legs still missing.
- `publish-npm` skips any version `npm view` already reports live, exactly as
  the workflow does on a same-tag retry, so it can be rerun after a partial
  failure or after the workflow published one of the two.
- `release-github` uploads with `--clobber` when the release exists.

## What the lane cannot produce

- **Build-provenance attestations.** `actions/attest-build-provenance` and
  npm's provenance both require the GitHub OIDC identity; nothing off-runner
  can mint them. A lane-published npm version has no provenance badge, and a
  lane-created GitHub Release has no attestation. Pushing the tag afterwards
  runs `release.yml`, whose steps are idempotent: it skips the live npm
  versions, re-uploads the same assets, and attaches the attestations. That
  later pass is the way to add provenance; nothing is republished.
- **The version-bump PR.** The workflow's final step opens it and stops: the
  run never merges into `main`. A maintainer reviews that the diff is the
  version lines only and merges it. The PR is opened with the workflow token,
  so no checks run on it by themselves; close and reopen it to run them, and
  do not read missing checks as green. Open the PR by hand if the workflow
  does not run.
- **Legs for hosts you do not have.** The Linux AppImage/DEB need a Linux
  host; the lane says so and `stage` lists what is missing.

## How it relates to `release.yml`

`release.yml` is unchanged and remains the default path: pushing a tag runs
it end to end. The lane mirrors its jobs and steps rather than reimplementing
their checks — it calls the same `npm run check`, `npm test`, `pack:check`,
`smoke:tarball`, `dist`, and `dist:smoke` scripts with the same environment
the workflow sets. `test/release-workflow.test.mjs` pins the workflow's
contract; `test/release-lane.test.mjs` covers the lane's gates and phase
logic against fixtures, with `npm` stubbed. The two can run in either order:
a lane release followed by a workflow run, or a broken workflow run finished
by the lane, and neither republishes what the other already did.

## Desktop release verification

Installer CI gates what headless runners can prove reliably for every
published platform/architecture: electron-builder completes, the expected
DMG/ZIP/AppImage/DEB artifacts exist, both packaged macOS `.app` bundles
pass strict deep codesign verification of their complete ad-hoc signatures
(`codesign --verify --deep --strict`), node-pty's packaged `spawn-helper` is
executable, and node-pty loads and spawns under the packaged Electron ABI.
The macOS x64 leg cross-builds on macos-14 and installs Rosetta 2 so that its
x64 Electron + node-pty ABI probe really executes; a wrong-architecture
native module fails that leg.

CI does **not** gate the packaged GUI launch: ad-hoc-signed, non-notarized
Electron apps do not
have a reliable interactive windowserver in headless CI. Post-publish launch
acceptance is therefore owned by the operator/maintainer, using the actual
released installers (not a source checkout):

1. Verify the asset checksum/attestation, install it outside the source tree,
   and on macOS use right-click → **Open** for the Gatekeeper step (ad-hoc
   signatures carry no identified-developer identity).
2. Launch OATS Desktop and open a real deployment; verify roster, brain and
   Markdown reads.
3. Attach an existing tmux terminal, confirm input/output, and close the tab
   (the durable tmux window must survive).
4. Verify the released global CLI is detected and Spawn is enabled; hide or
   mismatch the CLI and confirm reads/terminal still work while Spawn disables
   with recovery guidance.
5. Repeat per published architecture where hardware is available. In
   particular, launch-check macOS x64 on an Intel Mac if one is available;
   CI's Rosetta ABI probe is the native-module proof, while this is the actual
   shipped-installer/user-launch proof.

Record the installed version, platform/architecture and outcome in the
release verification notes. This post-publish check is acceptance — it does
not weaken the pre-publish build/inventory/ABI gates.

## Mirroring a released `oats.okf`

The standalone `awebai/oats-okf` repository is authoritative. This repository
carries a generated mirror of its capabilities under `mirrors/oats-okf*/`
and the inventory `scripts/okf-source-inventory.json`; neither is edited by
hand. The inventory records each capability at its path inside the package
(`capabilities/oats-okf`, what the tag attests) and, in `mirrorPaths`, where
this repository keeps it. The mirror is not under `capabilities/`: this
repository is a workspace member, and member discovery would list it as a
latest-state member capability beside the package. After an okf release is
tagged:

1. Check out the release in a clean clone of `awebai/oats-okf` at the tagged
   commit, with the tag present locally and `origin` pointing at the official
   repository.
2. From this repository:

   ```bash
   node scripts/check-okf-mirror.mjs --finalize --source <clone> \
     --final-tag v<version> --final-commit <full merged commit id>
   node scripts/check-okf-mirror.mjs --verify
   node scripts/check-okf-mirror.mjs --verify-source --source <clone>
   ```

3. Pin the same version in `package-catalog.json` and `oats-workspace.yaml`,
   update the version literals the tests and smoke script carry, and review
   the diff as one PR.

`--finalize` stamps `release.status: published` only when every check passes:
the tag is exactly `v<package version>` and resolves to the given commit; the
source tree is clean, with no masked index entries; the exported files, modes
and symlink targets equal the raw objects at that commit; `origin` is the
official repository, and a fresh `ls-remote` advertises the same tag object
and commit. A failed check leaves the mirror and inventory untouched.

`--verify` needs no network: it checks the checked-in mirror against the
inventory (file set, bytes, modes, symlinks, wrapper hashes). `--verify-source`
re-checks a published inventory against the source and its origin; it attests
what the remote advertised when queried, so released tags must never move.
`--generate --source <clone>` captures a working tree for development and
always records `release.status: pending`.

## Releasing `oats.framework`

The distribution package in `oats-package/` (`oats.core`, `oats.setup`,
`oats.support`, `oats.knowledge-theory`) is not published by `release.yml` or
by this lane. A deployment takes it from this repository at the tag
`oats-framework/v<version>`, through the catalog ref or its workspace pin. A
skill changed under `oats-package/` therefore reaches deployments only when
that tag moves, whatever kernel version carried the change.

**A kernel release whose pull requests touched `oats-package/` ships a
framework release with it.** To see whether one is owed:

```bash
git diff --stat "$(git describe --tags --abbrev=0 --match 'oats-framework/v*' origin/main)" origin/main -- oats-package
```

When the diff is not empty:

1. **The framework prep PR.** Bump `version` in the `oats.json` of each
   changed capability and in `oats-package/oats-package.json`, and add the
   release-notes entry. Read the skill lines added since the last tag: a
   command or behaviour that an older kernel the capability still admits does
   not have names the version it starts in. Guidance text alone does not
   raise a capability's `compatibility.oats`.
2. **The tag.** After the PR merges, put the annotated tag
   `oats-framework/v<version>` on its merge commit and push it. No workflow
   runs on this tag.
3. **The pin**, in the kernel release-prep PR: `package-catalog.json`
   (`ref`), `oats-workspace.yaml`, and the version literals in
   `docs/official-catalog.md`, `docs/packages.md`, `docs/workspaces.md`,
   `skills/oats-getting-started/SKILL.md` and
   `test/release-packaging.test.mjs`. The pin does not ride the first PR:
   the tag needs the bumped manifest on `main` first, and CI reads the
   catalog's ref from the remote. Two tests in
   `test/hook-events-forward-tolerant.test.mjs` sync a deployment that takes
   the official catalog's packages, so the pin's CI fails with
   `E_REMOTE_UNREADABLE` until the tag is pushed. (The clean-room smoke does
   not read it: it tags its own copy of `oats-package/`.) A green CI proves
   that the tag exists, not which commit it names: the pin's reviewer
   confirms on the remote that it names the first PR's merge commit.
