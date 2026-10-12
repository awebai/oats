# Upgrading OATS on a host

Upgrading OATS means three things, in this order, on each host:

1. **The CLI** (`@awebai/oats`, the kernel).
2. **The pi bridge** (`@awebai/oats-pi`), in every pi folder the host's
   deployments launch pi with: `oats update`, in each deployment.
3. **A check of each deployment**: `oats doctor`.

The kernel and the bridge are published together, from one version tag, and
must be at the same version: a pi session with an older bridge runs old
extension code against a new kernel. A host that launches no pi instance has
no bridge, and step 2 has nothing to move.

**A release's own steps are in its notes.** Read the `## Upgrade` section of
every version between yours and the new one in the
[release notes](release-notes/) first: it says what to do before the CLI
changes, and what else must change with it (the Desktop, another tool, a
package pin). This page is the part that is the same for every release.

**Package versions are a different thing.** `oats update` moves the CLI and
the bridge, never a package. A deployment's capabilities come from the
packages pinned in `oats-workspace.yaml`; change a pin, then run `oats sync`
([Packages](packages.md)).

## The steps

```sh
npm install -g @awebai/oats   # 1. the CLI
oats update                   # 2. in a deployment: the plan, then it asks before it runs
oats doctor                   # 3. in the same deployment
```

Run steps 2 and 3 in every deployment on the host, or name one from anywhere
with `oats update --dir <deployment>`. Then restart the pi sessions that were
running: a session keeps the bridge it loaded when it started.

In a terminal, `oats update` shows its plan and asks before it runs anything.
Without a terminal (a script, an agent's shell) it runs only with `--yes`.
`oats update --check` shows the plan and runs nothing.

`oats update` also does step 1: when npm lists a newer `@awebai/oats`, its
plan starts with that install, and the bridges move to that same version in
the same run.

## Which pi folders

pi keeps its packages in one folder: `~/.pi/agent`, or the folder
`PI_CODING_AGENT_DIR` names. A deployment can launch pi with several folders,
so `oats update` and `oats doctor` look at each of these:

- **the default**, `~/.pi/agent`;
- **this shell's**, when `PI_CODING_AGENT_DIR` is set where the command runs;
- **each launch configuration's**: the `PI_CODING_AGENT_DIR` in the `env` of
  every `launch-configs` entry of the deployment's `oats-local.yaml` whose
  harness is `pi` ([Configuration](configuration.md#launch-configurations)).
  The value is a path, or a `{fromEnv: NAME}` reference read from the
  environment the command runs in. A leading `~` is your home.

Two names for one folder (two configurations, a configuration that names the
default, a symbolic link) are one folder, listed once with every reason it is
looked at.

The bridge of a folder is read from
`<folder>/npm/node_modules/@awebai/oats-pi/package.json`, where pi installs
it.

**The deployment** is the one at or above the directory the command runs in,
or the one `--dir` names. With no deployment there, `oats update` still moves
the default folder and this shell's, and says, in the plan and again as its
last line, that no launch configuration was looked at. It says the same about
a deployment whose `oats-local.yaml` it cannot load; `oats doctor` reports
what is wrong with that file. An explicit `--dir` with no deployment at or
above it is refused.

**Folders that are not looked at.** Only the deployment's current
`launch-configs` are read. An instance home records the launch it was created
with, and keeps it when the configuration is later changed or removed; a
folder named only by such a record is not in the list. Move its bridge with
the command under [By hand](#by-hand).

## What `oats update` does in each folder

The plan lists every folder with the bridge found in it and one of these:

| The plan says | When | What happens |
|---|---|---|
| `move to <version>` | the bridge is at another version | `pi install` runs there |
| `left alone` | the bridge is already at that version | nothing |
| `no bridge` | the folder does not exist, or holds no bridge | nothing |
| `not touched`, with a reason | see below | nothing; the plan prints the command to run there |

`oats update` moves a bridge. It never creates a folder and never installs a
first bridge: a spawn's own package check says when a capability needs one
that is missing.

A folder is **not touched** when:

- **it does not resolve**: a `{fromEnv: NAME}` whose variable is not set where
  the command runs, or a path that is not absolute. Run `oats update` again
  where the variable is set, or the printed command.
- **its bridge cannot be read** (a `package.json` that does not parse).
- **only launch configurations with their own `executable` name it.** A
  wrapper is your program: `oats update` never runs one. The plan prints the
  install command with that executable. A folder that the default, this
  shell or a configuration without an `executable` also names is moved with
  the plain `pi`.

For a folder it moves, `oats update` runs the `pi` found on `PATH`, with
`PI_CODING_AGENT_DIR` set to that folder:

```sh
PI_CODING_AGENT_DIR=<folder> npm_config_prefer_online=true pi install npm:@awebai/oats-pi@<version>
```

For the default folder the variable is left out, unless this shell sets one.

## Nothing is removed before its replacement is known to install

The move is one `pi install` over the installed bridge. pi replaces the
settings entry and the files of a package it already holds, and an install
that fails leaves the old ones in place. There is no `pi uninstall`.

Before any step runs, the CLI's own install included, `oats update` asks the
registry for the bridge's exact version, with npm told to revalidate its
cache (`npm view @awebai/oats-pi@<version> version --prefer-online`). A new
version is listed a few minutes after it is published, and the kernel's
listing says nothing about the bridge's. If the version does not resolve,
the update stops with nothing changed and every bridge in place: run it again
in a few minutes. The same setting goes to pi's own npm for the install
(`npm_config_prefer_online=true`). `--check` does not make this lookup: it
shows what would run, and the run looks again.

The update stops at the first step that fails. Its message names the folder
and the exact step to run again, says what that folder holds now (the old
bridge still, or no bridge), and lists the folders it did not reach. A step
that ends without an error but leaves another version in the folder is a
failure too. Run the printed step, then `oats update` again: folders already
at the version are left alone.

## What `oats doctor` reports

`oats doctor` prints one warning per folder whose bridge is not the kernel's
version, naming the folder and why it is looked at:

```text
WARNING: version skew — kernel 0.53.0, pi bridge 0.52.0 in /srv/pi-work (launch configuration work); run `oats update` (they publish in lockstep)
```

It also warns about a folder it could not look at (one that does not
resolve, or a bridge that cannot be read). A folder that does not exist or
holds no bridge is not a skew, and it says nothing about it. The warnings are
in the text output only; `oats doctor --json` does not carry them.

## After a change of Node version

Two paths are written into things that outlive a command: the kernel's, and
the `node` that runs it. A new Node version can leave either behind.

**The kernel's path.** The CLI is an npm global package: it is installed
under npm's global prefix (`npm prefix -g`).

- **The prefix is outside the Node install.** The kernel's path does not
  change with the Node version: the CLI needs no reinstall.
- **The prefix is the Node version's own directory**, the usual layout of a
  version manager (mise, nvm, asdf, fnm). Every Node version then has its own
  global packages: a new version has no `oats`, and removing the old version
  removes the kernel with it. Three things name that kernel by its path: each
  instance home's own `oats` (`<home>/.oats/bin/oats`), the Claude Code hooks
  of a Claude instance, and the host timer's unit. OATS cannot make a path
  inside a Node version outlast that version.

Both layouts can exist on one host: check the prefix in the shell that
installs the CLI.

**The `node`'s path**, whatever the prefix. The Claude Code hooks of a
Claude instance and the host timer's unit also record the `node` that runs
them, by one rule
([the node a hook writes down](capabilities.md#the-node-a-hook-writes-down)):

- **On Homebrew**, the `opt` link (`<prefix>/opt/node/bin/node`), which
  `brew upgrade node` repoints. The recorded path outlasts the upgrade: the
  hooks and the timer need nothing done.
- **Otherwise**, a `node` on `PATH` that is the same file as the one running
  the kernel. With mise that is the version's own install, which does not
  outlast the version (other version managers were not measured).

Once the recorded `node` no longer exists (an old version removed under a
version manager, for example), the hooks fail without a message, so the
instance stops reporting that it waits on you, and
`oats schedule host status` reports `node-missing`.

**A home spawned with an oats.core that does not read `OATS_NODE_BIN`** does
not follow the rule. Its hooks record the path of the `node` its hook ran
under, which on Homebrew is the versioned keg
(`…/Cellar/node/<version>/bin/node`), and a start writes that again, because
a start runs the copy of oats.core in the home. `brew upgrade node` removes
the keg at once, so such a home needs the restart of step 2 after every Node
upgrade, until it is respawned.

So after moving to another Node version, and before removing the old one,
wherever a recorded path does not outlast it:

1. Where the prefix is the version's own directory, install the CLI in the
   new version: `npm install -g @awebai/oats`.
2. Restart the instances, from a shell on the new version
   (`oats session restart --home <home>`). A start writes the home's `oats`
   and its Claude Code hooks again
   ([Configuration](configuration.md#launch-configurations)).
3. On a host that runs schedules, run `oats schedule host install` again,
   from your own shell, not from an instance home. Without it,
   `oats schedule host status` reports `oats-bin-missing` or `node-missing`
   once the old version is removed
   ([Schedules](schedules.md#the-host-timers-unit)).

Until the old version is removed, the instances and the timer keep running
what it holds.

## By hand

In any pi folder, with the `pi` that is launched with it:

```sh
PI_CODING_AGENT_DIR=<folder> pi install npm:@awebai/oats-pi@<the CLI's version>
```

`oats version` prints the CLI's version. For the default folder, leave the
assignment out only when your shell does not set `PI_CODING_AGENT_DIR`;
when it does, name the folder: `PI_CODING_AGENT_DIR="$HOME/.pi/agent"`.
