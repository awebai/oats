---
name: oats-getting-started
description: >-
  The way into OATS (Open Agent Team Specification) for a person who has only
  a coding agent. Asks about their project, installs OATS, OATS Desktop and
  the messaging CLI, signs the person in to their messaging account and
  creates the workspace's team, writes a new workspace's skeleton (or joins
  this machine to an existing workspace), spawns the workspace's setup
  expert, which does the rest, and opens the Desktop on it. Offers the TUI.
  Use for "get started with OATS", "set up / install / adopt OATS", "set up
  OATS for this project", "join our OATS workspace", or when someone gives
  you this file or its URL.
---

# Getting started with OATS

You are the person's own coding agent. This skill takes them from nothing to
a running **setup expert**: an OATS agent of their workspace that does the
rest of the setup with them (their repositories, their own coordination,
knowledge and tasks capabilities, their first agents). You install, ask,
write a few files and spawn it. Then you are done.

OATS in one paragraph: a **workspace** is one Git repository declaring which
repositories belong to an organisation and which packages it trusts. A
**soul** is a durable agent role defined in Git; an **instance** is a soul at
work, in its own home and terminal. A new workspace's setup expert is the
`oats.framework` package's soul `oats-setup-expert`, spawned as the instance
`<workspace>-oats-setup-expert`. It holds the `oats.setup` and
`oats.onboarding` capabilities.

**A machine found-list.** Your prompt may hand you a found-list, a JSON file
whose `machine.platform` is set (oats-omarchy's installer writes one). Then
the workspace you make is this machine's own workspace. Its setup soul is
the machine's steward, `oats.machine/steward`, in place of the setup expert,
and the steward gets a global aweb address. Steps 1, 5, 7, 8 and 9 say what
changes. When the found-list lists a deployment whose `steward` is `true`,
this machine already has its workspace and steward: tell the person so, and
stop. Wherever a later step says to ask the
person, on a machine found-list you tell them what happened, as it is, and
stop instead: the person answers nothing after step 1.

**How to work.**
- **Ask first, then run.** Ask everything in one round (step 1), then run the
  steps yourself and read back what each did.
- **Secrets.** The person types only what you must never hold: passwords,
  tokens and logins. Before the spawn there are two ways for that: a browser
  device flow you start (the GitHub login, step 3, and the messaging login,
  step 5), and the exact command in their own terminal (a `sudo` or Homebrew
  password, an aweb invite token), which you open for them (below).
  - Never ask for a secret in the conversation, and never write one to a file.
  - Never suggest Claude Code's `! <command>` for one: its command and output
    enter your context.
- **Your shell may keep nothing between commands.** Many harnesses start each
  command in a new shell, in the same starting folder.
  - Run each fenced block below as one command.
  - When a later block needs a value an earlier one found (`V`, `ARCH`, a
    path, the team id `T`), write that value in literally.
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
  don't push to a repository the person did not create in step 6 or name as
  the workspace's host there.

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
    by single `-` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), for example `acme`. Refuse
    `agents`: OATS keeps instance homes in a folder of that name.
- **New workspace: where the workspace lives.** The workspace's files live in
  one repository, its host. Three cases, from their repositories:
  - **One repository (a monorepo):** the host is that repository, and the
    files go at its root. Ask for its GitHub owner and name.
  - **Several repositories:** a dedicated host repository, private, created
    in step 6. Ask for its owner (their user, or an organisation they can
    create repositories in) and name; suggest `<workspace>-oats`.
  - **No repositories yet:** create their first one in step 6; it is the
    host. Ask for its owner and name.

  Whatever the case, if any repository of theirs is private, the host is
  private: the workspace file names every member, so whoever reads it sees
  the list.
- **Messaging between agents:** which messaging capability, or none. The
  default, and the one this skill sets up, is aweb (`oats.aweb`):
  recommended, because agents that can mail each other can coordinate. A new
  workspace needs nothing more from them now: they sign in to their aweb
  account, or create one, in their browser in step 5. For another messaging
  capability, leave messaging out here: the setup expert adds it.
- **The harness for the setup expert:** `claude`, `codex` or `pi`. Default:
  the one you are, if it is one of these.
- **The deployment directory `D`:** where OATS lives on this machine. Any
  folder but their home folder itself works: ask for it, and suggest none.
  `oats onboard` adds `D` to this computer's list of deployments
  (`~/.oats/config/deployments.json`, which `oats deployments` reads), so the
  Desktop and the TUI find it wherever it is. Write `D` everywhere below as
  an absolute path, with the home folder spelled out: never `~`, which the
  shell does not expand inside quotes.
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
  `<github.login>/<workspace>-oats`, private, a dedicated host. Or an
  existing workspace's reference.
- **The namespace `N`:** the part of every agent's address before the `/`,
  which other people's agents use to reach this machine's agents. Default:
  the hostname, normalised as above, so the namespace is the machine's own.
  Messaging is aweb, and the root's name `A` is `<workspace>-root`.
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

- **Versions:** Node 22 or later; Git 2.45 or later recommended (partial
  caches), and older Git works with whole-tree fetches; `gh` 2.49 or later
  (step 4 uses `gh attestation`).
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
  - **Node 22:** distributions ship older ones (Debian 13 has 20, Ubuntu
    24.04 has 18). On Debian and Ubuntu, x64 or arm64, from NodeSource:

    ```bash
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
    ```
  - **Git 2.45 (recommended):** Debian 13's is new enough. Ubuntu 24.04
    ships 2.43; on Ubuntu, x64 or arm64, from the git-core PPA:

    ```bash
    sudo add-apt-repository -y ppa:git-core/ppa && sudo apt-get update && sudo apt-get install -y git
    ```
  - **Passwords:** a line that needs `sudo` goes to their own terminal,
    unless `sudo -n true` succeeds.
- **Then check again** with `node --version` and `git --version`. When
  Node is still under 22 (on another distribution, or where that route does
  not apply), stop: tell the person the minimum and the version found, and
  go no further until they have installed it. Git under 2.45 is no stop:
  tell them it works with whole-tree fetches, and go on.
- **npm's global folder** (`npm prefix -g`) must be writable for step 4's
  installs (`test -w "$(npm prefix -g)/lib"`). If it is not (a system Node
  under `/usr`, as NodeSource installs it), either they run those installs
  with `sudo` in their own terminal, or set a per-user prefix:
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

GitHub stays where the flow needs it: the Desktop's download and its
attestation (step 4), creating and pushing the host repository (step 6), and
OATS reading the workspace and its repositories with Git (step 8). Check
first:

```bash
gh auth status
```

If it is logged in, let Git use it (without this, step 6's push and step 8
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

The token stays in gh's store and never reaches you. That is all the Git
setup this needs. An SSH key, commit signing and the DCO sign-off are
optional: the setup expert's `/oats-git-setup` sets them up when Git access
is broken or the person wants them, and says plainly what it changes.

## 4. Install OATS Desktop, the CLI and the messaging CLI

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

- **Without FUSE** (step 10's start fails with a FUSE message; Ubuntu 22.04
  and later ship without `libfuse2`), add ` --appimage-extract-and-run` after
  the AppImage's path in `Exec=` and in step 10's start. That needs no
  `sudo`; installing `libfuse2` (`libfuse2t64` on Ubuntu 24.04) does.
- **Linux arm64** (`uname -m` says `aarch64`) has no Desktop: skip the
  download, say so and go on.

**Don't start the Desktop yet;** step 10 starts it on the new deployment.

**Then the CLI, and for pi its bridge:**

```bash
npm install -g "@awebai/oats@V" && oats version
pi install "npm:@awebai/oats-pi@V"      # only when the harness is pi
```

**A new workspace needs `oats.framework` 1.18.0 or later,** the release
that ships the setup expert soul. Read the installed CLI's catalog:

```bash
node -e 'const c=require(process.argv[1]);console.log(c.packages["oats.framework"].ref,c.packages["oats.aweb"].ref)' "$(oats root)/package-catalog.json"
```

It prints the two refs, for example `oats-framework/v1.18.0 v1.32.1`. If the
framework's version (the part after the `/`) is below `1.18.0`, this OATS
release is older than this skill: stop, and tell the person to wait for the
next OATS release. Never write a setup soul into the workspace in its place.

**With aweb, the messaging CLI `aw`, and the harness's aweb channel.**
Skip this without messaging. The channel is what wakes an agent when mail
arrives: Claude
`claude plugin marketplace add awebai/claude-plugins && claude plugin install aweb-channel@awebai-marketplace`;
pi `pi install npm:@awebai/pi`; Codex nothing (it is woken another way, which
the setup expert sets up).

```bash
npm install -g @awebai/aw && aw version
```

`aw` must be 1.36.33 or later.

## 5. Your messaging account and the workspace's team

**New workspace with aweb only.** An existing workspace joins in step 9, and
a machine found-list signs up there too: skip this step for both.

The workspace's agents share one team, its **default team**. Here the person
signs in to their own aweb account, and that account creates the team. Say
to them, in your words, exactly three things:
- you are creating a team for the workspace, owned by your aweb account;
- you sign in as yourself, in your own browser;
- every agent you spawn joins this default team. More teams are an explicit
  later choice.

Don't say that the agents are attributed or bound to them: the team is owned
by their account, and tying each agent to them is a later step the setup
expert offers.

**The workspace key `K`** is the host repository's key: `github.com/<owner>/<repo>`,
with the host's owner and name from step 1 (for `acme/acme-oats`,
`github.com/acme/acme-oats`). It must be exactly this: aweb keys the team on
that string, and a different spelling makes a different team.

**Sign in.** First check whether this machine's `aw` is signed in already:

```bash
aw auth status --json
```

If it prints `"status": "authorized"` with an `account`, go on to the team.
Otherwise start the login yourself, detached, as with GitHub. aw prints a URL
and a one-time code, and waits:

```bash
nohup aw auth login </dev/null >"$HOME/.oats-aw-login.txt" 2>&1 &
```

A few seconds later, in a separate command:

```bash
cat "$HOME/.oats-aw-login.txt"
```

Open the URL in their browser and give them the code. They sign in, or
create their aweb account there, and approve. The code is not a secret, and
the login's token stays in aw's store and never reaches you. Once they say
they approved:

```bash
aw auth status --json && rm -f "$HOME/.oats-aw-login.txt"
```

`account.id` is the account `ACCOUNT`; `account.handle` is its name, to tell
the person.

**Create the team, with its root in `D/.aw`.** On a first run `D/.aw` must
not exist yet: if it does and this skill did not make it, stop, and ask the
person what it is. With `D`, `K`, the workspace name and `ACCOUNT` written in:

```bash
mkdir -p "D" && test ! -e "D/.aw" && cd "D" && aw --identity-home "D/.aw" team ensure --workspace-key "K" --label "<workspace>" --expect-account "ACCOUNT" --json
```

- **Success** prints a JSON answer. Its `canonical_team_id` is the team id
  `T`, of the form `<name>:<domain>`: step 7 writes it into the workspace.
  Never write its `team_id` (an internal id), and never guess `T`.
- **It installs the team's root** in `D/.aw`: the identity that adds each
  agent the person spawns to the team, with no login at spawn. It holds keys:
  leave it alone.
- **A failure** prints one line on stderr and exits 2:
  - `authorization-required`: the login is missing or expired. Sign in
    again, then rerun.
  - `identity-home-occupied`: `D/.aw` holds something else. Stop and tell the
    person.
  - `unsupported-server`, or anything else: stop and tell the person what it
    printed.
- **After an interrupted run** (killed, timed out, or its answer lost),
  `D/.aw` exists, and the first-run line stops at its check. Run the same
  call without that check, with exactly the same `D`, `K`, workspace name and
  `ACCOUNT`: aw continues its own run, or answers `identity-home-occupied`
  for anything else. Never remove or edit `D/.aw`.

  ```bash
  cd "D" && aw --identity-home "D/.aw" team ensure --workspace-key "K" --label "<workspace>" --expect-account "ACCOUNT" --json
  ```

Tell the person the team exists, owned by their aweb account `<handle>`.

## 6. The host repository

**New workspace,** by step 1's case. `<repo>` is the host's name.
- **A dedicated host (several repositories), or the first repository (no
  repositories yet):** create it inside `D`, private unless every repository
  of theirs is public. `D/<repo>` must not exist yet: an existing folder's
  files would end up in the first commit.

  ```bash
  mkdir -p "D" && cd "D" && test ! -e "<repo>" && gh repo create "<owner>/<repo>" --private --clone && ls -a "<repo>"
  ```
- **A monorepo:** clone it into `D`, so the setup expert's tools find it
  there. If `D/<repo>` already holds a clone of it, use that clone.

  ```bash
  mkdir -p "D" && cd "D" && test ! -e "<repo>" && gh repo clone "<owner>/<repo>" "<repo>" && git -C "<repo>" status --short --branch
  ```

  Its root must not hold `oats-workspace.yaml` or `oats-membership.yaml`
  yet: if it does, stop and ask the person.

The workspace reference `W` is then `git:github.com/<owner>/<repo>`, here
`git:github.com/acme/acme-oats`.

**Existing workspace.** `W` is the reference they gave. Write nothing in its
repositories.

## 7. The skeleton

**New workspace.** Write two files at the root of `D/<repo>`, in one commit.
They show a workspace named `acme`, hosted in `acme/acme-oats`, with aweb:
write the person's own workspace name, host and team id in their place.

`oats-workspace.yaml`:

```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/acme-oats     # the host; the setup expert adds the others
packages:
  oats.framework: v1.18.0             # the installed CLI's catalog versions (below)
  oats.aweb: v1.32.1                  # messaging: agent identities, mail and chat
  oats.machine: v0.1.1                # on a machine found-list only: the machine's steward
defaults:
  capabilities:
    oats.core: { from: package }
  messaging: { oats.aweb: { from: package } }
teams:
  acme: { description: The acme workspace's team, team: "T" }
defaultTeam: acme                     # every soul starts in this team
```

- **The versions** are the ones step 4 printed: the framework's (the part
  after `oats-framework/`) and `oats.aweb`'s, but never below `v1.31.0` for
  `oats.aweb`.
- **The team** is `T` from step 5, written in literally; its label (here
  `acme`) is the workspace name. On a machine found-list, which signs up in
  step 9, it is `default:N.aweb.ai`, with `N` the namespace from step 1.
- **On a machine found-list only,** keep the `oats.machine` line, at the
  catalog's `packages."oats.machine".ref`. Elsewhere, leave it out.
- **Without messaging,** leave out the `oats.aweb` line, the `messaging`
  line, `teams` and `defaultTeam`.
- **Add nothing else:** no soul (the setup expert is `oats.framework`'s), no
  `tasks:` default, no knowledge. The setup expert authors the workspace's
  own coordination, knowledge and tasks capabilities with the person.

`oats-membership.yaml`:

```yaml
schemaVersion: 2
workspace: git:github.com/acme/acme-oats
```

**Commit and push.**
- **A repository created in step 6:** the first commit goes straight to its
  default branch: it is the person's own, just created.
- **A monorepo:** show the person the two files first. Commit to its default
  branch only on their yes. If the push is refused (a protected branch, say),
  push a branch instead, open a pull request, tell them, and stop until it is
  merged.
- If `git config user.email` prints nothing, the person's Git identity is not
  set up yet. After they confirm their name, commit with
  `-c user.name="<their name>" -c user.email="<their noreply address>"`. The
  noreply address comes from
  `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`.

```bash
cd "D/<repo>" && git add oats-workspace.yaml oats-membership.yaml && git commit -m "OATS workspace acme: workspace and team" && git push -u origin HEAD
```

## 8. Onboard this machine

```bash
oats onboard D --workspace W --json
```

- **Effects:** it writes `D/oats-local.yaml` and `D/agents/`, reads every
  member over Git and locks the packages.
- **The host must be `confirmed`.** Another member with `cannot-read` is an
  access question for the setup expert, not a reason to stop. A host that
  can't be read is a GitHub access problem (step 3).
- **`E_ALREADY_ONBOARDED`:** `D` already is a deployment. Stop and ask the
  person whether to use it as it is or to choose another directory.

**The setup expert, `S`, and its spawn line.** `result.next.spawn` is the
line to spawn it with. For a new workspace it names `oats.framework`'s
`oats-setup-expert` with `--name <workspace>-oats-setup-expert`; when it
carries another name or no `--name`, the text output of `oats onboard` says
why. `S` is the soul it names.
- **On a machine found-list,** `S` is `oats.machine/steward`. An existing
  workspace that doesn't offer it: stop, and say that its owner adds
  `oats.machine` to its `packages:`.
- **An existing workspace with no setup soul** (`next.spawn` is `null`): stop.
  Say that its owner pins `oats.framework` 1.18.0 or later, which ships
  `oats-setup-expert`. Once that is merged, run `oats sync --dir D` and look
  again.

**The clone.** A soul with `work: worktree` needs a clone of its repository
at `D/<repo name>`. `oats-setup-expert` works in a directory of its own and
needs none. For an existing workspace whose setup soul is the workspace's
own, clone the repository that holds it with the `git clone` line
`oats onboard` printed for it, if that line says it is missing.

**Record the setup expert's harness** on this machine. A package soul names
none, and without this every later check (readiness, harness trust) and the
spawn would use the default, pi:

```bash
oats soul launch set S --harness <harness> --dir D --plan
oats soul launch set S --harness <harness> --dir D
```

## 9. Messaging on this machine

Read `oats inspect --soul S --dir D --json`. Its `result.layers.messaging.id`
names the soul's messaging capability; `null` means none, and then skip this
step. Otherwise the setup expert can't spawn on this machine until that
capability is set up here. That setup is the capability's own; its readiness
names what is missing:

```bash
oats readiness --soul S --dir D --json
```

The messaging items must not report a problem. aweb, the default, is set up
as below. For another messaging capability, follow its own setup skill, and
stop if its readiness still reports a problem.

**With aweb (`oats.aweb`):**
1. **Check:**

   ```bash
   cd "D" && oats aweb setup --soul S --check-only --json
   ```

   Its `aw.status` must be `ok`. If `aw` is missing, install it and the
   harness's channel as step 4 says, then check again; stop on anything else
   and tell the person why. Its `defaultTeam.label` is `L`, the setup expert's team.
   - **A new workspace** expects `"member": true` here: step 5 installed the
     root. Then this step is done. A machine found-list skipped step 5, so
     its `"member": false` here is expected: go on to item 2.
   - **`"member": false` on a new workspace, without a machine found-list:**
     stop, spawn nothing, and tell the person which fix applies. With
     `"root": null`, there is no root in `D/.aw`: step 5's team creation did
     not finish there, so run its line for an interrupted run, then check
     again. With a `root`, that root is not a member of `defaultTeam.team`:
     the team id step 7 wrote must be step 5's `canonical_team_id` exactly,
     so correct it in `oats-workspace.yaml`, commit and push it, run
     `oats sync --dir D`, then check again.
2. **Machine found-list: sign up its aweb account and team,** with `N` and
   `A` from step 1. No API key, no token and nothing for the person to type.
   Preview first, then run it:

   ```bash
   cd "D" && oats aweb setup --soul S --username N --name A --label L --plan --json
   cd "D" && oats aweb setup --soul S --username N --name A --label L --json
   ```

   The preview does not contact aweb, so it can't tell whether `N` is free.
   If the run fails with `E_SETUP_NATIVE` (most likely the username is
   taken; aw's output is withheld), don't rerun.
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
5. **After items 2 to 4, check again** (item 1), and expect `"member": true`.
   On `"member": false`, stop and spawn nothing: tell the person the run
   left this machine's root outside `L`, with what the check shows, and
   don't rerun the signup or the join.

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
- aw 1.36.48 or later: `aw.version` in the check (item 1).

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

## 10. Spawn the setup expert, then show it

**Write the hand-over** to `D/.oats-handover.md`. It holds no secret.

```markdown
# Onboarding hand-over from the getting-started skill

- Workspace: <workspace> (W), new | existing; deployment directory: D
- Host: <owner>/<repo>, a monorepo | a dedicated host | the first repository
- Setup expert: S, instance <name>, harness <harness>
- Machine found-list only: steward R, address N.aweb.ai/R | local team
  identity (<the fallback's reason>)

## The person's answers
<step 1's answers, in their words: use case, repositories and where they
are cloned, knowledge tools, messaging wanted or not>

## Done by the getting-started skill
- Installed: OATS <V> (oats version), OATS Desktop <V> | not installed (why)
- GitHub: gh logged in over https as <login>; no SSH key or signing set up
- New workspace only: host <owner>/<repo>, skeleton committed (pushed | in
  pull request <url>)
- Messaging: <capability>, aw <version>, <harness> channel installed;
  team T owned by aweb account <handle> (new workspace), or new account N
  signed up (machine found-list), or joined L by invite (existing) | not set
  up (the setup expert has no messaging)
- Harness channel mode: development, confirmed by OATS at each start

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

**The channel mode.** With Claude and aweb, the setup expert starts in the
development channel mode, the default: Claude asks once at each start
whether to load the aweb channel, and OATS confirms it for you. Leave it so.
Don't set `delivery: session`. The setup expert offers the approved route,
which needs no confirmation, later (it needs `sudo`).

**Preview the spawn, read it, then spawn,** with step 8's `next.spawn` line
plus the hand-over:

```bash
<next.spawn> --task-file D/.oats-handover.md --preview
<next.spawn> --task-file D/.oats-handover.md
```

For example, `oats spawn oats-setup-expert --dir D --name acme-oats-setup-expert --task-file D/.oats-handover.md`.

**On a machine found-list,** name the steward `R`. With its global address:

```bash
oats spawn S --dir D --task-file D/.oats-handover.md --name R --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=R --preview
oats spawn S --dir D --task-file D/.oats-handover.md --name R --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=R
```

In the fallback, or without messaging, leave out both `--provider` options.

- **The preview** shows what the spawn would create. If it reports a
  problem, stop and tell the person what it says.
- **The spawn** prints the instance's home `H` and its name. Then delete the
  hand-over file: the home has its copy as `TASK.md`.
- **`E_SPAWN_INCOMPLETE`:** don't spawn again. Run `oats session inspect
  --home H --json` and tell the person what it shows.
- **`E_INSTANCE_NAME_TAKEN`** (the preview or the spawn): the setup expert
  already exists, so don't spawn another. Its home `H` is in the error. It
  is opened in the Desktop below; if it is stopped, start it with
  `oats session start --home H`.

**The Desktop**, if installed, opens on the new deployment with the setup
expert selected. `I` is its instance name: the one the spawn printed, which is
`next.spawn`'s `--name` when it has one (after `E_INSTANCE_NAME_TAKEN`, that
`--name`). A Desktop that does not know `--instance` ignores it and opens the
deployment, so pass it always.
- **macOS:**

  ```bash
  open -n -a "OATS Desktop" --args --dir "D" --instance "I"
  ```

  If the Desktop is already running, the new launch hands `--dir` and
  `--instance` to it and exits.
- **Linux:** start it yourself through their session manager, so it gets
  their desktop session's environment, not yours (yours may carry your
  harness's variables and sandbox, and the Desktop passes its environment to
  every agent it starts):

  ```bash
  U="oats-desktop-$(date +%s)"; LOG="$(mktemp)"; systemd-run --user --collect --quiet --unit "$U" -p KillMode=process -p StandardOutput="file:$LOG" -p StandardError="file:$LOG" -E DISPLAY -E WAYLAND_DISPLAY -E XAUTHORITY "$HOME/.local/opt/oats-desktop/OATS-Desktop.AppImage" --dir "D" --instance "I" && for i in $(seq 30); do pgrep -u "$(id -u)" -x oats-desktop >/dev/null && break; sleep 1; done; sleep 3; if pgrep -u "$(id -u)" -x oats-desktop >/dev/null; then echo STARTED; else echo FAILED; tail -n 20 "$LOG"; fi
  ```

  - **`STARTED`:** it shows `D`, with `I` selected.
  - **A FUSE message:** see step 4, then start it again.
  - **Anything else,** or no `systemd-run`: tell the person what it printed.
    They open **OATS Desktop** from their app launcher, and it lists `D` in
    its switcher.
- **Never start it with an emptied environment** (`env -i`): it then loses
  HOME, and Git loses the person's login.

**The TUI**, if they wanted it, runs in a terminal of its own: open it in
their own terminal, as "How to work" says, with the command
`oats tui --dir "D"`.

**Tell the person where the setup expert is** (its instance name; on a
machine found-list, the steward, and its address), and that it continues
from here: in the Desktop or the TUI you started. Without either, they reach
it with `oats session attach --home H` in a terminal.

It will ask them only what the hand-over leaves open, and it opens a pane in
its own window when they need to type a secret. You are done.

## Never

- **Ask for, read, print or store a secret,** or suggest `!` for one. If the
  person pastes one into the conversation anyway, don't repeat it, and tell
  them to rotate it.
- **Overwrite or re-onboard** a deployment, touch `D/.aw`, or push to a
  repository the person did not create or name as the host in step 6.
- **Guess the team id:** it comes from step 5's answer.
- **Write a setup soul into the workspace:** the setup expert is
  `oats.framework`'s.
- **The Desktop:** never download it through a browser, skip a verification
  step, strip quarantine without asking, or start it with `env -i`.
- **Put an absolute path or a credential** in `oats-workspace.yaml`,
  `oats-membership.yaml` or a soul (the team id is not a secret).
- **Spawn** before `oats onboard` confirmed the host.
