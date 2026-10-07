# OATS Desktop

The OATS Desktop app is the control panel for an OATS deployment: the
workspace and its souls, the agent roster and hierarchy, each instance's
files, state and knowledge, and real terminals attached to running agents'
sessions. With a compatible `oats` CLI installed it also spawns, starts,
retires and schedules agents.

## Install

Download the installer for your platform from the
[GitHub Release](https://github.com/awebai/oats/releases) assets:

| Platform | Artifacts | Notes |
| --- | --- | --- |
| macOS arm64 (Apple Silicon) | DMG + ZIP | ad-hoc signed — see below |
| macOS x64 (Intel) | DMG + ZIP | ad-hoc signed — see below |
| Linux x64 | AppImage + DEB | requires `tmux` |

Windows and Linux arm64 are not supported.

Verify downloads against the release's `SHA256SUMS.txt`. GitHub
build-provenance attestations are published for every asset
(`gh attestation verify <file> --repo awebai/oats`).

### macOS: ad-hoc signed build

The macOS installers are **ad-hoc signed — not Developer ID signed and not
notarized** (no Apple signing credentials exist; nothing about this release
claims identified-developer trust). The app bundle carries a complete,
valid ad-hoc signature — every nested helper and framework is signed and
the bundle passes `codesign --verify --deep --strict` — but ad-hoc
signatures carry no identity Gatekeeper can trust, so it will still block
the first launch of a downloaded (quarantined) copy:

- Right-click the app → **Open** → **Open** (once; subsequent launches are
  normal), or
- `xattr -dr com.apple.quarantine "/Applications/OATS Desktop.app"`.

### Linux: prerequisites

`tmux` is required for the integrated terminal — the app attaches to your
agents' tmux sessions. Roster, brain, Markdown and CLI features work without
it, but opening a terminal will fail until tmux is installed. The DEB
declares the dependency; for the AppImage install it yourself
(`apt install tmux`, `dnf install tmux`, …) and verify with `tmux -V`.

### The `oats` CLI

Reads (roster, hierarchy, files, terminals) work with no CLI at all.
Everything else runs through an installed `oats` CLI:

```bash
npm install -g @awebai/oats
```

Desktop and the CLI publish in lockstep from one tag, so the matching CLI is
the one with **this Desktop's own version** — the app's degradation card
shows that exact `npm install -g @awebai/oats@<version>` command, and
copying it from the card is the reliable route.

Each Desktop accepts a band of released CLI versions around its own
(prereleases never), and a feature may need a higher floor; the app states
both, so this guide does not repeat the numbers. The contract is
[desktop-cli-api.md](desktop-cli-api.md). The app discovers the CLI automatically
(your PATH, the npm global prefix, a login shell) and re-probes on launch,
app focus, and Retry. Until a compatible CLI is verified, the Soul roster's
**Spawn** buttons are disabled behind one card showing what was detected,
what is required, **Choose oats…** (pick the binary yourself — the choice
persists), **Retry**, a docs link, and the copyable install command. The
app never installs the CLI itself.

### Launched from Finder: the login shell's PATH

Opened from Finder or the Dock, an app inherits launchd's PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`), which has no Homebrew or nvm `node` for
the CLI's `#!/usr/bin/env node`. At startup the Desktop therefore runs your
login shell once (`$SHELL -ilc`, 3 s timeout) and puts its PATH in front of
the inherited one, so the CLI probe, every `oats` call, a CLI picked with
**Choose oats…**, and the terminals the Desktop starts all run with your
shell's PATH. Only PATH is taken from the shell, never the rest of its
environment. The OATS tmux server is different: when a spawn or a start the
Desktop runs has to start it, the CLI gives it your whole login environment,
read from your login shell
([execution-targets.md](execution-targets.md#the-servers-start-environment)),
and falls back to the environment the Desktop gave the CLI (with this PATH)
only when that cannot be read, saying so on stderr. The shell is started with your environment, without what the
Desktop or its packaging added to its own (on the AppImage, the entries under
its mount), like every other program the Desktop starts. If the shell fails, times out or prints no PATH, the
inherited PATH stays: the backend's `/api/cli` reports `pathSource`
(`login-shell` or `inherited`), `pathError` (why, or `null`) and
`probePath` (the PATH the probe used), and the reason is logged at startup.
An agent's pane takes its tmux session's or server's PATH, whoever opens its
window, and its harness is looked up there
([execution-targets.md](execution-targets.md#the-servers-start-environment)):
a window the Desktop opens on a server that already runs gets that server's
PATH, not the Desktop's. A tmux server that was already running keeps its own
environment; restart it if its sessions should get the new PATH, which ends
its sessions: `tmux -L oats kill-server` for the OATS tmux server, where instances run, and `tmux kill-server` for your default server, where an instance started by an earlier kernel may still be.

## Opening a workspace

The app opens the workspaces you had open, plus the directory it was
launched with (`--dir`, or the folder it was started from) when that is an
OATS deployment — the directory (the operator's choice) holding
`oats-local.yaml` and `agents/`. A folder that is not a deployment is never
opened: started from Finder, with nothing open to restore, the window shows
the workspace switcher instead. It lists the deployments on this computer
under **On this computer** (those directly inside `~/Agents`, and a saved
one that is not open); click one to open it in this window. **Add local
workspace… → Browse** points it at any other deployment.
A picked folder without `oats-local.yaml` is offered onboarding instead. The
Desktop never parses the deployment: its members, lock state and header come
from `oats workspace status`, and its instances from the deployment's one
`agents/` root.
Added workspaces are remembered and offered as suggestions next time.
**Browse** opens in the folder holding the workspace most recently added or
opened, or your home directory when there is none (never ~/Downloads);
**Choose oats…** opens in the directory of the chosen or discovered CLI.

Launch flags for scripted use: `--dir <workspace>` and `OATS_DESKTOP_PORT`.

### One window per workspace

Each workspace has at most one window, titled with the workspace's name (a
workspace on a server: `name — server`).

- **Switching.** Choosing a workspace in the switcher shows it in the current
  window. If that workspace already has a window, that window comes to the
  front instead and the current one doesn't change.
- **Open in new window.** Each workspace in the switcher has an **Open in new
  window** button beside it. From the keyboard: Right Arrow on the workspace,
  then Enter, or ⌘Enter on macOS / Ctrl+Enter on Linux and Windows. A
  workspace that already has a window is brought to the front.
- **New Window.** On macOS, **File → New Window** (⌘⇧N); everywhere,
  **Window: new window** in the command palette. The new window has no
  workspace yet: it opens the switcher, and shows "Choose a workspace" until
  you pick one. It reads nothing until then.
- **Moving between windows.** On macOS, ⌘\` cycles the app's windows, and the
  **Window** menu lists them.
- **Restore.** Quitting and relaunching brings every window back with its
  size and place (moved onto a visible display if its own is gone). A window
  whose workspace isn't served at launch doesn't come back, but it is
  remembered until you close it while its workspace is served. With nothing
  to restore, one window opens on the last workspace you used.
- **Launching again.** Running the app again (`open -a "OATS Desktop" --args
  --dir <deployment>`, or from inside a deployment) adds that deployment if
  needed and brings its window to the front, opening one if it has none. Any
  other launch brings the most recently used window to the front.
- **Closing.** Closing a window leaves the other windows, and their
  terminals, running. Closing the last window quits the app.
- Tabs belong to their window: a workspace's terminals and tabs stay in the
  window they were opened in, and switching that window back to the
  workspace brings them back.

## Capabilities and spawning

**Workspace › Capabilities** lists what the workspace offers, in three
sections: **Workspace owned** (from the member repos, for every soul),
**Repo owned** (only for souls of the same repo) and **Packages** (pinned
versions). Workspace owned and Repo owned are grouped by the repository
that defines each capability. The groups are headed like the Souls tab:
repo name, then "member repo · host · N capabilities". The host repository
comes first, then the others by name; capabilities from outside the member
repos come last, under **external**. At the top right of Workspace owned,
pills (**All**, then one per repository, each with its count) show one
repository at a time; "N of M shown" appears while a pill or the search
narrows the list.

The **Spawn** dialog's left column, **What will be created**, starts with the
new instance's name and its home. Then come where it works, its harness and
model (with where that choice came from), its default team and the teams it may
also join, and its relationship when it has one. Under them are its core
capabilities and its other capabilities. Every dropdown in the app has the
same themed look, and its open list follows the light or dark theme.

## One workspace, several machines

The switcher lists each workspace once, however many deployments it has: the
deployments you opened on this Mac and those your registered servers report,
matched by the workspace each one reports (its repository key and default
team, by the kernel's rules). It needs a CLI with the `workspace-identity`
feature (OATS 0.36.0); without it each deployment has its own entry.

- **Deployments.** The **Deployments** page (formerly the Active overview)
  shows the workspace's overview trees. **All** stacks one section per
  deployment, each headed by its machine and folder ("This Mac ·
  ~/Agents/oats", "altair · ~/Agents/tsm"). Then each deployment has a tab of
  its own, named by its machine ("altair"; "This Mac · oats-v2" when this Mac
  holds two). A workspace with one deployment shows just that deployment's
  tab. The tab you chose is remembered per workspace. With two or more
  deployments, the sidebar's instance list is grouped under one heading per
  machine; with one, it has no headings.
- **Not shown live.** A deployment that can't be shown live says why in a few
  words on its heading ("ssh needs a prompt", "Timed out", "OATS too old to
  report its workspace"), and **How to fix** under it gives the full sentence
  and the steps. Causes: ssh needs a prompt or a host key, the read timed out,
  the host's OATS is too old to report its workspace, its workspace reference
  needs `oats sync` or fixing in `oats-local.yaml`, or this computer's OATS
  can't read other machines. A server that can't be reached stays under the
  workspace it last reported, marked "remembered".
- **The switcher.** Each workspace names its machines on one line ("This Mac ·
  altair"), with a mark when one of them isn't live.
- **Not matched to a workspace.** A deployment that can't be matched is
  listed on its own under that heading in the switcher, with its machine and
  a short reason; choosing it opens its tab on the Deployments page. When this
  computer's OATS is too old to report workspaces, nothing can be matched:
  each deployment is listed on its own, as before, and its heading says to
  update OATS.
- **Actions.** Everything you do to an instance goes to that instance's own
  deployment. Workspace-wide pages (Setup, Capabilities, Sync, Automations,
  Schedules, Teams configuration) act on the workspace's first deployment on
  this Mac, else its first, and say "On <deployment>" when there are two or
  more.
- **Spawn.** With two or more deployments, the Spawn dialog asks first which
  one to spawn in (and says "Runs on" in its summary), starting on the one you last used in that workspace when it
  offers the soul, else the first that does (this Mac first). With one, it
  asks nothing.

Saved selections and tabs move to the workspace that holds their
deployment. Details are in
[the deployment model](../packages/desktop/docs/desktop-deployment-model.md#workspace-views-and-deployments).

## Scheduling agents and wake messages

Open **Schedules** in the selected workspace to launch a new agent on a cron,
wake an existing agent with a message, or harvest its knowledge. **Schedule…**
on a Soul roster card preselects that soul. Choose the task or message, repeat
pattern and time zone; new agent jobs also offer harness, model, permissions
and session backend. The list shows the next run, last observed outcome and
whether the host scheduler is enabled. Pause, edit, run now and delete operate
on that workspace's saved jobs. Launching an agent is reported separately from
the end of its run; neither means its task succeeded.

Each schedule and trigger can carry a one-line **summary** (up to 200
characters), shown under its name in the list. Without one, the list shows the
first line of the task or wake message in italics, or "No summary" for a
command or operation. Set it in the schedule form's Summary field, or with
**Edit summary** on any local schedule or trigger (leave it empty to remove
it); a workspace item's summary is its file's `description:` in Git. A detail
page shows everything the item sends (the whole prompt or message, a command's
arguments as written, an operation and its home), its run state and where it
comes from. Writing summaries needs OATS 0.43 or later; an older OATS still
shows the ones it reports.

The Spawn dialog also has an optional **Recurring wake-up** setting. It binds
the schedule to the newly created home, preserving that agent's identity and
work. A wake starts that same home if it is stopped, then sends the saved
message through its terminal when ready. It sends no interrupt; the harness
decides when to process submitted input. Missed cron times are skipped. If the
agent is created but its wake schedule cannot be saved, the dialog reports both
facts and directs you to Schedules without spawning another agent.

Use **Enable host scheduler** when the view reports that the timer or workspace
registration is missing. One host timer handles its registered workspaces with
a shared limit on scheduled agent launches. The GUI can then be closed. For a
registered remote workspace the timer and definitions live on that server, so
they do not depend on the Mac staying awake. See [Schedules](schedules.md) for
the CLI, cron semantics, observed outcomes and recovery commands.

## A workspace's machines

A window offers only the machines that run its workspace: those whose
registration reports the same workspace key as the window's deployment on this
computer (OATS CLI with `servers-per-workspace` and `server-connect`). The
spawn dialog's **Where to run** lists "This computer" and those machines; the
Workspace › Setup tab lists them with their OATS version and whether they can
be reached, with **Check** and **Remove**. Registrations whose key is not known
yet are checked once in the background after the Desktop starts.

**Add a machine to this workspace…** (the last entry of Where to run, and a
button in Setup) takes an ssh host alias, a name, the folder on that machine
and whether to install OATS there, and runs `oats server connect` from this
deployment; when the workspace uses oats.aweb for messaging, it then runs `oats
aweb connect` to join that machine to the workspace's team. Each step shows as
a row with what OATS reported, and a step that needs you says what to run
where, with a copy button. **Check again** re-runs both. The Desktop never asks
for a password or key, and never runs anything over ssh itself.

## Instances on servers

Every instance a registered server reports shows in its workspace's roster, whoever spawned it. You
can open its terminal, start, restart, stop and remove it, and read its readiness, activity, Git
and diffs, as for a local one. The context panel's Soul tab and its Messaging & Teams list read
through the server too (`oats inspect --server <id> --home <path>`), and its Work card, "model
from" line and "older build" chip show the facts the server relays. Only its pull request is not read here, since the forge reads this
computer's clones. Every command goes to the server by the instance's home (`--server <id> --home
<path>`), never by a bare name. Stop and Remove show the plan the server makes, and confirm
against it.

A read waits for the server: the view says "Reading from <server>…", and gives up after about
45 seconds with "Couldn't reach <server>." When the server refuses, you see its code and message;
nothing is read from this computer in its place. When the server's OATS, or this computer's, lacks
what a part of the panel needs, that part names the server and says which OATS to update, rather
than showing nothing. A row that can't be opened says why on the row:
Herdr no longer supported, gone from <server>, not reachable on <server>, or <server> not reached.
For an instance a server no longer lists, the reason names the command that removes it from this
computer (`oats server forget <server> --instance <name>`).

## Remote terminals

A terminal for an instance on a registered server is a viewer over ssh
(`oats session attach --server`). When the link dies, ssh ends the viewer with
exit 255 within about a minute, and the tab reconnects by itself. It keeps its
place and scrollback, stops taking input, and shows "Disconnected from
<server>" with a countdown and a **Reconnect now** button. Attempts wait 1, 2,
4, 8 and 15 s, then 30 s each for as long as the tab is open. A successful
attach resets that. Tmux redraws the screen when the viewer attaches again.

Reconnecting stops, with a message and "Close this tab", when the server
answers that the session is gone, the instance is unknown, the terminal limit
is reached or the app's backend changed, and at once when ssh cannot be run on
this computer. It stops after four attempts in a
row in which OATS on this computer gave no answer, since that is more likely
the local CLI failing than the link. It also stops when the viewer ends with
any other exit code. Closing the tab ends the reconnecting. Reconnecting
never stops or restarts the agent on the server: only the local ssh viewer
ends.

## Copy from a terminal

Drag over an agent's output to select it, as in any terminal. The selection
stays after you release the mouse. Double-click selects a word, triple-click a
line. Nothing is copied yet: copy it with ⌘C or Edit › Copy (macOS),
**Ctrl+Shift+C** (Linux and Windows), or right-click › Copy (every platform).
With nothing selected, Ctrl+Shift+C, ⌘C and Edit › Copy do nothing and leave
the clipboard as it was, and Ctrl+C still interrupts the program in the pane. Copies trim trailing spaces at line ends, as native
terminals do.

A drag selects what is on the screen. To select older output, wheel up first
(the pane scrolls back through tmux's history), then select. The wheel scrolls
as before, and a program that uses the mouse itself still receives the wheel.
It no longer receives mouse clicks or drags from the Desktop: those always
select.

Paste with ⌘V (macOS), **Ctrl+Shift+V** (Linux and Windows) or right-click ›
Paste. The text reaches the agent's draft as one bracketed paste, as before.
On Linux, a drag also sets the primary selection (untrimmed), and middle-click
pastes it (one bracketed paste), as in other Linux terminals.
Nothing in a terminal can read the clipboard.

**In your own terminal** (`oats session attach`), tmux keeps the mouse for
wheel scrollback, so a plain drag is tmux's copy mode, which copies when you
release. That copy reaches the clipboard only through OSC 52, when your
terminal allows it (an iTerm2 setting; Terminal.app has none), or through your
own tmux copy binding. For your terminal's own selection, hold **Option** while
dragging (iTerm2, Ghostty, Terminal.app) or **Shift** (most others), then copy
as that terminal does.

## Attach files and screenshots

Drop a file onto an agent terminal to insert its path into that agent's draft.
Pasting an image from the clipboard uses the same attachment path. Neither
operation presses Enter. Text paste continues to use the terminal's normal
paste behavior. A drop targets the pane under the pointer, including a visible
pane in a split.

Local files are referenced in place. Clipboard images are saved privately in
Desktop's application-data `attachments` directory and retained so an agent can
read them later. For remote terminals, Desktop calls the installed CLI's
`session upload` operation; it inserts the returned path only after the file
has reached the execution host. Both CLI installations must advertise
`session-upload`. A failed transfer leaves the draft unchanged and shows an
error in the terminal. Each drop/paste accepts up to 16 files totaling 25 MB.

## Harness badges

Roster rows, soul cards, the soul page, the context panel and the spawn
dialog show each instance's or soul's harness as a small badge, next to its
name. The badge names the harness the CLI reports; it says nothing about
whether that harness is installed or signed in. Pi's badge is the official
pi.dev press-kit mark (MIT). The Claude Code and Codex badges are OATS's own
drawings: they are not those products' logos, and OATS is not affiliated
with or endorsed by Anthropic or OpenAI. An unknown or unreported harness
shows "?". Sources and licences are in
`packages/desktop/renderer/harness-marks/README.md`.

## Security posture

- The bundled backend binds **127.0.0.1 only** and guards against DNS
  rebinding (loopback Host on every request, loopback Origin on POSTs).
  Do not expose it: it can type into your agent terminals.
- The app never imports framework code from a checkout and accepts no
  framework-root environment override; deployments are read with an
  app-owned read-only reader. All lifecycle mutations go through the
  installed CLI via `execFile` with an absolute binary — never a shell.
- Task text for spawns travels via an owner-only (0600) tempfile, never
  argv. Harvest always runs in the server-verified instance home.
- Workspace content is treated as untrusted: symlinked directories never
  widen the file API, and capability packages cannot read outside their
  own tree.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Compatible oats CLI required" card | No CLI, or a version outside the range the card itself states. Copy the card's install command, or **Choose oats…** to point at the right binary; **Retry** re-probes. Spawn is disabled until a compatible CLI is verified. |
| Spawn disabled, no card | The probe hasn't settled yet (transient, resolves in ms). If it persists, the backend is unreachable — restart the app. |
| Terminals fail to open ("could not attach") | tmux missing, or no live session for that instance. Install tmux (`tmux -V`); check `tmux -L oats ls` (the OATS tmux server, where instances run) and `tmux ls` (your default server, where an instance started by an earlier kernel may still be). |
| Can't select/copy text in a terminal tab | A plain drag selects, and copying is a separate step: ⌘C / Edit › Copy (macOS), Ctrl+Shift+C (Linux/Windows) or right-click › Copy ([Copy from a terminal](#copy-from-a-terminal)). A drag selects only what is on screen: wheel up first for older output. In `oats session attach` in your own terminal, hold **Option** (iTerm2, Ghostty, Terminal.app) or **Shift** while dragging. |
| macOS "app is damaged / can't be opened" | Ad-hoc-signed (not notarized) build + quarantine. Right-click → Open, or clear the quarantine attribute (above). If it persists, verify the bundle: `codesign --verify --deep --strict --verbose=2 "/Applications/OATS Desktop.app"` — a non-zero exit means a broken artifact, report it. |
| Roster empty | The opened directory isn't an OATS deployment (it needs `oats-local.yaml` and `agents/`). Use the workspace switcher → Add workspace to select the right folder. |

For bugs, attach the terminal output of the app (`OATS Desktop` prints
server and CLI-discovery logs to stdout) and your platform/arch.

## Building from source

Developer docs live in [`packages/desktop/README.md`](../packages/desktop/README.md)
(run, architecture, view contract) — packaging is `npm run dist`
(electron-builder; macOS ad-hoc signed — not Developer ID, not notarized —
certificate auto-discovery disabled) and
`npm run dist:smoke` verifies the packed artifact. Build/release CI uses the
marked build-verify mode (inventory + strict codesign verification +
node-pty ABI, no GUI launch); a local
interactive run may also exercise the launch phase.
