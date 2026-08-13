# BREAKING: desktop succession — `oats.web`, `oats pane`, and the control-pane library are retired

**The next release of `@awebai/oats` containing this change is a
BREAKING release.** Three previously shipped surfaces were removed in favor of
the OATS Desktop app (`packages/desktop/` in the framework repo):

| Removed surface | Replacement |
|---|---|
| `oats.web` marketplace capability (`oats web start`, browser panel) | OATS Desktop app — the same zero-dependency loopback server is bundled at `packages/desktop/server/` and spawned by the app |
| `oats pane` CLI command and the Control Pane TUI | OATS Desktop app (Active overview / instance roster) |
| `@awebai/oats/control-pane` package export (`lib/control-pane/model.mjs`) | The roster model moved into `packages/desktop/server/model.mjs`; it is no longer a public kernel export |

## Migrating a deployment that used `oats.web`

1. Remove the `oats.web` entry from `capabilities.additive` in every
   `oats-config.yaml` in your config chain.
2. Remove the `oats.web` entry from `oats-lock.json` at the same scope(s), and
   delete any stale installed copy under `.agents/capabilities/installed/`.
3. Use the OATS Desktop app instead: `cd packages/desktop && npm install &&
   npm run rebuild && npm start` (see `packages/desktop/README.md`).

The CLI diagnoses stale references instead of failing opaquely:

- `oats doctor` warns when an `oats-lock.json` still pins `oats.web`, with the
  fix spelled out.
- Bare `oats install` reports the lock entry as `RETIRED` (with guidance)
  rather than a restore failure.
- `oats install oats.web` and a config activation of `oats.web` fail with a
  message naming the successor and the exact cleanup steps.

## Migrating `oats pane` usage

`oats pane` now exits with a pointer to the desktop app. Scripts or docs
invoking it should launch OATS Desktop instead. The `--theme` themes (dark,
solarized) exist in the app's theme system.

## Consumers of the `./control-pane` export

`import ... from "@awebai/oats/control-pane"` no longer resolves. The
model's pure helpers (`readMarkdownSection`, `parseTmuxWindows`,
`parseGitStatus`, `parseGitDiffStat`, `buildConstellation`, `relativeAge`)
live in `packages/desktop/server/model.mjs`, which is private to the desktop
app. If you depended on this export, vendor the helpers or open an issue —
no known external consumer existed at removal time.

## Release gating (maintainers)

Downstream installers/packaging for the desktop app must exist **before** the
next release ships; this migration note travels with the release notes and
the release must be flagged **BREAKING** (major or clearly-marked minor per
the project's pre-1.0 conventions).
