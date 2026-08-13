---
name: git-tag-release
description: How to ship a release of the oats-framework packages via the tag-driven CI. Use when publishing a new version of @awebai/oats / @awebai/oats-pi, cutting a release, "ship an update", bumping the version, or debugging a failed Release workflow run.
---

# Releasing via git tags (oats-framework)

Releases are **tag-driven**: pushing a tag `vX.Y.Z` (on a commit reachable
from `main`) triggers `.github/workflows/release.yml`, which bumps both
packages to X.Y.Z, syntax-checks all shipped `.mjs`, sanity-checks the
tarballs, publishes `@awebai/oats` and `@awebai/oats-pi` to npm, then
creates and merges a `release: vX.Y.Z` version-bump PR back to main.

## Procedure

1. **Do NOT bump versions locally.** CI derives the version from the tag and
   runs `npm version X.Y.Z`; if package.json already carries that version,
   CI fails with "Version not changed". Local package.json should still show
   the *previous* released version when you tag.
2. Land the change: commit (signed-off) and `git push origin main`. Bring
   instance memory up to date first (STATE.md, log.md, notes/) per the OKF
   protocol.
3. Pre-flight locally (cheap, catches most CI failures):
   ```bash
   find . -name "*.mjs" -not -path "./node_modules/*" -exec node --check {} \;
   ```
   For changes touching package contents, bin entry points, adapter/kernel
   resolution, or release smoke logic, the smoke must cross the checkout
   boundary: pack both `@awebai/oats` and `@awebai/oats-pi`, install
   the tarballs in a clean external directory, point the adapter at the
   installed kernel, and run installed CLI/core behavior. Do not substitute a
   repo-local scaffold probe; see
   `knowledge/lessons/package-smoke-tests-cross-checkout-boundary.md`. For
   Pi adapter/resource changes, the real probe must verify an instruction
   marker, a selected skill name, and the absence of an unrelated ambient
   workspace skill; enable at least the read tool so Pi can load skill bodies.
4. Tag and push (v* tags are admin-restricted; pushes show a "Bypassed rule
   violations" notice — that's expected for the admin):
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
5. Watch CI: `gh run list --limit 2`; on failure
   `gh run view <id> --log-failed`.
6. Confirm publish: `npm view @awebai/oats version` (and `/pi`). If the
   later version-bump PR step fails, treat the npm publish as already done and
   follow the manual bump-PR rescue below instead of retagging.

## Verify the deployment (mandatory)

Per the lesson `knowledge/lessons/release-verification.md`: probe the
artifact, not the diff.

```bash
TMP=$(mktemp -d)
npm i -g @awebai/oats@X.Y.Z --prefix "$TMP/g"
OATS="$TMP/g/bin/oats"
mkdir -p "$TMP/ws/agents" && cd "$TMP/ws"
$OATS init --knowledge oats.okf --messaging none --tasks none
$OATS create probe --description "release probe"
git init -q repo && (cd repo && git commit -q --allow-empty -m init)
$OATS spawn probe --task noop --repo "$TMP/ws/repo" --work checkout --no-launch
$OATS retire probe-1
rm -rf "$TMP"
```

Check the specific change in the generated instance `AGENTS.md` and exact
`.agents/skills/` set while confirming the canonical soul stayed unchanged,
plus `node --check` on every `.mjs` in the installed tree. Adapter/resource
changes also require a real pi session with the matching packed/published
`@awebai/oats-pi` loaded explicitly. Do not accept instance `.agents/skills/`
entries that are directory symlinks as sufficient: Pi 0.80.6 did not descend
through those entries during recursive skill discovery, so the runtime probe is
what proves the materialized resource shape works.

Pi install cleanup gotcha: after installing a new `@awebai/oats-pi` version,
`pi remove npm:@awebai/oats-pi@OLD` removes all settings entries for that
package name, not just the old spec. Reinstall the new version after any
remove.

## If the run failed

- **"Version not changed"**: you bumped package.json locally. Revert the
  bump on main (commit + push), then re-cut the tag on the fixed commit:
  ```bash
  git push --delete origin vX.Y.Z && git tag -d vX.Y.Z
  git tag vX.Y.Z && git push origin vX.Y.Z
  ```
  Retagging is safe *only while nothing published* — never move a tag whose
  run reached npm publish; cut a new patch version instead.
- **Tag not on main**: CI refuses tags whose commit isn't reachable from
  main. Merge first, then tag.
- **`npm publish` fails with `EOTP`**: the `NPM_TOKEN` is subject to npm
  2FA-on-publish. Create a granular npm access token with read/write access
  for the `@awebai` packages/org, update the GitHub Actions secret
  (`gh secret set NPM_TOKEN`), then rerun failed jobs with
  `gh run rerun <id> --failed`. Nothing publishes on EOTP, so the existing
  tag is still safe; repo renames do not matter because npm authority is
  token/account/package-scoped. See
  `knowledge/lessons/npm-eotp-in-tag-release.md`.
- **Version-bump PR creation fails with `GraphQL: Resource not accessible by
  integration (createPullRequest)`**: check `npm view @awebai/oats
  version` first. Publishing completed before this step, so do not retag for
  the bump-PR failure alone. The repo-level "Allow GitHub Actions to create
  and approve pull requests" toggle is locked by the awebai org policy
  (repo API returns 409 "disabled by the organization"; changing it requires
  org admin + `admin:org`). Until an org admin relaxes the policy, create and
  merge the release-bump PR manually:
  ```bash
  gh pr create --base main --head release-bump/vX.Y.Z \
    --title "release: vX.Y.Z version bump" --body "..."
  gh pr merge release-bump/vX.Y.Z --squash --delete-branch
  git pull
  ```
  See `knowledge/lessons/release-bump-pr-org-restriction.md`.
- **Publish succeeded for one package only**: cut a new patch release;
  npm versions are immutable.
