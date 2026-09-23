# Conventions — canonical files and generated views

OATS uses one canonical source for durable soul content and generated,
instance-local views for deployment composition.

## Operating documents

```text
soul/AGENTS.md                  # canonical role instructions
soul/CLAUDE.md -> AGENTS.md
instance/AGENTS.md              # generated regular file
instance/CLAUDE.md -> AGENTS.md
```

Never maintain an independent soul `CLAUDE.md`. Config-dependent capability,
work-mode, and workspace instructions belong only in generated instance
`AGENTS.md`; they must not be reconciled into the committed soul.

Generated blocks use `<!-- oats:<source> src=<file> -->` markers for
provenance. Edit the canonical soul, source file, or target binding, then spawn
a new instance. `oats doctor --soul <name>` previews the same final composition.

## Skills

The only OATS-managed runtime skill root is the instance:

```text
instance/.agents/skills/                    # canonical exact set
instance/.claude/skills -> ../.agents/skills
```

Spawn copies kernel + soul-private + active capability skills into real
instance-local directories there. Directory symlinks are not used because
harness recursive discovery may not descend through them. Under the workspace
model (0.25) every capability is copied whole into
`instance/.oats/modules/<capability>/` and its skills into
`instance/.agents/skills/<capability>/<skill>/`; nothing is installed at a
config level. Config-level `.agents/skills` is not an OATS capability source
or an ambient runtime discovery root.

Harnesses start normally (workspace-model decision 13, and the behaviour of
every launch a 0.25 kernel performs, classic homes included): Pi starts with
cwd = the instance home, the composed `AGENTS.md` appended to its system
prompt, and its own skill, context and extension discovery intact — the
instance's copied skills are found because they sit under cwd; machine-level
and repo-level skills resolve exactly as without OATS. *(0.24 kernels started
Pi with ambient skill and context discovery disabled and the one instance path
explicit; that exclusion is gone.)* Claude runs provider-native: it reads the
instance's `.claude/skills` and `CLAUDE.md` symlinks, and the operator's own
user and project configuration — skills, plugins, settings — stays in effect.
Neither runtime gets a redirected config home.
`composition.materialized.runtimePosture` in `instance.json` records what each
instance actually exposes. `oats-getting-started` is the sole pre-workspace
ambient bootstrap.

Duplicate skill directory names within the OATS-composed set are errors
(`E_SKILL_DUPLICATE`, naming both capabilities) unless the classic config's
`skill-overrides` selects a source; between a composed skill and an ambient
repo/machine skill the harness's own precedence decides (decision 16).

## Package locations

**Workspace model (0.25, current):** nothing is installed. A capability lives
where its owner keeps it and is copied whole into each instance at spawn:

```text
<member repo>/capabilities/<name>/oats.json           # member-tier capability, latest state (membership is the trust)
<package repo>/oats-package/oats-package.json         # package-tier: versioned via oats-workspace.yaml packages:
<deployment>/oats-lock.json                           # lockfileVersion 3: package commit, integrity, per-version approval
<instance>/.oats/modules/<capability>/                # the copy this instance runs
```

**Classic 0.24 layout** (still launched by the 0.24 kernel; a 0.25 kernel
reads none of it as configuration — see [rebuild-to-v2.md](rebuild-to-v2.md)):

```text
<package>/capabilities/<name>/oats.json                 # the official marketplace (install source, not ambient)
<level>/.agents/capabilities/installed/<name>/oats.json # acquired (gitignored, restorable)
<level>/.agents/capabilities/owned/<name>/oats.json     # authored at this scope (source; committed where the scope is a repo)
<level>/oats-lock.json                                  # lockfileVersion 2: external source/integrity/trust
```

## Quick map

| Thing | Canonical location (0.25 workspace model) | 0.24 classic |
|---|---|---|
| Shared declaration | `oats-workspace.yaml` in the host repo; `oats-membership.yaml` in every member | `oats-config.yaml` chain, `oats.yaml` |
| Per-machine config | `<deployment>/oats-local.yaml` (uncommitted) | `oats-config.yaml` `settings:` |
| Acquisition lock | `<deployment>/oats-lock.json` (v3) | `<level>/oats-lock.json` (v2) |
| Soul source | `<member repo>/souls/<name>/` | `agents/<name>/soul/` |
| Soul operating doc | `souls/<name>/AGENTS.md` | `soul/AGENTS.md` |
| Soul Claude view | `souls/<name>/CLAUDE.md -> AGENTS.md` | `soul/CLAUDE.md -> AGENTS.md` |
| Soul-private skills | `souls/<name>/skills/` | `soul/skills/` |
| Instance operating doc | `instance/AGENTS.md` (generated) | same |
| Instance skill set | `instance/.agents/skills/` | same |
| Instance modules | `instance/.oats/modules/<capability>/` | `.agents/capabilities/installed/` (shared) |
| Instance metadata | `instance/instance.json` (`modules{}`, `providers{}`, `workspace{}`) | `instance/instance.json` |

Symlinks prevent compatibility paths from drifting. Generated regular files
separate canonical portable identity from scope-dependent runtime policy.
