# Migrating from OAS to OATS

Status: **the migration path exists in the kernel** — `oats migrate
--from-oas`, one transactional conversion per scope (plan steps 1–3 below,
all landed 2026-08-21). What remains is distribution: end users get the
command with the v0.21.0 release (steps 4–6). This document keeps the facts
in one place; the work is tracked as epic `aweb-abfy` in this team's aw
tasks. Audited 2026-08-21 against a live OAS deployment
(`@oas-framework/oas@0.20.0-aweb.1`).

OATS was published as **OAS** (`@oas-framework/oas`, `@oas-framework/pi`)
until the 2026-08-13 rename (commit `fa1e646`), which was a deliberate
clean break: no compatibility shims, and no code in this repo recognizes
`oas-*` names.

## Do not migrate by hand yet

The dangerous property of the original state was that it failed **quietly**:

- On a scope with `oas-config.yaml`/`oas-lock.json`, `oats status` works
  (the `agents/` layout is unchanged) — everything looks healthy.
- But `oats doctor` finds no config, all layers are unresolved, and a spawn
  produces instances **without the knowledge (`oas.okf`) and messaging
  (`oas.aweb`) injections**. The compounding-memory and team-comms value
  disappears with no error.
- `oats migrate --official --dry-run` on such a scope reported "nothing to
  migrate" and exited 0 — false success.

Since plan step 1 landed (below), the silence is closed: `oats doctor` names
an un-migrated OAS scope with the remedy, and every `oats migrate` form —
plain or guided, dry run or apply — exits nonzero when `oas-config.yaml` /
`oas-lock.json` are visible from the scope (detection is by name only; the
kernel never parses OAS files).

## Migrating: `oats migrate --from-oas`

```bash
oats migrate --from-oas --dry-run --dir <scope>   # full per-scope plan, touches nothing
oats migrate --from-oas --dir <scope>             # convert this scope
oats migrate --from-oas --recursive --dir <root>  # every visible OAS scope
```

One transaction per scope, two phases under one journal:

1. **Rename phase** — `oas-config.yaml` → `oats-config.yaml` (line
   transform: the `oas:` defaults key becomes `oats:` and capability ids
   with catalog renames become their successors; comments and every other
   byte survive), `oas-lock.json` → `oats-lock.json` verbatim, `oas.json` →
   `oats.json` inside each installed capability dir, and
   `.oas-scaffold-owners.json` → `.oats-scaffold-owners.json` in `agents/`
   and `local-agents/` souls with owner ids mapped to their successors.
2. **Chained guided conversion** — the existing v1→v2 official migration
   runs on the renamed lock; the catalog's renaming aliases map each
   `oas.*` entry onto the `oats.*` package that replaces it, re-acquiring
   the artifacts (stale v1 integrity is resolved by re-acquisition, never
   recomputed) and cleaning the superseded `oas`-named artifact dirs.

Any failure in either phase restores the scope's original OAS-named bytes.
A second run finds nothing and exits 0. Executable trust is re-earned after
conversion (`oats trust` commands are printed), and comments inside your
config that mention `oas` paths are left untouched — comments are yours.

## The four breaks

1. **File names.** The kernel reads only `oats-config.yaml`
   (`lib/core.mjs:326`) and `oats-lock.json` (`lib/core.mjs:643`). OAS
   scopes have `oas-config.yaml`, `oas-lock.json`, `oas.json` inside each
   installed capability dir, and `.oas-scaffold-owners.json` in souls.
2. **The config key.** The schema (`docs/oats-config.schema.json`,
   `additionalProperties: false`) accepts an `oats:` defaults block and
   rejects the `oas:` block an OAS config carries — renaming the file is
   not enough.
3. **Capability ids.** `oas.okf` / `oas.aweb` appear in the config, the
   lock, and the `.agents/capabilities/installed/<id>/` directory names.
4. **No catalog aliases.** `package-catalog.json` maps only `oats.*` ids;
   a hand-renamed lock naming `marketplace:oas.okf` resolves to
   `available: false` and the guided migration **holds the whole scope**
   (`lib/core.mjs:3251-3262`, `:1416`).

## Why an OAS user cannot even find OATS

- `@awebai/oats` and `@awebai/oats-pi` are **not yet published**; the
  release is blocked on a missing `docs/release-notes/v0.21.0.md`
  (`.github/workflows/release.yml` hard-fails without it) and the repo has
  no tags.
- `@oas-framework/oas` is still live on npm and **not deprecated**, so the
  old CLI's `oas update` (which checks that package) reports "Up to date"
  forever.
- The old OAS desktop probes for `@oas-framework/oas`; the new desktop
  requires `@awebai/oats >=0.21.0 <0.22.0` — old app and new CLI are
  mutually invisible, so desktop must ship in the same release.

## The plan (epic `aweb-abfy`)

1. **Done.** `oats migrate` / `oats doctor` detect an OAS scope and fail
   **loud** with the exact remedy (never exit 0 on "nothing to migrate" when
   `oas-*` siblings exist). `detectOasScopes` in `lib/core.mjs`,
   `discoverOasScopes` in `lib/packages.mjs`, wired in `bin/oats.mjs`;
   tests in `test/oas-scope-detection.test.mjs`.
2. **Done.** Catalog aliases `oas.*` → `oats.*` so legacy locks map instead
   of holding — as *renaming* aliases (`{ "package": "oats.okf",
   "capability": "oats.okf" }`), because the replacement packages export the
   successor ids, never the legacy ones. All seven 0.20 ids are mapped in
   `package-catalog.json`.
3. **Done.** `oats migrate --from-oas`: one transactional command covering
   all four breaks (section above), fixture built from the real deployment
   shape, idempotent, byte-identical rollback on failure, with a migrated
   scope reaching green `oats doctor` and spawns composing the knowledge and
   messaging injections again (`test/from-oas-migration.test.mjs`).
4. v0.21.0 release: notes, version alignment (`packages/pi` is still
   0.20.0), tags, npm publish of `@awebai/oats` + `@awebai/oats-pi`,
   desktop GitHub Release.
5. `npm deprecate` the `@oas-framework/*` packages with a pointer here.
6. Close the `oats-okf` / `oats-aweb` publication gates so migrated scopes
   can restore their capabilities under the new ids.

Until 4–6 are done, OAS users (this includes real daily users) should stay
on `@oas-framework/oas` 0.20.0 — it keeps working and loses nothing by
waiting. The conversion command exists, but until the v0.21.0 release it is
only reachable from a repo checkout, and until the satellite publication
gates close the catalog's package refs are not a supported acquisition
source for migrated scopes.
