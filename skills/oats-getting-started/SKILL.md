---
name: oats-getting-started
description: >-
  The way into OATS (Open Agent Team Specification) for a person who has only
  a coding agent. Asks about their project, installs OATS, OATS Desktop and
  (if wanted) the TUI, then either creates a new workspace with its own setup
  expert soul or joins this machine to an existing workspace. Ends by
  spawning the workspace's setup expert, which does the rest. Use for "get
  started with OATS", "set up / install / adopt OATS", "join our OATS
  workspace", or when someone gives you this file or its URL.
---

# Getting started with OATS

You are the person's own coding agent. This skill takes them from nothing to
a running **setup expert**: an OATS agent of their workspace that does the
rest of the setup with them (Git, their repositories, knowledge, messaging,
their first agents). You install, ask, write a few files and spawn it. Then
you are done.

OATS in one paragraph: a **workspace** is one Git repository declaring which
repositories belong to an organisation and which packages it trusts. A
**soul** is a durable agent role defined in Git; an **instance** is a soul at
work, in its own home and terminal. Each workspace has a setup expert soul,
`<workspace>-oats-setup-expert`, which holds the `oats.setup` capability.

**How to work.**
- Ask everything in one round (step 1), then run the steps yourself and read
  back what each did.
- The person types only what you must never hold: passwords, tokens and
  logins. Before the spawn there are two ways for that: a browser device flow
  you start (the GitHub login, step 3), and the exact command for their own
  terminal (a `sudo` or Homebrew password).
- Never ask for a secret in the conversation, never write one to a file, and
  never use Claude Code's `! <command>` for one: its command and output
  enter your context.
- Touch nothing you were not asked to. Don't edit an existing deployment's
  files (`oats-local.yaml`, `oats-lock.json`, `agents/`), and don't push to
  a repository the person did not create in step 5.

## 1. Ask, in one round

- **The use case:** what they want agents to do.
- **Their repositories and project:** which repositories agents should work
  in, where they are cloned on this machine, and which are private.
- **Their knowledge tools:** where their team's knowledge lives today (a docs
  repository, a wiki, Notion, Confluence, none).
- **A new workspace, or an existing one?**
  - Existing: its repository reference, for example
    `git:github.com/acme/acme-oats`. They get it from whoever runs that
    workspace.
  - New: the **workspace name**, lowercase letters, digits and `-` (for
    example `acme`). Also the GitHub **owner** of its repository (their user
    or an organisation they can create repositories in) and the repository's
    name. Suggest `<workspace>-oats`.
- **Messaging between agents (aweb):** wanted or not. The setup expert sets it
  up later.
- **The harness for the setup expert:** `claude`, `codex` or `pi`. Default:
  the one you are, if it is one of these.
- **The deployment directory:** where OATS lives on this machine. There is no
  required name; suggest the folder that already holds their clones.
- **OATS Desktop:** installed and started unless they decline. **The TUI**
  (`oats tui`, a terminal client, preview): ask.

## 2. Check, and install what is missing

```bash
uname -sm
node --version        # 22 or later
git --version         # 2.45 or later
tmux -V
gh --version
```

- **The harness** they chose must be installed and logged in (`claude
  --version`, `codex --version`, `pi --version`). They are already using one;
  the setup expert runs on the one they named.
- **macOS:** `brew install node git tmux gh` when Homebrew is there (`brew
  --version`). Without Homebrew, they install it in their own Terminal, since
  it asks for their password: from <https://brew.sh>, the command under
  “Install Homebrew”, then the “Next steps” lines it prints.
- **Linux:** the distribution's packages (`node` 22 from NodeSource or a
  version manager when the distribution's is older). A `sudo` line goes to
  their own terminal, unless `sudo -n true` succeeds.
- **Windows** is not supported.

## 3. Log in to GitHub

OATS reads the workspace and its repositories with Git, using the person's
GitHub access. Check first:

```bash
gh auth status
```

If it is not logged in, run the login yourself, in the background, without a
terminal. gh then prints a one-time code and a URL instead of opening a
browser, and waits:

```bash
out=$(mktemp)
gh auth login --web --hostname github.com --git-protocol https --skip-ssh-key </dev/null >"$out" 2>&1 &
sleep 3; cat "$out"
```

Give the person the code and the URL (`https://github.com/login/device`). The
code is not a secret: only their own signed-in browser can use it. They open
the URL, enter the code and approve. When the background command has exited,
check it and let Git use gh's login:

```bash
gh auth status
gh auth setup-git
```

Delete `$out`. The token stays in gh's store and never reaches you. SSH keys,
commit signing and the DCO sign-off come later, from the setup expert.

## 4. Install OATS Desktop, then the CLI, at the same version

The Desktop accepts a band of CLI versions around its own, so install it
first, then the CLI of the same version `V`:

```bash
V=$(npm view @awebai/oats version)
```

**macOS.** `ARCH` is `arm64` on Apple silicon, `x64` on Intel (`uname -m`
says `arm64` or `x86_64`).

```bash
tmp=$(mktemp -d) && cd "$tmp"
gh release download "v$V" -R awebai/oats -p "oats-desktop-$V-mac-$ARCH.zip" -p SHA256SUMS.txt
grep " oats-desktop-$V-mac-$ARCH.zip\$" SHA256SUMS.txt | shasum -a 256 -c -
gh attestation verify "oats-desktop-$V-mac-$ARCH.zip" --repo awebai/oats
ditto -x -k "oats-desktop-$V-mac-$ARCH.zip" .
codesign --verify --deep --strict "OATS Desktop.app"
```

- **Download with `gh`, never through a browser.** `gh` sets no quarantine
  on what it downloads, and that copy starts from Finder. A browser download
  would be quarantined.
- The app is ad-hoc signed and not notarized. `codesign --verify` passing is
  what to expect.
- **Install it.** If the Desktop is running, ask the person to quit it. Then
  replace `/Applications/OATS Desktop.app` with the new one and start it:

  ```bash
  rm -rf "/Applications/OATS Desktop.app" && ditto "OATS Desktop.app" "/Applications/OATS Desktop.app"
  xattr -p com.apple.quarantine "/Applications/OATS Desktop.app" 2>/dev/null && echo QUARANTINED
  open -a "OATS Desktop"
  ```

- If it prints `QUARANTINED`, tell the person. Remove the attribute only if
  they agree (`xattr -dr com.apple.quarantine "/Applications/OATS
  Desktop.app"`): never silently.

**Linux x64.** It needs glibc 2.34 or later. It installs per user, without
sudo, and shows in the app launcher:

```bash
tmp=$(mktemp -d) && cd "$tmp"
gh release download "v$V" -R awebai/oats -p "oats-desktop-$V-linux-x86_64.AppImage" -p SHA256SUMS.txt
grep " oats-desktop-$V-linux-x86_64.AppImage\$" SHA256SUMS.txt | sha256sum -c -
gh attestation verify "oats-desktop-$V-linux-x86_64.AppImage" --repo awebai/oats
mkdir -p ~/.local/opt/oats-desktop ~/.local/share/applications
install -m 755 "oats-desktop-$V-linux-x86_64.AppImage" ~/.local/opt/oats-desktop/OATS-Desktop.AppImage
```

Then write `~/.local/share/applications/oats-desktop.desktop`:

```text
[Desktop Entry]
Type=Application
Name=OATS Desktop
Exec=<home>/.local/opt/oats-desktop/OATS-Desktop.AppImage
Terminal=false
Categories=Development;
```

- Write `<home>` as their home directory's absolute path.
- **Without FUSE** (the AppImage fails with a FUSE message), add
  ` --appimage-extract-and-run` to `Exec=` and to the start command below.
- **Start it** with their own environment, detached:
  `setsid -f ~/.local/opt/oats-desktop/OATS-Desktop.AppImage >/dev/null 2>&1 </dev/null`.
  Without a display (an ssh session), don't start it; say where it is.
- Linux arm64 has no Desktop: say so and go on.
- Never start the Desktop with an emptied environment (`env -i`): it then
  loses HOME, and Git loses the person's login.

**Then the CLI:**

```bash
npm install -g "@awebai/oats@$V"
oats version
```

## 5. The workspace

**New workspace.** Create its repository, private, inside the deployment
directory `D`, then write four files in it. Private is the safe default: the
workspace file names every member, so whoever reads it sees the list.

```bash
mkdir -p "D" && cd "D"
gh repo create "<owner>/<repo>" --private --clone
cd "<repo>"
```

Then write the four files below. They show a workspace named `acme`, in the
repository `acme/acme-oats`, with Claude as the harness: write the person's
own workspace name, repository and harness in their place.

`oats-workspace.yaml`:

```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/acme-oats     # the host is a member too
packages:
  oats.framework: v1.12.3             # from the official catalog: package-catalog.json in "$(oats root)"
defaults:
  capabilities:
    oats.core: { from: package }
```

- Use the `oats.framework` version that the installed CLI's catalog names
  (`"$(oats root)/package-catalog.json"`, `packages."oats.framework".ref`,
  the part after `v`).
- Add nothing else: knowledge, messaging and teams come with the setup expert.

`oats-membership.yaml`:

```yaml
schemaVersion: 2
workspace: git:github.com/acme/acme-oats
```

`souls/acme-oats-setup-expert/soul.yaml`:

```yaml
schemaVersion: 2
name: acme-oats-setup-expert
description: The OATS setup expert for the acme workspace — onboards machines and people, and keeps this workspace's OATS setup working.
work: worktree      # it changes this repository by pull request, on its own branch
capabilities:
  oats.setup: { from: package }
launch: { harness: claude }     # the harness the person chose: claude, codex or pi
```

`souls/acme-oats-setup-expert/AGENTS.md`, and beside it the symlink
`CLAUDE.md -> AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`):

```markdown
# acme-oats-setup-expert

You are the OATS setup expert for the acme workspace. You set up and keep
working this workspace's OATS: its machines, members, souls, packages,
knowledge, messaging and automations. The `oats.setup` capability is your
toolkit: its briefing says what the person types and what you run, and its
skills hold every procedure. Start with `/oats-setup-model`; when your task
is a hand-over from the getting-started skill, follow `/oats-setup-expert`.
Change shared files only by pull request; the person reviews and merges them.
```

Keep the soul this thin. Everything it knows comes from `oats.setup`, so it
improves when the workspace's `oats.framework` pin moves.

Commit and push. This first commit goes straight to the new repository's
default branch: it is the person's own, just created. Every later change is a
pull request from the setup expert. If `git config user.email` prints
nothing, the person's Git identity is not set up yet. Commit with `-c
user.name="<their name>" -c user.email="<id>+<login>@users.noreply.github.com"`
(`gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`), after the
person confirms the name. The setup expert sets up their identity properly
later.

```bash
git add -A && git commit -m "OATS workspace acme: workspace, membership, setup expert"
git push -u origin HEAD
```

The workspace reference `W` is then `git:github.com/<owner>/<repo>`, here
`git:github.com/acme/acme-oats`.

**Existing workspace.** `W` is the reference they gave. Write nothing in its
repositories.

## 6. Onboard this machine

```bash
oats onboard D --workspace W
```

- **Effects:** it writes `D/oats-local.yaml` and `D/agents/`, reads every
  member over Git and locks the packages.
- **Members:** each must be `confirmed`. A row with `cannot-read` is a GitHub
  access problem (step 3), not a reason to edit anything.
- **`E_ALREADY_ONBOARDED`:** `D` already is a deployment. Stop and ask the
  person whether to use it as it is (`oats souls --dir D` then shows its
  souls) or choose another directory.

**Find the setup expert soul, `S`.**
- **From OATS 0.61.0,** the next step `oats onboard` prints names the soul
  that holds `oats.setup`, the workspace's setup expert (`--json`:
  `next.spawn`).
- **Before 0.61.0,** read `oats souls --dir D --json`: the soul named
  `<workspace>-oats-setup-expert`, else one whose definition declares
  `oats.setup`.
- **An existing workspace with no such soul:** stop. Show the person the soul
  files from step 5 and say that the workspace's owner adds them by pull
  request to its host repository. Then come back to step 7.

A soul with `work: worktree` needs a clone of its repository at
`D/<repo name>`. A new workspace already has it (step 5). For an existing
one, clone the host there if `oats onboard` listed it as missing.

## 7. Hand over to the setup expert

Write the hand-over to a file outside every repository, for example
`"$(mktemp -d)/handover.md"`. It holds no secret.

```markdown
# Onboarding hand-over from the getting-started skill

- Workspace: <workspace> (W), new | existing; deployment directory: D
- Setup expert: S, harness <harness>

## The person's answers
<step 1's answers, in their words: use case, repositories and where they
are cloned, knowledge tools, messaging wanted or not>

## Done by the getting-started skill
- Installed: OATS <V> (oats version), OATS Desktop <V> | not installed (why)
- GitHub: gh logged in over https as <login>; no SSH key or signing set up
- New workspace only: repository <owner>/<repo> created, first commit pushed

## Left to you
Everything else, starting with /oats-setup-expert.
```

**Claude and Codex only:** trust the deployment directory first, so the
first start does not stop at the harness's folder-trust question (pi needs
nothing). Use `codex` for Codex:

```bash
oats harness trust --dir D --harness claude --plan
oats harness trust --dir D --harness claude
```

Then preview the spawn, read it, and spawn:

```bash
oats spawn S --dir D --task-file <handover file> --preview
oats spawn S --dir D --task-file <handover file>
```

- **The preview** lists the modules (`oats.core`, `oats.setup`) and the
  harness. Read it.
- **The spawn** prints the instance's home `H`.
- **`E_SPAWN_INCOMPLETE`:** don't spawn again. Run `oats session inspect
  --home H --json` and tell the person what it shows.

## 8. The TUI, if wanted, and the hand-over

**The TUI**, if they wanted it, runs in a terminal of its own:
- **macOS:** open a Terminal window with
  `osascript -e 'tell application "Terminal" to do script "oats tui --dir D"'`.
- **Linux:** `x-terminal-emulator -e oats tui --dir D` when that exists;
  otherwise give them the command.

**Tell the person how to reach the setup expert**, and that it continues
from here:
- the Desktop, where `D` is listed;
- `oats tui --dir D`;
- `oats session attach --home H` in a terminal.

It will ask them only what the hand-over leaves open, and it opens a pane in
its own window when they need to type a secret. You are done.

## Never

- **Ask for, read, print or store a secret,** or use `!` for one. If the
  person pastes one into the conversation anyway, don't repeat it, and tell
  them to rotate it.
- **Overwrite or re-onboard** a deployment, or push to a repository the
  person did not create in step 5.
- **Download the Desktop through a browser,** strip quarantine without
  asking, or start it with `env -i`.
- **Put** an absolute path, an account or a credential in
  `oats-workspace.yaml`, `oats-membership.yaml` or a soul.
- **Spawn** before `oats onboard` reported every member confirmed.
