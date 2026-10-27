---
name: oats-getting-started
description: >-
  The way into OATS (Open Agent Team Specification) for a person who has only
  a coding agent. Asks about their project, installs OATS and OATS Desktop,
  then either creates a new workspace with its own setup expert soul or joins
  this machine to an existing workspace, and ends by spawning the workspace's
  setup expert, which does the rest. Offers the TUI. Use for "get started
  with OATS", "set up / install / adopt OATS", "join our OATS workspace", or
  when someone gives you this file or its URL.
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

**A machine found-list.** Your prompt may hand you a found-list, a JSON file
whose `machine.platform` is set (oats-omarchy's installer writes one). Then
the workspace you make is this machine's own workspace. Its setup soul is
the machine's steward, `oats.machine/steward`, in place of a setup expert
soul of its own, and the steward gets a global aweb address. Steps 1, 5, 6
and 7 say what changes. When the found-list lists a deployment whose
`steward` is `true`, this machine already has its workspace and steward:
tell the person so, and stop. Wherever a later step says to ask the
person, on a machine found-list you tell them what happened, as it is, and
stop instead: the person answers nothing after step 1.

**How to work.**
- **Ask first, then run.** Ask everything in one round (step 1), then run the
  steps yourself and read back what each did.
- **Secrets.** The person types only what you must never hold: passwords,
  tokens and logins. Before the spawn there are two ways for that: a browser
  device flow you start (the GitHub login, step 3), and the exact command in
  their own terminal (a `sudo` or Homebrew password, an aweb invite token),
  which you open for them (below).
  - Never ask for a secret in the conversation, and never write one to a file.
  - Never suggest Claude Code's `! <command>` for one: its command and output
    enter your context.
- **Your shell may keep nothing between commands.** Many harnesses start each
  command in a new shell, in the same starting folder.
  - Run each fenced block below as one command.
  - When a later block needs a value an earlier one found (`V`, `ARCH`, a
    path), write that value in literally.
- **Sandboxes.** If your harness sandboxes commands, these steps need network
  access and writes in the home folder: ask the person to approve them.
  Starting the Desktop and opening a terminal also run outside the sandbox.
- **Their own terminal, opened by you.** When a command must run in the
  person's terminal, write it to a file (`mktemp`; it holds no secret) after
  a first line `export PATH="<node dir>:<oats dir>:<harness dir>:$HOME/.local/bin:$PATH"`,
  with the folders `command -v node`, `command -v oats` and `command -v
  <harness>` print written in (a window may load no shell startup file, so a
  version manager's node would be missing), and a last line
  `printf '\nDone: close this window.\n'; read -r _`. Then open a window
  that runs it, with `F` the file's path written in:
  - **macOS:** `osascript -e 'tell application "Terminal" to do script "sh F"'`.
    The first time, macOS may ask the person to let you control Terminal.
  - **Linux:** `systemd-run --user --collect --quiet -p KillMode=process -E DISPLAY -E WAYLAND_DISPLAY -E XAUTHORITY xdg-terminal-exec sh "F"`,
    or `x-terminal-emulator -e sh "F"` in place of `xdg-terminal-exec` where
    only that exists. Through `systemd-run` the window gets their desktop
    session's environment, not yours.

  Tell them what to type there, and ask whether the window opened: a
  command that started is no proof of a window. Check the result with a
  read-only command, never by reading the window, then delete the file.
  Only when no window opens do you give them the command to run themselves.
- **Touch nothing you were not asked to.** Don't edit an existing
  deployment's files (`oats-local.yaml`, `oats-lock.json`, `agents/`), and
  don't push to a repository the person did not create in step 5.

## 1. Ask, in one round

On a machine found-list, ask the machine's round below instead of this list.

- **The use case:** what they want agents to do.
- **Their repositories and project:** which repositories agents should work
  in, where they are cloned on this machine, and which are private.
- **Their knowledge tools:** where their team's knowledge lives today (a docs
  repository, a wiki, Notion, Confluence, none).
- **A new workspace, or an existing one?**
  - Existing: its repository reference, for example
    `git:github.com/acme/acme-oats`. They get it from whoever runs that
    workspace.
  - New: the **workspace name**: lowercase letters and digits, words joined
    by single `-` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), for example `acme`. Also
    the GitHub **owner** of its repository (their user, or an organisation
    they can create repositories in) and the repository's name. Suggest
    `<workspace>-oats`. Refuse `agents`: OATS keeps instance homes in a
    folder of that name.
- **Messaging between agents (aweb):** wanted or not (recommended: agents
  that can mail each other can coordinate).
  - New workspace: a **username** `N` for a new hosted aweb account
    (lowercase letters, digits and `-`), not a secret. Step 7 signs it up
    with no API key, and its team is `default:N.aweb.ai`. Also a name `A`
    for this machine's messaging root, such as `<workspace>-root`.
  - Existing workspace that already has it: this machine needs it before the
    setup expert can spawn (step 7).
- **The harness for the setup expert:** `claude`, `codex` or `pi`. Default:
  the one you are, if it is one of these.
- **The deployment directory `D`:** where OATS lives on this machine. Any
  folder but their home folder itself works: ask for it, and suggest none.
  From OATS 0.65.0, `oats onboard` adds `D` to this computer's list of
  deployments (`~/.oats/config/deployments.json`, which `oats deployments`
  reads), so the Desktop and the TUI find it wherever it is. Write `D` everywhere
  below as an absolute path, with the home folder spelled out: never `~`,
  which the shell does not expand inside quotes.
- **OATS Desktop:** installed and started unless they decline. **The TUI**
  (`oats tui`, a terminal client, preview): opened for them or not.

**The machine's round.** Read the found-list, then ask only these choices,
together, each with its default and one line on what it is. Enter, or
"yes", accepts every default. Nothing is asked after this round, and never
a key. The use case, repositories and knowledge tools are not asked: the
steward takes them up with the person later.
- **The workspace:** a new one, the machine's own. Its name defaults to the
  hostname, lowercased, with every character outside `[a-z0-9-]` turned
  into `-` (`Ada's-Laptop` gives `ada-s-laptop`). Its repository defaults to
  `<github.login>/<workspace>-oats`, private. Or an existing workspace's
  reference.
- **The namespace `N`:** the part of every agent's address before the `/`,
  which other people's agents use to reach this machine's agents. Default:
  the hostname, normalised as above, so the namespace is the machine's own. Messaging is
  on, and the root's name `A` is `<workspace>-root`.
- **The steward's name:** lowercase letters and digits, words joined by
  single `-`. Default: `steward`. It gives `R`, the steward's instance name
  here and the name in its address, `N.aweb.ai/R`. `R` is the chosen name,
  or `<hostname>-<chosen name>` (the hostname normalised as above) when the
  person says `N` is a namespace another machine already uses, so that this
  machine never adopts the other machine's resident.
- **The deployment directory `D`:** default `<home>/Agents/<workspace>`,
  with the home folder spelled out.
- **OATS Desktop:** installed and started by default; the TUI not opened.
- **The harness:** the found-list's `harness`. Ask only when it names none,
  with the one you are as the default.

## 2. Check, and install what is missing

```bash
uname -sm; node --version; git --version; tmux -V; gh --version; npm prefix -g
```

- **Versions:** Node 22 or later; Git 2.45 or later is best (older works,
  fetching more); `gh` 2.49 or later (step 4 uses `gh attestation`).
- **The harness** they chose must be installed and logged in (`claude
  --version`, `codex --version` or `pi --version`).
- **macOS:** with Homebrew (`brew --version`), `brew install node git tmux gh`.
  - **Without Homebrew,** it installs in their own Terminal, which you open
    for them ("How to work") with the command under “Install Homebrew” on
    <https://brew.sh>, since it asks for their password. Then add its
    `brew shellenv` line to their `~/.zprofile` yourself, as its “Next
    steps” say.
  - Your running process does not see their new PATH. Start each later
    command with `eval "$(/opt/homebrew/bin/brew shellenv)"`
    (`/usr/local/bin/brew` on Intel), or ask them to restart you.
- **Linux:**
  - **Packages:** the distribution's, for git and tmux.
  - **gh:** from GitHub's own apt or rpm repository
    (<https://github.com/cli/cli/blob/trunk/docs/install_linux.md>), because
    distributions ship versions too old for step 4.
  - **Node 22:** from NodeSource or a version manager when the distribution's
    is older.
  - **Passwords:** a line that needs `sudo` goes to their own terminal,
    unless `sudo -n true` succeeds.
- **npm's global folder** (`npm prefix -g`) must be writable for step 4's
  install (`test -w "$(npm prefix -g)/lib"`). If it is not (a system Node
  under `/usr`, as NodeSource installs it), either they run that install with
  `sudo` in their own terminal, or set a per-user prefix:
  `npm config set prefix ~/.local`. Then put `~/.local/bin` on PATH: start
  each later command of yours with `export PATH="$HOME/.local/bin:$PATH"`
  (your shell does not reread their profile). Add that line to their shell's
  startup file yourself, so their own terminal finds `oats` too, and tell
  them you did: `~/.zshrc` when `$SHELL` ends in `zsh`, else `~/.bashrc`
  (for fish, `fish -c 'fish_add_path ~/.local/bin'` instead).

  ```bash
  RC="$HOME/.bashrc"; case "$SHELL" in *zsh) RC="$HOME/.zshrc";; esac; grep -qsF '$HOME/.local/bin' "$RC" || printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"; echo "$RC"
  ```
- **Windows** is not supported.

## 3. Log in to GitHub

OATS reads the workspace and its repositories with Git, using the person's
GitHub access. Check first:

```bash
gh auth status
```

If it is logged in, let Git use it (without this, step 5's push and step 6
fail with "could not read Username"), then go to step 4:

```bash
gh auth setup-git
```

If it is not logged in, start the login yourself, detached and without a
terminal (use your harness's background mode if it has one). gh then prints
a one-time code and a URL instead of opening a browser, and waits:

```bash
nohup gh auth login --web --hostname github.com --git-protocol https --skip-ssh-key </dev/null >"$HOME/.oats-gh-login.txt" 2>&1 &
```

In a separate command, a few seconds later, read the code and the URL:

```bash
cat "$HOME/.oats-gh-login.txt"
```

- **Give the person the code, and open the URL** in their browser
  (`open https://github.com/login/device` on macOS, `xdg-open …` on Linux;
  give them the URL if that fails). The code is not a secret: only their own
  signed-in browser can use it. They enter the code and approve. A code expires after about 15
  minutes; then start again.
- **Once they say they approved,** check the login and let Git use it:

```bash
gh auth status && gh auth setup-git && rm -f "$HOME/.oats-gh-login.txt"
```

The token stays in gh's store and never reaches you. SSH keys, commit
signing and the DCO sign-off come later, from the setup expert.

## 4. Install OATS Desktop, then the CLI, at the same version

The Desktop accepts a band of CLI versions around its own, so install it
first, then the CLI of the same version `V`. Find `V`, and on macOS `ARCH`:

```bash
npm view @awebai/oats version
sysctl -n hw.optional.arm64 2>/dev/null   # macOS: 1 means ARCH=arm64, otherwise ARCH=x64
```

**Every step verifies before it installs.** If a download or a check fails
(the release's Desktop assets can lag its npm package), skip the Desktop,
say so, and go on with the CLI. Never skip a check to make it install.

**macOS.** In one block, with `V` and `ARCH` written in. Install into
`/Applications`, which needs an administrator; for a standard user, use
`$HOME/Applications` (`mkdir -p "$HOME/Applications"`) in its place in every
line below:

```bash
cd "$(mktemp -d)" && pwd &&
gh release download "vV" -R awebai/oats -p "oats-desktop-V-mac-ARCH.zip" -p SHA256SUMS.txt &&
grep " oats-desktop-V-mac-ARCH.zip\$" SHA256SUMS.txt | shasum -a 256 -c - &&
gh attestation verify "oats-desktop-V-mac-ARCH.zip" --repo awebai/oats &&
ditto -x -k "oats-desktop-V-mac-ARCH.zip" . &&
codesign --verify --deep --strict "OATS Desktop.app" &&
defaults read "$PWD/OATS Desktop.app/Contents/Info" CFBundleIdentifier &&
defaults read "$PWD/OATS Desktop.app/Contents/Info" CFBundleShortVersionString
```

- **Expected:** `ai.oats.desktop` and `V`. The app is ad-hoc signed and not
  notarized; `codesign --verify` passing is what to expect.
- **Download with `gh`, never through a browser.** `gh` sets no quarantine
  on what it downloads, and that copy starts from Finder. A browser download
  would be quarantined.
- **Install it.** If the Desktop is running, tell the person and quit it;
  its agents keep running:
  `osascript -e 'quit app "OATS Desktop"'; for i in $(seq 20); do pgrep -xq "OATS Desktop" || break; sleep 1; done`.
  Then, with the folder `pwd` printed:

  ```bash
  cd "<that folder>" && rm -rf "/Applications/OATS Desktop.app" && ditto "OATS Desktop.app" "/Applications/OATS Desktop.app" && defaults read "/Applications/OATS Desktop.app/Contents/Info" CFBundleShortVersionString
  xattr -p com.apple.quarantine "/Applications/OATS Desktop.app" 2>/dev/null && echo QUARANTINED
  ```

- **If it prints `QUARANTINED`,** tell the person. Remove the attribute only
  if they agree (`xattr -dr com.apple.quarantine "/Applications/OATS
  Desktop.app"`): never silently.

**Linux x64.** It needs glibc 2.34 or later (`ldd --version`). It installs
per user, without sudo, and shows in the app launcher. If the Desktop is
running, tell the person and quit it first; its agents keep running:
`pkill -o -u "$(id -u)" -x oats-desktop; for i in $(seq 20); do pgrep -u "$(id -u)" -x oats-desktop >/dev/null || break; sleep 1; done; pgrep -u "$(id -u)" -x oats-desktop >/dev/null && echo STILL_RUNNING`
(the oldest process is the Desktop's main one). On `STILL_RUNNING`, ask the
person to quit it.

```bash
cd "$(mktemp -d)" &&
gh release download "vV" -R awebai/oats -p "oats-desktop-V-linux-x86_64.AppImage" -p SHA256SUMS.txt &&
grep " oats-desktop-V-linux-x86_64.AppImage\$" SHA256SUMS.txt | sha256sum -c - &&
gh attestation verify "oats-desktop-V-linux-x86_64.AppImage" --repo awebai/oats &&
mkdir -p ~/.local/opt/oats-desktop ~/.local/share/applications &&
install -m 755 "oats-desktop-V-linux-x86_64.AppImage" ~/.local/opt/oats-desktop/OATS-Desktop.AppImage
```

Then write `~/.local/share/applications/oats-desktop.desktop`, with `<home>`
their home directory's absolute path:

```text
[Desktop Entry]
Type=Application
Name=OATS Desktop
Exec=<home>/.local/opt/oats-desktop/OATS-Desktop.AppImage %U
Terminal=false
Categories=Development;
```

- **Without FUSE** (step 8's start fails with a FUSE message; Ubuntu 22.04
  and later ship without `libfuse2`), add ` --appimage-extract-and-run` after
  the AppImage's path in `Exec=` and in step 8's start. That needs no
  `sudo`; installing `libfuse2` (`libfuse2t64` on Ubuntu 24.04) does.
- **Linux arm64** (`uname -m` says `aarch64`) has no Desktop: skip the
  download, say so and go on.

**Don't start the Desktop yet;** step 8 starts it on the new deployment.

**Then the CLI, and for pi its bridge:**

```bash
npm install -g "@awebai/oats@V" && oats version
pi install "npm:@awebai/oats-pi@V"      # only when the harness is pi
```

## 5. The workspace

**New workspace.** Create its repository, private, inside the deployment
directory `D`, then write the files below in it.
- **Private** is the safe default: the workspace file names every member, so
  whoever reads it sees the list.
- **`D/<repo>` must not exist yet:** an existing folder's files would end up
  in the first commit.

```bash
mkdir -p "D" && cd "D" && test ! -e "<repo>" && gh repo create "<owner>/<repo>" --private --clone && ls -a "<repo>"
```

Then write the files below in `D/<repo>`, all in this one first commit.
They show a workspace named `acme`, in the repository `acme/acme-oats`,
with Claude as the harness and messaging for the aweb username `acme-ana`:
write the person's own workspace name, repository, harness and username in
their place.

`oats-workspace.yaml`:

```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/acme-oats     # the host is a member too
packages:
  oats.framework: v1.15.0             # the installed CLI's catalog versions (below)
  oats.aweb: v1.32.0                  # messaging, and tasks: agent identities, mail, chat and tasks
  oats.machine: v0.1.1                # on a machine found-list only: the machine's steward
defaults:
  capabilities:
    oats.core: { from: package }
  messaging: { oats.aweb: { from: package } }
  tasks: { oats.aweb-tasks: { from: package } }   # aweb tasks: assignment, claims, status and handoff
teams:
  acme: { description: The acme workspace's aweb team, team: "default:acme-ana.aweb.ai" }
defaultTeam: acme                     # every soul starts in this team
```

- **The versions** are the installed CLI's catalog's:
  `"$(oats root)/package-catalog.json"`, `packages."oats.framework".ref`
  (for example `oats-framework/v1.15.0`: write the part after the `/`) and
  `packages."oats.aweb".ref`, but never below `v1.31.0`: that release
  carries `oats.aweb-tasks`, and a bare version resolves through the
  catalog's tag convention even when the installed catalog names an older
  one.
- **On a machine found-list only,** keep the `oats.machine` line, at the
  catalog's `packages."oats.machine".ref`, and write none of the
  `souls/<workspace>-oats-setup-expert` files below: the steward is the
  workspace's setup soul. Elsewhere, leave the line out.
- **The team** is `default:N.aweb.ai`, with `N` the username from step 1;
  its label (here `acme`) is the workspace name.
- **Tasks** use aweb, the same identities as messaging: agents assign,
  claim and hand off work as aweb tasks the person sees on the aweb
  dashboard. A workspace that uses Jira or Linear writes that provider in
  `tasks:` instead (the setup expert sets it up).
- **Without messaging,** leave out the `oats.aweb` line, the `messaging`
  line, the `tasks` line, `teams` and `defaultTeam`.
- **Add nothing else:** knowledge and the person's own repositories come
  with the setup expert.

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
work: worktree      # it changes this repository from its own worktree
capabilities:
  oats.setup: { from: package }
knowledge: none     # so it spawns on a machine before knowledge is set up there
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
skills hold every procedure. Start with `/oats-setup-model`. When your task
is a hand-over from the getting-started skill, follow `/oats-setup-expert`,
or `/oats-onboarding` if your `oats.setup` is older than 2.8.0 and lacks it.
```

`souls/acme-developer/soul.yaml`, a first developer for the person's tasks:

```yaml
schemaVersion: 2
name: acme-developer
description: A developer in the acme workspace — builds what its task asks.
work: directory     # its own folder; the setup expert points it at the person's repositories later
knowledge: none
launch: { harness: claude }
```

`souls/acme-developer/AGENTS.md`, and beside it the symlink
`CLAUDE.md -> AGENTS.md`:

```markdown
# acme-developer

You are a developer in the acme workspace. You build what your task asks,
in your own `work/` directory: write the code, run it and test it. Keep the
solution small and simple. When you finish, say what you built, where it is
and how you checked it. If you are blocked on a decision, ask whoever gave
you the task.
```

**Keep the soul this thin.** Everything it knows comes from `oats.setup`, so
it improves when the workspace's `oats.framework` pin moves. It has no
knowledge of its own, so it can be spawned on a machine before knowledge is
set up there. It takes the workspace's messaging and doesn't empty that
slot: a setup soul that empties the messaging slot the workspace fills is
not the workspace's operator, and gets no mail.

**Commit and push.**
- This first commit goes straight to the new repository's default branch: it
  is the person's own, just created. Later changes come from the setup
  expert, by its briefing's rule for shared files (`oats.setup`'s
  `/oats-workspace-config`, "Change a shared file"). From oats.setup 2.8.3
  (oats.framework 1.13.4), it pushes straight to the default branch when its
  checks show nobody else can push there and nothing guards that branch, and
  for a member repository only on the person's yes; otherwise it opens a
  pull request. An older `oats.setup` always opens one.
- If `git config user.email` prints nothing, the person's Git identity is not
  set up yet. After they confirm their name, commit with
  `-c user.name="<their name>" -c user.email="<their noreply address>"`. The
  noreply address comes from
  `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`. The
  setup expert sets up their identity properly later.

```bash
cd "D/<repo>" && git add -A && git commit -m "OATS workspace acme: workspace, team, setup expert, developer" && git push -u origin HEAD
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
- **The host must be `confirmed`.** Another member with `cannot-read` is an
  access question for the setup expert, not a reason to stop. A host that
  can't be read is a GitHub access problem (step 3).
- **`E_ALREADY_ONBOARDED`:** `D` already is a deployment. Stop and ask the
  person whether to use it as it is or to choose another directory.

**Find the setup expert soul, `S`.**
- **From OATS 0.61.0,** the next step `oats onboard` prints names the soul
  that holds `oats.setup`, the workspace's setup expert (`--json`:
  `next.spawn`).
- **Before 0.61.0,** read `oats souls --dir D --json`: the soul named
  `<workspace>-oats-setup-expert`, else one whose definition declares
  `oats.setup`.
- **On a machine found-list,** `S` is `oats.machine/steward`. An existing
  workspace that doesn't offer it: stop, and say that its owner adds
  `oats.machine` to its `packages:`.
- **An existing workspace with no such soul:** stop. Show the person the soul
  files from step 5 and say that the workspace's owner adds them by pull
  request to its host repository. Once that is merged, run
  `oats sync --dir D` and look for `S` again.

**The clone.** A soul with `work: worktree` needs a clone of its repository
at `D/<repo name>`. A new workspace already has it (step 5). For an existing
one, clone the repository that holds `S` with the `git clone` line
`oats onboard` printed for it, if that line says it is missing.

**On a machine found-list, record the steward's harness** on this machine
first. Its soul names none, and without this every later check (readiness,
harness trust) and the spawn would use the default, pi:

```bash
oats soul launch set S --harness <harness> --dir D --plan
oats soul launch set S --harness <harness> --dir D
```

## 7. Hand over to the setup expert

**Messaging on this machine first, when the setup expert takes it.** Read
`oats inspect --soul S --dir D --json`. If its `result.layers.messaging.id`
is `oats.aweb`, the workspace has messaging, and the setup expert
can't spawn on this machine until it has messaging too. Set it up now:
1. **Install `aw`, and the harness's aweb channel** (Claude:
   `claude plugin marketplace add awebai/claude-plugins && claude plugin install aweb-channel@awebai-marketplace`;
   pi: `pi install npm:@awebai/pi`; Codex: nothing). Then:

   ```bash
   cd "D" && oats aweb setup --soul S --install-aw --check-only --json
   ```

   Its `aw.status` must be `ok` or `done`; stop on `failed` and tell the
   person why. Its `defaultTeam.label` is `L`, the setup expert's team. For a new workspace it must equal the label you wrote under `teams:` (the workspace name, not the username `N`); if it differs, stop and tell the person.
2. **New workspace: sign up its aweb account and team,** with `N` and `A`
   from step 1. No API key, no token and nothing for the person to type.
   Preview first, then run it:

   ```bash
   cd "D" && oats aweb setup --soul S --username N --name A --label L --plan --json
   cd "D" && oats aweb setup --soul S --username N --name A --label L --json
   ```

   The preview does not contact aweb, so it can't tell whether `N` is free.
   If the run fails with `E_SETUP_NATIVE` (most likely the username is
   taken; aw's output is withheld), don't rerun yet: run
   `test -e "D/.aw" && echo HAS_AW`. If it prints `HAS_AW`, stop and tell the
   person what you saw. Otherwise ask the person for another `N`, then in
   `D/<repo>` change the team id in `oats-workspace.yaml` to
   `default:N.aweb.ai`, commit and push it, run `oats sync --dir D`, and run
   both lines again. Then skip items 3 and 4 and go to the check (item 5).
   On a machine found-list, ask nothing: tell the person that the run
   failed, most likely because `N` is taken, and stop.
3. **Existing workspace: the person gets an invite token** from a member of `L`, who runs
   `oats aweb invite --soul <their soul> --label L --json` in their own
   deployment and passes the token to the person privately, never by
   ordinary mail. They also give the aweb service URL `U`. Choose with the
   person a name `A` for this machine's messaging root, such as
   `<workspace>-<their machine>`. This works for a hosted team only: if the
   invite is refused, or the join says the team is not hosted, stop, and
   the workspace's owner decides.
4. **Existing workspace: the person joins in their own terminal,** which you
   open for them ("How to work"), typing the token at the hidden prompt. Its
   command, with `D`, `S`, `L`, `A` and `U` filled in:

   ```text
   cd "D" && sh -c 'stty -echo; printf "Invite token: "; read -r T; stty echo; echo; printf "%s\n" "$T" | oats aweb setup --soul S --join L --invite-stdin --name A --service U'
   ```
5. **Check,** and expect `"member": true`:

   ```bash
   cd "D" && oats aweb setup --soul S --check-only --json
   ```

The setup expert does the rest of this machine's messaging
(`/oats-host-delivery`).

**The steward's global address (machine found-list only).** The steward
gets a global, contacts-only aweb address, `<namespace>/R`, made by the
team root you just signed up, with no API key and nothing for the person to
type. `R` is the steward's name from step 1, for the resident and the
instance alike.

Without messaging there is no address to make: skip this. Otherwise it
needs every one of these, and when one fails, take the fallback below:
- a new workspace: a root that joined by invite (items 3 and 4) does not own
  the namespace, so aweb would refuse the create;
- `oats.aweb` 1.33.0 or later: the `oats.aweb` row of the
  `oats inspect` you read above, `result.capabilities[].version`;
- aw 1.36.48 or later: `aw.version` in the check (item 5).

Plan, then create, both from `D` and with no `AWEB_API_KEY`:

```bash
cd "D" && env -u AWEB_API_KEY oats aweb resident create R --team-label L --plan --json
cd "D" && env -u AWEB_API_KEY oats aweb resident create R --team-label L --json
```

- **The plan** changes nothing. Run the create only when the plan's `ok` is
  true and either `result.init.route` is `root` (a new resident) or
  `result.init` is `null` (`R` already holds it; the create adopts it and
  never makes a second one). Anything else, a refusal included (no team
  root, say), is the fallback.
- **`--team-label L`** puts the resident in the team that is already the
  default, so the run maps nothing new and prints the spawn line as its one
  step (`result.steps`). If it prints another step first, stop and tell the
  person what it says: that step is theirs.
- **Success** prints `PASS resident <address> …`, and `result.address` is
  the steward's address. Spawn with the grant-seat options below.
- **A failure** is reported to the person as it is, and you spawn nothing.
  If the create was interrupted (killed, or timed out with no answer), run
  the same line again, unchanged, and nothing else. Never empty
  `D/.aweb-residents/R`: the identity may already exist.
- **The fallback:** spawn the steward without the grant-seat options. It gets
  a local team identity, as every instance does. Tell the person in one line,
  without asking anything: the steward has a local team identity and no
  global address because of <the reason>, and the GLOBAL residents and grant
  seats section of `/oats-aweb` moves it to one later. Never ask for a key.

**Write the hand-over** to `D/.oats-handover.md`. It holds no secret.

```markdown
# Onboarding hand-over from the getting-started skill

- Workspace: <workspace> (W), new | existing; deployment directory: D
- Setup expert: S, harness <harness>
- Machine found-list only: steward R, address N.aweb.ai/R | local team
  identity (<the fallback's reason>)

## The person's answers
<step 1's answers, in their words: use case, repositories and where they
are cloned, knowledge tools, messaging wanted or not>

## Done by the getting-started skill
- Installed: OATS <V> (oats version), OATS Desktop <V> | not installed (why)
- GitHub: gh logged in over https as <login>; no SSH key or signing set up
- New workspace only: repository <owner>/<repo> created, first commit pushed
- Messaging: new account N signed up, or joined L by invite; root A (aw <version>, <harness>
  channel installed) | not set up (the setup expert has no messaging)

## Left to you
Everything else, starting with /oats-setup-expert.
```

**Claude and Codex only: trust the deployment directory first,** so the first
start doesn't stop at the harness's folder-trust question. pi needs
nothing. Use `codex` for Codex:

```bash
oats harness trust --dir D --harness claude --plan
oats harness trust --dir D --harness claude
```

- **If either refuses a file** (on macOS, `~/.claude.json` can carry a mark
  the writer refuses), don't edit the file or its attributes. Open their
  own terminal ("How to work") with `cd "D" && claude` (or `codex`); they
  accept the harness's folder-trust question and exit.
- **Then check** that the `harness-trust` item of
  `oats readiness --soul S --dir D --json` passes.

**Preview the spawn, read it, then spawn:**

```bash
oats spawn S --dir D --task-file D/.oats-handover.md --preview
oats spawn S --dir D --task-file D/.oats-handover.md
```

**On a machine found-list,** name the steward `R` (its harness was recorded
in step 6). With its global address:

```bash
oats spawn S --dir D --task-file D/.oats-handover.md --name R --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=R --preview
oats spawn S --dir D --task-file D/.oats-handover.md --name R --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=R
```

In the fallback, or without messaging, leave out both `--provider` options.

- **The preview** shows what the spawn would create. If it reports a
  problem, stop and tell the person what it says.
- **The spawn** prints the instance's home `H`. Then delete the hand-over
  file: the home has its copy as `TASK.md`.
- **`E_SPAWN_INCOMPLETE`:** don't spawn again. Run `oats session inspect
  --home H --json` and tell the person what it shows.

## 8. Start the Desktop and the TUI, then hand over

**The Desktop**, if installed, starts on the new deployment:
- **macOS:** `open -n -a "OATS Desktop" --args --dir D`. If the Desktop is
  already running, the new launch hands `--dir` to it and exits.
- **Linux:** start it yourself through their session manager, so it gets
  their desktop session's environment, not yours (yours may carry your
  harness's variables and sandbox, and the Desktop passes its environment to
  every agent it starts):

  ```bash
  U="oats-desktop-$(date +%s)"; LOG="$(mktemp)"; systemd-run --user --collect --quiet --unit "$U" -p KillMode=process -p StandardOutput="file:$LOG" -p StandardError="file:$LOG" -E DISPLAY -E WAYLAND_DISPLAY -E XAUTHORITY "$HOME/.local/opt/oats-desktop/OATS-Desktop.AppImage" --dir "D" && for i in $(seq 30); do pgrep -u "$(id -u)" -x oats-desktop >/dev/null && break; sleep 1; done; sleep 3; if pgrep -u "$(id -u)" -x oats-desktop >/dev/null; then echo STARTED; else echo FAILED; tail -n 20 "$LOG"; fi
  ```

  - **`STARTED`:** it shows `D`.
  - **A FUSE message:** see step 4, then start it again.
  - **Anything else,** or no `systemd-run`: tell the person what it printed.
    They open **OATS Desktop** from their app launcher, and it lists `D` in
    its switcher (from OATS 0.65.0).
- **Never start it with an emptied environment** (`env -i`): it then loses
  HOME, and Git loses the person's login.

**The TUI**, if they wanted it, runs in a terminal of its own: open it in
their own terminal, as "How to work" says, with the command
`oats tui --dir "D"`.

**Tell the person where the setup expert is** (on a machine found-list, the
steward, and its address), and that it continues from
here: in the Desktop or the TUI you started. Without either, they reach it
with `oats session attach --home H` in a terminal.

It will ask them only what the hand-over leaves open, and it opens a pane in
its own window when they need to type a secret. You are done.

## Never

- **Ask for, read, print or store a secret,** or suggest `!` for one. If the
  person pastes one into the conversation anyway, don't repeat it, and tell
  them to rotate it.
- **Overwrite or re-onboard** a deployment, or push to a repository the
  person did not create in step 5.
- **The Desktop:** never download it through a browser, skip a verification
  step, strip quarantine without asking, or start it with `env -i`.
- **Put an absolute path or a credential** in `oats-workspace.yaml`,
  `oats-membership.yaml` or a soul (the aweb username in the team id is not
  a secret).
- **Spawn** before `oats onboard` confirmed the host.
