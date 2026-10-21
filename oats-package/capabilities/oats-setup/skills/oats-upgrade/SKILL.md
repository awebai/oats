---
name: oats-upgrade
description: >-
  Use when someone asks to upgrade OATS, update to the latest version, or
  move a host to a newer OATS release: the Desktop, the CLI (the kernel), the
  pi bridge and each deployment's check. Reads `docs/upgrading.md` and the
  release notes' Upgrade sections at the latest release's tag, never the copy
  in the installed CLI, then walks the person through each step on their
  approval. Package pins are `/oats-package-pins`. Part of the setup and
  config of an OATS workspace (oats.setup); day-to-day operation inside an
  instance is oats.core.
---

# Upgrading OATS to the latest version

**What to do comes from the latest release, read at its tag.** The page
`docs/upgrading.md` opens with "Upgrading to the latest version": the latest
version, the CLIs its Desktop accepts, and the steps. Each release's own
steps are in the `## Upgrade` section of its notes,
`docs/release-notes/v<version>.md`. Read both at the tag `v<latest>` of
`awebai/oats`:

- **Not the installed copy** (`"$(oats root)/docs/"`): it belongs to the
  version you are upgrading from and cannot describe a newer one.
- **Not memory, and never a step of your own.** Every step you propose
  comes from the page or from a release's notes, and you say which.
- **Not a downgrade.** Going back to an older version is not this skill:
  the notes of the release you leave say how, when they do.

The person approves each step: show the whole plan first, then run each
step on its own yes.

## 1. The installed version and the latest

```sh
oats version --json               # "version": the installed CLI
npm view @awebai/oats version     # the latest release
npm view @awebai/oats versions --json
```

The releases to read are every version in that list above the installed one,
up to the latest, without prereleases (a version with `-`, like
`0.53.0-rc.1`). Ask the person, with any other question you have, whether the
Desktop is installed on this host. When the installed CLI is already the
latest, there is no release to read: run step 3 below and report.

A CLI ahead of the latest (a checkout, an unpublished build) is not
upgraded: say so and stop.

## 2. Read the page and the notes at the latest tag

The repository is public, so a plain HTTPS read needs no login:

```sh
V=0.67.0                          # the latest, from npm view
curl -fsSL "https://raw.githubusercontent.com/awebai/oats/v$V/docs/upgrading.md"
curl -fsSL "https://raw.githubusercontent.com/awebai/oats/v$V/docs/release-notes/v0.66.0.md"
```

`gh api "repos/awebai/oats/contents/docs/upgrading.md?ref=v$V" -H "Accept: application/vnd.github.raw"`
reads the same file where `gh` is signed in. Read every notes file from the
tag `v$V`, the latest: that tag holds the notes of every earlier release too.

**From the page**, take "Upgrading to the latest version": the version it
names, the CLIs its Desktop accepts, and its steps. **From each release's
notes**, oldest first, take the `## Upgrade` section. Notes before 0.38.0 may
call it `## Upgrading` or `## Upgrading from <version>`. A release with no
such section asks for nothing more.

**A tag up to v0.67.0** has a page without "Upgrading to the latest
version". Take the order from its "The steps" section, and the version and
the CLIs its Desktop accepts from the latest release's own Upgrade section,
which gives them.

**Stop and say so** when the page names a version other than the latest npm
lists, or when a notes file of a release in your list cannot be read. Name
what you could not read; never fill the gap from the installed copy.

## 3. The plan

Write one plan, in this order, each step with the release or the page that
asks for it:

1. **Before the CLI:** what an Upgrade section says to do with the old CLI
   still installed. Those steps run with the installed CLI, so they may use
   only commands it has.
2. **The Desktop**, where it is installed: the latest version's, from the
   assets of the GitHub Release `v$V`
   (`https://github.com/awebai/oats/releases/tag/v$V`). The person installs
   it; you give the link and the CLIs it accepts. It goes before the CLI
   because the older Desktop refuses the new CLI.
3. **The CLI and the pi bridges:** `oats update` in each deployment on the
   host. Its plan installs the CLI when npm lists a newer one and moves every
   pi folder's bridge to that version.
4. **The check:** `oats doctor` in each deployment.
5. **After the CLI:** the rest of the Upgrade sections, in their releases'
   order. Steps that several releases ask for (a rerun of `oats setup`, a
   restart) are done once, with the new CLI, unless a release's notes say
   otherwise.
6. **Restarts:** the pi sessions that were running, and any instance an
   Upgrade section names.

A package version the notes mention (the official catalog's pins) is not
part of the upgrade: `oats update` moves no package. If the person wants it,
it is `/oats-package-pins`, after the plan, with its own trust step.

## 4. Walking the person through it

For each step: say what it does and which release asks for it, wait for the
person's yes, run it or hand it over, then read back what it did.

**The deployments on the host** are listed by `oats deployments` (from OATS
0.65.0); on an older CLI, ask the person. Run step 3 and 4 in each, from
inside it or with `--dir` (`oats update --dir`, from OATS 0.53.0):

```sh
oats update --check --dir <deployment>   # the plan; runs nothing
oats update --yes --dir <deployment>     # on the person's yes: your shell has no terminal
oats doctor <deployment>
```

The first `oats update` that installs the CLI installs it for every
deployment; the next ones only move bridges. Before it runs, check that
`oats root` is `"$(npm prefix -g)/lib/node_modules/@awebai/oats"` in your
shell: the kernel in use is then the one npm installs over. With a Node
version manager they can differ, and the install would land in another
Node's folder: hand the person `npm install -g @awebai/oats@<version>` to
run from their own shell instead, then run `oats update` for the bridges.

**What the person runs themselves:** the Desktop install, and every step an
Upgrade section says to run from the user's own shell or login session (the
record `oats setup`, the host wake broker, the host timer). Give the exact
command and say why it is theirs; check its result with a read-only command.

**A step that fails:** `oats update` stops at the first failed step and
prints the step to run again and what each folder holds. Read it, tell the
person, and rerun only that step on their yes. Never edit `oats-lock.json`
or `instance.json`, and never work around a refusal.

**A step that looks wrong or unclear** in the notes: say so, and ask the
person or report it on the release's issue. Do not rewrite it into a step
you think works.

## 5. Done

The upgrade is done when:

- `oats version --json` reports the latest version;
- each deployment's `oats doctor` shows no version-skew warning, and you
  read its other warnings to the person;
- where the Desktop is installed, it is the latest version and lists the
  deployment's instances;
- every step of the plan is done, or the person declined it.

Report what ran, what the person ran, what was declined and what remains,
with the releases that asked for each. Instances already running keep what
they were spawned with; a new spawn gets what the deployment now resolves.
