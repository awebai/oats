# Run your first OATS team

> **Workspace model (0.25).** This page is the v2 first-team guide. The 0.24
> surface it used to describe (`oats-config.yaml`, `oats init` / `install` /
> `use` / `trust`, the 0.24 `oats onboard --dir` bootstrap that created a local
> `oats-setup-expert`) no longer exists; those verbs answer `E_UNKNOWN_COMMAND`
> naming their replacement. Model: [workspaces.md](workspaces.md) ·
> packages: [packages.md](packages.md) · moving a 0.24 deployment:
> [rebuild-to-v2.md](rebuild-to-v2.md) (§5 is the deployment layout this page
> creates). The [qualification example](first-team-demo.md) records real v1
> tasks on 0.23 and is not v2 acceptance.

Start with one workspace, one member repository and one small, real task. A
soul keeps the role and its curated skills; an instance gets a working session
and a repository view; every capability the instance runs is copied whole into
its home at spawn from a **member** repository (latest state, trusted by
membership) or from a **package** (a pinned version, executables approved once
per version in the lock). Nothing is installed.

## 0. Prerequisites

Node.js 22+, Git with read access to the repositories below (your own
credential helpers; the kernel never prompts), tmux, and an authenticated
harness (Pi, Claude or Codex).

```bash
npm install -g @awebai/oats@latest
node --version && tmux -V && oats version --json   # features must list workspace-v2
```

## 1. Declare the workspace (shared, in Git)

Three files, all committed ([rebuild-to-v2.md](rebuild-to-v2.md) §§2–4 show
each field):

- `oats-workspace.yaml` (`schemaVersion: 2`) in **one** host repository: `name`,
  `members: [<repo ref>, …]`, `teams:`, `packages: { oats.framework: v<x>, … }`,
  `defaults:`. A member is a repo ref, never a revision.
- `oats-membership.yaml` (`{ schemaVersion: 2, workspace: <host ref>, team? }`)
  in **every** member — the backlink half of the handshake. A repo listed
  without a backlink is `no-backlink` and contributes nothing.
- `souls/<name>/soul.yaml` (`schemaVersion: 2`) in the member that owns the
  soul: `name`, `description`, `work: worktree|checkout|directory|workspace`,
  and `capabilities: { <cap>: { from: here | <repo key> | package } | off }`.
  A capability is a directory `capabilities/<cap>/oats.json` in a member.

The smallest real setup is one repository that is host **and** member: it
carries the workspace file, its own `oats-membership.yaml` pointing at itself,
one soul and, optionally, one capability. Every soul gets `oats.core` from the
`oats.framework` package by default.

## 2. Realize it on this machine — `oats onboard`

`oats onboard` is the bootstrap: it writes a minimal `oats-local.yaml`, creates
`agents/` and runs the first `sync` ([rebuild-to-v2.md](rebuild-to-v2.md) §5 is
the resulting layout).

```bash
oats onboard ~/acme --workspace git:github.com/acme/agents     # any directory — an existing one with your clones is fine
```

```
~/acme/                           # the directory you chose; these three entries are what the kernel needs
├── oats-local.yaml               # { schemaVersion: 2, workspace: git:github.com/acme/agents }
├── oats-lock.json                # lockfileVersion 3: commit + integrity + approval per package
├── agents/                       # instance homes
└── <member>/                     # clones of the members you work IN — here or anywhere named in oats-local.yaml clones:
```

Read the report it prints: every member row must be `✓↔` (confirmed) — fix
`no-backlink` / `backlink-elsewhere` / `cannot-read` before going on. If it
exits `2`, a package needs executable approval: run `oats sync` in a terminal
and answer `approve <id> <version>? [y/N]`. Approval is per package version,
once, recorded in the lock; member capabilities need none. Then clone the
member you will work in beside `oats-local.yaml` (only a soul's work target
needs a clone — discovery and resolution run over the remotes).

`--json` returns `onboardApi: 2` (`local`, `dir`, `agents`, `lock`, the full
`sync` report, `hosting`, `next.clone[]`, `next.spawn`); running it twice is
`E_ALREADY_ONBOARDED` (use `oats sync`); a mistyped ref is `E_REPO_REF`, an
unreadable one `E_REMOTE_UNREADABLE` with `details.rolledBack: true` — nothing
half-written is left behind. Exact shapes:
[desktop-cli-api.md](desktop-cli-api.md#oats-onboard-onboardapi-2).

Host-owned provider values (absolute paths, state roots) go under `settings:` in
`oats-local.yaml` afterwards — never in the workspace file, whose schema refuses
them. Do not commit `oats-local.yaml`.

## 3. Look before you spawn

```bash
oats souls                    # every non-private soul of every confirmed member, with origin and team
oats capabilities             # member (origin: member <key> @ <commit>) and package (package <id> v<ver>) capabilities
oats workspace status         # membership table, packages, approval state
oats spawn backend-expert --preview   # modules[] with from/commit/changedSince, composed skill names, team
```

The preview is where a skill-name clash between two composed capabilities
(`E_SKILL_DUPLICATE`) or an unapproved package (`E_PACKAGE_UNAPPROVED`) shows
up, before anything is created.

## 4. Give an instance a real task

```bash
oats spawn backend-expert --purpose first-fix --task "Fix one small issue, run the relevant checks, commit the code change, and report what changed."
oats status
```

`--runtime pi|claude|codex` picks the harness; complete any native folder
trust or authentication prompt in the printed session. The instance home is
`agents/<soul>/instances/<instance>/`; `work/` is its repository view;
`.oats/modules/<cap>/` and `.agents/skills/<cap>/` are the copied capabilities;
`instance.json` records `modules` (from, commit, digest), `providers` and
`workspace`. A running instance never changes under itself — a member that
moves affects only new spawns, and `oats status` shows the drift
(`member moved since (now @ …)` / `capability no longer present`).

Instance-specific provider values belong to the spawn:
`oats spawn <soul> --provider <cap> key=value` (repeatable; dotted keys nest),
recorded under `instance.json.providers.<cap>`.

## 5. Judge and retire

Review the instance's code through the repository's ordinary PR workflow. Then:

```bash
oats retire backend-expert-first-fix
oats status
```

Read the retirement result rather than assuming local cleanup proves release;
knowledge and messaging capabilities (packages such as `oats.okf`, `oats.aweb`)
add their own retire hooks and receipts — see [knowledge.md](knowledge.md) and
[capabilities.md](capabilities.md) once you add them to `packages:` and to the
soul's `capabilities:`.

## The standalone case

If you can read a member repository but not its workspace host (a public member
of a privately hosted workspace — decision 26), point `oats-local.yaml` at the
member: `oats sync` and `oats spawn` then give the **standalone view** — the
repo's own souls with their `from: here` capabilities plus `oats.core`, marked
`standalone: true` in `sync --json` and `instance.json.workspace.standalone`.
A repository with no `oats-membership.yaml` is not a member and gets no such
view (`E_WORKSPACE_SCHEMA`); a network failure reading the host is
`E_REMOTE_UNREADABLE`, never a silent standalone.
