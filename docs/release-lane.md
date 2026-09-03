# The runnerless release lane

`scripts/release-lane.mjs` releases OATS without GitHub Actions. It is the
same release as [`.github/workflows/release.yml`](../.github/workflows/release.yml),
run phase by phase on operator machines, with every output written under a
stage directory so the release can stop and resume at any phase.

The policy it satisfies: no release capability may permanently depend on
GitHub or GitHub Actions. Registry publish works on its own; tags and hosted
release assets can follow later.

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
| `build --tag vX.Y.Z [--sha <commit>]` | job `build-and-test`: notes gate, three-manifest bump, `node --check`, `npm ci`, `npm run check`, Desktop test deps, `npm test`, `pack:check` and the tarball greps, `smoke:tarball`, the `version --json` probe | `npm/*.tgz`, `MANIFEST.json` |
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
export; the version-bump commit to `main` remains the workflow's job, or a
manual PR.

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
- **The version-bump PR.** The workflow's final step; open it by hand if the
  workflow does not run.
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
