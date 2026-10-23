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

On Linux the installers need glibc 2.34 or later (for example Ubuntu 22.04,
Debian 12, RHEL 9 or later). That is what their files ask of the system, read
from each build, which fails if a file needs more; it is not a list of systems
the app was tested on.

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

The AppImage mounts itself with FUSE, which some current distributions
don't install. Without it, start the AppImage with
`--appimage-extract-and-run`. Don't extract the image and run its `AppRun`
yourself: started that way, Desktop can't tell which entries in `PATH`,
`XDG_DATA_DIRS`, `LD_LIBRARY_PATH` and `GSETTINGS_SCHEMA_DIR` the image
added, so the programs it starts keep them, among them the tmux server it
starts and every agent pane on it (see
[the environment of the programs Desktop starts](../packages/desktop/README.md#the-environment-of-the-programs-desktop-starts)).

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

## Updating

Installing a new version doesn't change a Desktop that is already running: an
AppImage runs from its own mount, and a DEB or another copy of the app hands
its launch to the running app, which opens or focuses a window and carries on
in the old version. To switch, quit Desktop (close every window) and open it
again.

From this version on, a launch of a different version says so: the running
Desktop opens or focuses the window as usual, then asks whether to **Restart
into** the version you opened, naming the file it starts, or **Keep** the
running one. Restarting closes Desktop's windows and starts the version you
opened; your agents keep running in their sessions. When the copy you opened can't be found again (its file was
moved or removed), the message only tells you to quit and open it again. Both
copies must be this version or later: a running Desktop older than this one
can't tell you, and neither can a launch of one.

## Opening a workspace

The app opens the workspaces you had open, plus the directory it was
launched with (`--dir`, or the folder it was started from) when that is an
OATS deployment — the directory (the operator's choice) holding
`oats-local.yaml` and `agents/`. A folder that is not a deployment is never
opened: started from Finder, with nothing open to restore, the window shows
"Choose a workspace" and opens **Add local workspace…** (the **+** at the top
of the sidebar). The dialog lists the deployments on this computer that are
not open: those on this computer's deployments list (`oats deployments`, see
[Workspaces](workspaces.md)) and a saved one. Click one, or press Enter on it,
to add it and open it in this window. **Browse…** points it at any other
deployment.
A picked folder without `oats-local.yaml` is offered onboarding instead. The
Desktop never parses the deployment: its members, lock state and header come
from `oats workspace status`, and its instances from the deployment's one
`agents/` root.
Every deployment you open (an add, or the one the app was launched on) is
put on this computer's deployments list, so it is offered next time. The first launch of this Desktop moves its own list of
recently added workspaces there, once.
**Browse** opens in the folder holding the workspace most recently added or
opened, or your home directory when there is none (never ~/Downloads);
**Choose oats…** opens in the directory of the chosen or discovered CLI.

Launch flags for scripted use: `--dir <workspace>` and `OATS_DESKTOP_PORT`.

### One window per workspace

Each workspace has at most one window, titled with the workspace's name (a
workspace on a server: `name — server`).

- **Switching.** Picking a workspace in the sidebar's list shows it in the
  current window. If another window shows it, it moves to this window, and the
  other window shows another workspace ([A workspace another window
  shows](#a-workspace-another-window-shows)). No other window comes to the
  front.
- **Open in new window.** A workspace's row in the list opens it in its own
  window from its context menu (a right-click, or Shift+F10 or the Menu key),
  or with ⌘Enter on macOS / Ctrl+Enter on Linux and Windows. A workspace that
  already has a window is brought to the front.
- **New Window.** On macOS, **File → New Window** (⌘⇧N); everywhere,
  **Window: new window** in the command palette. The new window has no
  workspace yet: it shows "Choose a workspace" and focuses the list of
  workspaces until you pick one. It reads nothing until then.
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
  other launch brings the most recently used window to the front. A launch of
  another version also offers to restart into it ([Updating](#updating)).
- **Closing.** Closing a window leaves the other windows, and their
  terminals, running. Closing the last window quits the app.
- Tabs belong to their window: a workspace's terminals and tabs stay in the
  window they were opened in, and switching that window back to the
  workspace brings them back. A window whose workspace another window takes
  over closes its tabs of that workspace.
- A tab's terminal ends ("session ended") when its instance's tmux window
  goes, whatever your tmux `detach-on-destroy` setting: a tab never shows
  another instance's terminal. Stopping an instance leaves its tab open.
- When a roster read shows an instance retired, from the Desktop, the CLI,
  another agent or another machine, every tab of that instance closes, in
  every split. In each split the next tab (or else the previous one) becomes
  active, and the focus moves to it only if it was in a closed tab. A
  workspace that isn't shown closes them the next time its roster is read.
  An instance respawned under the same name is a new instance: opening it
  opens a new tab.

## Workspaces

The sidebar has two sections: **Workspaces**, a heading over the list of
workspaces, then, after a thin line, the current workspace's: its two main
views, **Workspace** and **Deployments**, side by side, then **Instances**,
a heading over its list. The two headings are the sidebar's largest type,
above the smaller machine labels ("THIS MAC") in the list of instances; the
workspaces' names are a little larger than body text. In a sidebar too
narrow for both labels the views show their icons alone, each named in its
tooltip. A window opens on the **Workspace** page: at launch, and after you
choose a workspace for it. **Spawn instance** is the **+** at the end of the **Instances**
heading, after the running count. The headings' **+** buttons, the
workspaces' needs-input marks and the instances' harness marks line up in
one column at the sidebar's right edge. The bottom bar shows the OATS mark
at its left, and at its right the sidebar toggle (**Hide the sidebar**) and
the settings cog, whose menu holds **Theme…** and **Keyboard shortcuts…**,
each with its shortcut. Connections is in the command palette (**Settings:
Connections…**), and the palette opens with its shortcut or Ctrl+X then `k`.
The instances have no search field: to find one by name, type it in the
command palette, which opens its terminal. ⌘F / Alt+F (**Focus the
instance roster**) and `/` in the sidebar go to the roster's current row;
on an empty roster, to its one action, **Spawn instance +**, where F6 lands
too (a failed read's **Retry** comes first).

The list of workspaces is always shown. Its heading holds **Add local
workspace…** (the **+**). The list has one row per workspace this window can show, whatever
machine it is on: every workspace the Desktop serves, those only on servers
included, and the deployments no workspace matched ([One workspace, several
machines](#one-workspace-several-machines)), after them in the same list.

With one workspace the list is one compact row. With many it scrolls within
about six rows, the current row stays in view, and while rows are cut off
below, a line under the list says how many ("2 more below"), with the
needs-input mark at its right when one of them has an instance that needs
input.

**Show only the current workspace** is the toggle before the **+** in the
heading, for working in one workspace at a time. Pressed (its icon in the
accent colour), the list shows the current workspace's row alone. Nothing
stands for the others: no "N more" line, and no needs-input mark for one of
them that waits. Press it again, or use ⌥⇧⌘O on macOS / Ctrl+Alt+Shift+O on
Linux and Windows (the same in every chord family, and from a terminal) or the
palette's **Show only the current workspace**, to see every workspace again.
Ctrl+X then ↑ / ↓ still move to the previous / next workspace, which then
shows alone. A window choosing a workspace shows them all. The choice is remembered on this
computer.

- **A row is one line: a circle and the workspace's name.** No icon, no
  machine, no state: a workspace's own pages show its machines and
  deployments. The circle is the one an instance row has, in the same place.
  A long name ends in an ellipsis, and the row's tooltip is the whole name.
- **The current workspace** has its circle filled, like a running
  instance's, and its name in bold; the others have the ring a stopped
  instance has. It has no background of its own: the selection's background
  marks the current page (Workspace or Deployments), so the
  sidebar fills one "you are here" row. A screen reader hears it as current,
  and the list's description names it, by the same name as its row.
- **The needs-input mark.** A row has an exclamation mark (a small amber
  disc with a "!") at its right end when an instance of that workspace needs
  input, the same mark an instance's **Needs input** pill starts with: the claim the instance roster shows
  for that instance, from a running session (OATS with the `waiting-on-you`
  feature), as the Desktop already reads it for the workspaces it serves.
  Every row can have it, the current one included. The row's name then ends
  in ", needs input" for a screen reader, and its tooltip says "An instance
  here needs input". What isn't known shows no mark, never a guess: a
  deployment that isn't live (stale, not reached, its last read failed) and
  an oats without `waiting-on-you`. The mark never moves a row: the order
  stays the same whoever waits.
- **Picking a row** (a click, Enter, or the leader's ↑ / ↓, Ctrl+X then ↑ /
  ↓, which are also ⌥↑ / ⌥↓ on macOS and Alt+↑ / Alt+↓ on Linux and Windows
  in the Alt family, the default) shows that workspace in this window, with its own tabs, layout and
  selection; one another window shows moves here ([A workspace another window
  shows](#a-workspace-another-window-shows)). The leader's ↑ / ↓ go to the
  previous / next row, and stop at the ends ("No workspace above this one." /
  "No workspace below this one."). Each is a pick, so walking the list with
  them moves every workspace it passes that another window shows into this
  window.
- **Open in new window** is in a row's context menu (a right-click, or
  Shift+F10 or the Menu key), and ⌘Enter on macOS / Ctrl+Enter on Linux and
  Windows does it from the keyboard. It opens the workspace in its own window,
  or brings the window that shows it to the front.
- **Keyboard.** The list is one Tab stop, Up/Down/Home/End move in it, and
  `w` in the sidebar, Ctrl+X then `o`, ⌥⌘O / Alt+O and the palette's
  **Workspace: switch…** focus it. The full keys are in [the keyboard
  reference](../packages/desktop/docs/desktop-keyboard.md#the-list-of-workspaces).

**Add local workspace…** lists the deployments on this computer that are not
open: those on this computer's deployments list and a saved one. Each is one
button: a click, or Enter on it, adds it (checked first) and opens it in this
window; a failure says why in the dialog, with focus back on it. The dialog
counts these alone ("2 workspaces to add"). After them, under **Can't be
opened**, come the rows of this computer's list that can't be opened, each
saying why in a word, and they open nothing: **Missing** (the folder is gone, or its volume
isn't mounted), **Not a deployment** (no `oats-local.yaml` any more), or
**Can't be checked** (OATS couldn't read the folder). The full sentence is the
row's tooltip and what a screen reader hears. **Remove** beside such a row
takes it off the list (Right Arrow, then Enter, from the keyboard); nothing on
disk changes. With an oats that has no deployments list, the dialog offers the
saved deployments alone and says "This oats can't list this computer's
deployments. Update oats."; a list read that failed says "Couldn't read this
computer's deployments:" and why. **Browse…** chooses any other folder, and one without
`oats-local.yaml` is offered onboarding.

A window with no workspace (a New Window, or one whose workspace moved to
another window) shows "Choose a workspace" and focuses the list. When the
Desktop serves no workspace at all, so the list is empty, it opens **Add local
workspace…** instead. Closing the dialog leaves "Choose a workspace", whose
button opens it again.

### A workspace another window shows

Picking a workspace another window shows moves it to this window: a pick from
the list, the workspace select of
Deployments or Workspace, and a spawn whose new instance is in that workspace.
Nothing else comes to the front. The other window lets the workspace go: it
shows the workspace it showed most recently before that one among those the
Desktop still serves and no other window shows, else no workspace ("Choose a
workspace"). It closes every tab it had of the workspace that moved. The
Desktop waits at most 2 seconds for the other window; one that answers late
ends the same way, and so does one that was still opening or reloading:
once it comes up it shows no workspace, never the one that moved. **Open in
new window** still brings the other window to the front instead.

Only the terminals and the split move with the workspace: this window opens
the same terminal tabs in the same split, each with a fresh viewer, and the
agents keep running. File, brain and view tabs do not move: they close in the
other window.

## Capabilities and spawning

**Workspace › Capabilities** is in two parts, each with its title:
**Workspace defaults** (below), then **All capabilities**, what the
workspace offers. Under the **All capabilities** title, a row of segments
jumps to its three sections: **Workspace owned** (from the member repos, for every soul),
**Repo owned** (only for souls of the same repo) and **Packages** (pinned
versions). Workspace owned and Repo owned are grouped by the repository
that defines each capability. The groups are headed like the Souls tab:
repo name, then "member repo · host · N capabilities". The host repository
comes first, then the others by name; capabilities from outside the member
repos come last, under **external**. At the top right of Workspace owned,
pills (**All**, then one per repository, each with its count) show one
repository at a time; "N of M shown" appears while a pill or the search
narrows the list.

Above All capabilities, **Workspace defaults** shows what every soul of the
workspace starts with, unless it turns one off. It is one panel with two
groups. **Core capabilities** (at most one of each per soul) is always
**Knowledge**, **Messaging** and **Tasks**. **Additional capabilities** (any
number per soul) lists the other capabilities the workspace gives every soul,
or says there are none. Each default is shown the same way: its tile, the
capability and its source (a package and its pinned version, or a repository
and "latest"). Click it to open the capability's page. An empty core slot
shows **None**: there is no workspace default, and each soul chooses its
own. A core capability the workspace names among its other defaults, rather
than in its slot, is shown under Core, in that slot, as the kernel fills the
slot with it. An additional default the workspace turned off is struck through and
says "turned off by the workspace". A workspace that sets no defaults, a
standalone deployment for example, shows one line saying so. The search and
the repository pills never narrow or hide this section. It is read from
`oats workspace status --json`: an OATS that does not report the defaults
shows no such part, and the Desktop does not guess them from the souls. The
defaults have no segment of their own: the segments are All capabilities'.
Teams add no capabilities (removed in 0.30), so there are no team defaults
to show.

The round **i** button in the toolbar, beside the search (**About capabilities**), opens
**What capabilities are**: what a capability gives a soul's instances (skills,
commands and instructions, the instructions injected into each instance's
composed `AGENTS.md` after the soul's own), the three places one comes from
(Workspace owned, Repo owned, Packages), which three capabilities are core
(knowledge, messaging and tasks, at most one of each per soul) and that every
other one is additional, and what workspace defaults are and why they
matter: every soul gets them, they give an organisation's agents one shared
way of working, and a knowledge default keeps what agents learn and the
procedures the organisation writes down for later instances; a soul can turn
one off and name its own in its place.
**Close** or Esc closes it and returns the focus to the button; leaving the
tab or the workspace closes it too. **Workspace › Souls** has the same button
at the end of its toolbar, **About souls**, which explains what a soul is.

A soul's page (open a soul from **Workspace › Souls**) ends with
**Instructions**, what its instances are told, read like a capability's
injected instructions (a navigation tree on the left, the file on the right).
The tree has two sections, a rule between them:

- **Defined in this soul**: its own `AGENTS.md`, at its path in the soul's
  repository, and, with an OATS that reports a soul's skills, its **Skills**.
  Open a skill to list its files; a file opens in the reader under its
  repository path.
- **Composed for an instance**: what an instance of this soul gets. Its
  **AGENTS.md**, *after spawn, with injects*, and its **Skills**, each saying
  where it comes from. With an OATS that lists every skill a spawn gives the
  instance (0.67.0 and later), the Skills are that list: the soul's own, each
  **From this soul**, and the ones its capabilities add, each **From** the
  capability. A capability's skill file opens under its place in the instance
  home (`.oats/modules/<capability>/…`), with **Open capability** above it. With
  an older OATS the skills listed are the soul's own, and a note says that the
  skills capabilities add are listed by a newer OATS. For a soul on another
  machine, the server's OATS must list them too, as for the composed
  AGENTS.md below.

Both come from the same inspection as the rest of the page, so **Refresh**
re-reads them and keeps what you had open, and your place in it. A file over
200,000 characters is shown cut, and says so.

The composed **AGENTS.md** needs an OATS that composes a soul's instructions
(0.46.0 and later). It is the file a spawn of this soul on this computer would
write, with one entry per part (the soul's own text, then each block OATS and
the soul's capabilities add, in order). Open it to read the whole document;
choose a part to go to it. Each part's header says where it comes from
(**From this soul** or **Injected by …**) and names its file; a capability's
part has **Open capability**, and **Copy composed AGENTS.md** copies the exact
file. When the soul can't be composed here, the section says so and the problem
shows at the top of the page. For a soul on another machine (a server
workspace), the page shows the composed file when that machine supports it:
this computer's OATS must be 0.49.0 or later, to pass on what each server
reports about itself, and the server's OATS must say it composes a soul's
instructions (0.49.0 and later report this). Until a server reports it (an
older server, or one whose last read failed), its soul pages show no composed
**AGENTS.md**. A soul's skills follow the same rule, with the server's OATS
saying it reports them.

The **Spawn** dialog's left column, **What will be created**, starts with the
new instance's name and its home. Then come where it works, its harness and
model (with where that choice came from), its default team and the teams it may
also join, and its relationship when it has one. Under them are its core
capabilities and its other capabilities.

The dialog's first field is the **Opening instruction**, and the dialog opens
with the cursor in it (after a restored instruction's text). In a narrow window,
**What will be created** comes after the form's last field, above **Spawn**:
scroll down with the fields to read it.

The dialog's last field before **Developer settings** is **Name · optional**.
Left empty, the kernel numbers the new instance (`<soul>-<n>`). A name you type
is used in lowercase and gets the soul's role, the last word of the soul's
name, as its suffix:
`desktop-improvements` for `oats-desktop-expert` becomes
`desktop-improvements-expert`. A name that already ends in the role, or is
the role, stays as typed. The line under the field shows the final name, and a
name that is too long, invalid or already taken is explained there. A spawn
on a server takes the exact name the same way when that machine's OATS can
take one (feature `spawn-name`, read from its last roster answer), and its
name is explained there too when that machine refuses it. With an OATS older
than 0.26.0 on either side, which can't take an exact name, or a server whose
OATS this computer has not heard from, what you type is a purpose instead: the
instance is named `<soul>-<purpose>`, and the field shows that prefix.

**Named from its task.** When the installed OATS can suggest names (feature
`spawn-suggest-name`), the help under an empty Name reads "Left empty, the
instance is named from its task." Once the Opening instruction holds at
least seven words, the Desktop asks OATS for a name as you type. The soul's
own harness reads the instruction and replies with a short name for the work,
and the role is added as its suffix. The name shows as the field's
placeholder ("release-notes-manager"), on the line under the field ("(from
the task)") and in **What will be created**. It belongs to the instruction it
was made for: when you change the instruction it goes, and the Desktop asks
again for the new instruction while it holds seven words or more. Typing in
Name replaces it and stops suggestions for the rest of the dialog, even if
you empty the field again. Press **Spawn** with Name empty and no name yet, and the
dialog says **Naming…** and asks once, however short the instruction. When OATS
can't name it, the instance is numbered and a notification says why, for
example "Named oats-desktop-expert-3: naming took longer than 20 seconds."
That happens when there is no instruction, when the harness doesn't suggest
names (Codex), when there is no answer within 20 seconds, when the harness
couldn't be asked, and when its reply wasn't a name. Each request is a call
to the harness's model: nothing is asked before you type, and nothing runs on
a timer.

A spawn on a server whose OATS takes an exact name is named from its task the
same way, with one difference: the name is chosen on this computer. The
Opening instruction is sent to this computer's harness and model, as for a
spawn here: the Harness you chose, else the soul's default on that server,
else Claude Code, with this computer's launch configuration for it. That needs
an OATS here that can name a spawn for another machine (feature
`instance-suggest-name`). When it can't, or the name couldn't be chosen here,
the server names the instance itself from its task if its OATS can (feature
`spawn-apply-suggest-name`): the help reads "Left empty, the instance is named
from its task on <server>." Otherwise the server numbers it, and the help reads
"Named by <server> when it spawns." Naming never stops a spawn on a server.
When the instance is numbered where it would have been named, a notification
says why, as for a spawn here. A name chosen here is not checked on the server
until the spawn: one that is already taken there is refused, and explained
under the field.

When capabilities set up the new worktree (OATS 0.49.0 and later), **Setup**
names them, in the order they run, and says this can take several minutes. Such
a spawn may run for a long time: its roster row reads **Setting up worktree…**
until the worktree is ready, and offers no actions meanwhile. If the spawn was
interrupted or a capability couldn't set up the worktree, the spawn was rolled
back, and the notification says that nothing was created. A home whose spawn
didn't finish its cleanup reads **Spawn didn't finish**, and offers only
**Retire instance…**, which completes it. A server spawn whose worktree hooks take
more than about a minute is not yet supported from the Desktop; use the CLI on
the server. Every dropdown in the app has the
same themed look, and its open list follows the light or dark theme.

## Stopping and retiring

The Desktop runs one stop or retire at a time for its own requests. Another
program using OATS at the same time, such as the `oats` command or the
terminal client, is held off by OATS itself: from OATS 0.52.0, a stop and a
retire of one instance refuse each other before doing anything. A start does
not yet see a retire in progress.

If the Desktop's backend restarts while a confirmation is open, its plan is
gone: Stop or Retire then answers that the plan expired, and Review again
reads a new one.

A stop, retire or start runs in a process of its own, so closing the Desktop
does not interrupt it. If a stop or retire takes longer than ten minutes, the
dialog stops waiting and says the result is not confirmed; it keeps running,
and Check again reads its result. If a start or restart takes longer than 60
seconds, the Start dialog stops waiting and says the start is not confirmed;
the start keeps running, and the roster shows its result.

With an OATS older than 0.52.0, after an interrupted stop the instance can be
started and then cannot be stopped while `.oats-stop-pending.json` exists in
its home.

**A retire in progress reads Retiring…, never as a failure.** An instance's
roster row reads **Retiring…** while:

- OATS reports its retire running, or cannot tell whether the process
  holding the retire still runs;
- its OATS does not report a retire's state yet (no `retire` on the row)
  and the instance has a retire pending;
- the Desktop's own retire of it was sent and the roster has not been read
  since its answer came. A retire that OATS refused, or whose plan had
  changed, runs nothing, and the row reads as the roster says at once.

A retiring row offers no Start, Stop, Restart or Open, and no inline
button. **Retire instance…** stays in the row's menu, after its usual
confirmation: OATS refuses a second retire while one runs, and when the
holder can't be read it may be the only way on.

When the retire has ended without finishing, the row says so and offers only
**Retire instance…**, which finishes it:

- **Retire failed**: a self-retire's completion recorded an error. Its
  reason is OATS's own message, with its code, shown through the same
  display filter as every other text from OATS (control characters and
  line breaks never reach the screen, a long message is cut, a message that
  looks like a secret is withheld). With a code and no message, the reason
  is OATS's code, shown the same way.
- **Retire didn't finish**: a scheduled completion is gone and left no
  outcome.

## One workspace, several machines

The list of workspaces has each workspace once, however many deployments it has: the
deployments you opened on this Mac and those your registered servers report,
matched by the workspace each one reports (its repository key and default
team, by the kernel's rules). It needs a CLI with the `workspace-identity`
feature (OATS 0.36.0); without it each deployment has its own entry.

- **Deployments.** The **Deployments** page (formerly the Active overview)
  shows the workspace's overview trees. **All** stacks one section per
  deployment, each headed by its machine and folder ("This Mac ·
  ~/acme", "altair · ~/northwind"). Then each deployment has a tab of
  its own, named by its machine ("altair"; "This Mac · oats-v2" when this Mac
  holds two). A workspace with one deployment shows just that deployment's
  tab. The tab you chose is remembered per workspace. The round **i** after
  the tabs, **What is a deployment?**, explains in plain words what a
  deployment is (click it, or Enter or Space on it; Esc or Close closes it). With two or more
  deployments, the sidebar's instance list is grouped under one heading per
  machine; with one, it has no headings.
- **An instance's card.** Clicking an instance on the Deployments page shows
  what it reports and two buttons. **Go to instance** opens its terminal tab;
  for a stopped instance it reads **Start…** and opens the Start dialog.
  **Go to soul** opens the soul it was spawned from on the Workspace page. It
  is disabled, and says why, when that soul can't be told or shown exactly:
  the instance records none, it is no longer among the deployment's souls,
  several match, another soul of the deployment has the same name, or the
  instance is on a deployment other than the one the Workspace page shows. Restart with… stays in the instance's menu and its panel.
- **Not shown live.** A deployment that can't be shown live says why in a few
  words on its heading ("ssh needs a prompt", "Timed out", "OATS too old to
  report its workspace"), and **How to fix** under it gives the full sentence
  and the steps. Causes: ssh needs a prompt or a host key, the read timed out,
  the host's OATS is too old to report its workspace, its workspace reference
  needs `oats sync` or fixing in `oats-local.yaml`, or this computer's OATS
  can't read other machines. A server that can't be reached stays under the
  workspace it last reported, marked "remembered".
- **The list of workspaces.** Each workspace names its machines on one line ("This Mac ·
  altair"), with a mark when one of them isn't live.
- **Not matched to a workspace.** A deployment that can't be matched is
  listed on its own under that heading in the list, with its machine and
  a short reason; choosing it opens its tab on the Deployments page. When this
  computer's OATS is too old to report workspaces, nothing can be matched:
  each deployment is listed on its own, as before, and its heading says to
  update OATS.
- **Actions.** Everything you do to an instance goes to that instance's own
  deployment. Workspace-wide pages (Setup, Capabilities, Sync, Automations,
  Schedules, Teams configuration) act on the workspace's first deployment on
  this Mac, else its first. No Workspace page names it: not Souls,
  Capabilities, Automations, Teams or Setup, nor a soul's, a capability's or
  a team's page. The side panel names it ("On This Mac · ~/acme", under a
  soul's name) when there are two or more, as do Brain and the Sync sheet,
  and the Deployments page shows each deployment on its own tab.
- **Spawn.** With two or more deployments, the Spawn dialog asks first which
  one to spawn in (and says "Runs on" in its summary), starting on the one you last used in that workspace when it
  offers the soul, else the first that does (this Mac first). With one, it
  asks nothing.

Saved selections and tabs move to the workspace that holds their
deployment. Details are in
[the deployment model](../packages/desktop/docs/desktop-deployment-model.md#workspace-views-and-deployments).

## Scheduling agents and wake messages

Open **Workspace › Automations › Schedules** in the selected workspace (⌘3 /
Ctrl+3 lands on Automations) to launch a new agent on a cron,
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

A trigger can take its events from a source a capability declares instead of
GitHub pull requests (OATS 0.50.0 or later). Its page shows the source and
what the trigger passes to it, what the source's last poll found or why it
failed, and which events OATS refused or the source skipped. Text that comes
from the source, from the trigger's file or from the capability's manifest is
shown as a quote with a line saying whose it is; it is never a link or a
button. **Test** on a pull-request trigger reads GitHub and reports what would
fire. **Test** on such a capability trigger runs the capability's source
command on this computer, so it first shows what will run and with which
parameters, and runs it once only when you press **Run test**. Nothing is
recorded or spawned, and testing does not trust or start a trigger that this
computer doesn't trust.

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

## A workspace's teams and setup

The Workspace › **Teams** tab has one card per team. Under its description,
**Default for** says whose default the team is: all souls of a repository, a
single soul, or every soul without its own default for the default team. **May
join** says who else may join it. Both are read from the workspace's committed
`souls:`; a team nobody may join yet says so. The address (the team on the
messaging provider) and the members running in it follow.

The **Setup** tab's List view is one column. Under the workspace's name, one
line counts its members (and those that need attention), its packages and the
state of the lock. The next line says where the workspace is declared. An
**Overview** says that the workspace's **host**, the repository that holds
`oats-workspace.yaml`, defines the workspace: its member repositories and its
packages. **For developers** (folded) explains how a repository becomes a
member and what each member state means. Then **Shared through Git** lists
what the workspace declares (Members, with the host first and tagged
**Host**, Packages and Defaults). **This computer** lists what is not shared:
this deployment's settings, lock, CLI and instances, the member clones, and
the machines that run the workspace.

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

**Which machines the Desktop reads.** One roster read serves every window. With
an OATS CLI that lists the `roster-workspace-key` feature, it reads only the
machines of the workspaces your windows show: those registered for one of
them, those whose workspace is not known yet, and those known only from a
saved route. A machine registered for a workspace no window shows is not
contacted, so a machine that is switched off no longer slows every window's
roster. Opening a window on another workspace reads its machines at once. Until
it does, that workspace's machines are shown as they were last read, marked
stale, and the list of workspaces still lists them, not counted live. The read covers every machine again while a window
has no workspace, and on the first read after the Desktop starts. With an
older CLI, every registered machine is read, as before.

## Instances on servers

Every instance a registered server reports shows in its workspace's roster, whoever spawned it. You
can open its terminal, start, restart, stop and retire it, and read its readiness, activity, Git
and diffs, as for a local one. The context panel's Soul tab and its Messaging & Teams list read
through the server too (`oats inspect --server <id> --home <path>`), and its Work card, "model
from" line and "older build" chip show the facts the server relays. Only its pull request is not read here, since the forge reads this
computer's clones. Every command goes to the server by the instance's home (`--server <id> --home
<path>`), never by a bare name. Stop and Retire show the plan the server makes, and confirm
against it.
When this computer's OATS advertises `server-probe-features` (0.49.0), each server's roster group
also carries the features of the server's own OATS, as its `oats status` reports them
([`probe.features`](desktop-cli-api.md#the-remote-roster-oats-server-roster---json)); a server
before 0.49.0 reports none, so they read as unknown.

A read waits for the server: the view says "Reading from <server>…", and gives up after about
45 seconds with "Couldn't reach <server>." When the server refuses, you see its code and message;
nothing is read from this computer in its place. When the server's OATS, or this computer's, lacks
what a part of the panel needs, that part names the server and says which OATS to update, rather
than showing nothing. A row that can't be opened says why on the row:
Herdr no longer supported, gone from <server>, not reachable on <server>, or <server> not reached.
For an instance a server no longer lists, the reason names the command that removes it from this
computer (`oats server forget <server> --instance <name>`), and the row offers **Forget…**, in its
actions menu and in the context panel, which runs that command for that row after a confirmation.
Only this computer's saved route goes; nothing changes on the server, and the roster is read again.

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

A remote instance's tabs close only when its server answers without it
(retired there, or gone from it), never because the server can't be reached
or its roster read is out of date.

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

## The sidebar's instance tree

The sidebar lists a workspace's instances as a tree: a child sits one step
right of its parent, and related instances are grouped together. Siblings are
joined by a dotted line through their dots. A parent's line to its children
runs just to the right of the dotted line, so the two never merge.

## An instance's colour

An instance can have a colour, one of the soul palette's six (Sand, Sage,
Slate, Mauve, Clay, Olive). Its dot shows it wherever the instance is listed:
the sidebar, its terminal tab, the command palette and the overview. A running
instance's dot is filled with the colour, a stopped one's is a ring in it. An
instance whose state is unknown keeps the warning dot, and one without a colour
looks as before. The shape says the state, never the colour alone.

To set it, open **Instance: name and colour…** from the command palette, or
press Alt+R (⌥⌘R on macOS; Ctrl+Alt+R in the Ctrl+Alt family). It acts on the instance of the terminal you
are in, else the focused sidebar row, else the active terminal tab's instance.
The dialog shows the instance's name, which can't be changed yet, and the
colours as buttons: **None** and the six. Arrow keys move between them; Enter,
Space or a click sets the colour at once, and **Saved.** or OATS's refusal
appears under the title. The dialog stays open until you close it.

The colour is the instance's own, kept in its home by OATS
(`oats instance color`). Setting one needs OATS 0.67.0 or later on this
computer, and for an instance on a server, on that server too; until then the
buttons are disabled and the dialog says which is missing. An instance whose
home is being spawned or retired can't be given a colour meanwhile.

## Identity marks and harness badges

Souls, capabilities and workspaces carry a coloured two-letter mark beside
their name. It is decorative: the name beside it is authoritative. The letters
come from the name without its package qualifier (what follows the last `/`
or `--`), and from three words or more without its first (a namespace word like
`oats`): the initials of the first two words, or a one-word name's first two
letters. So `oats-desktop-expert` is DE, `oats-okf--knowledge-harvester` KH and
`oats.aweb` OA. Two names can share a mark (`oats-expert` and
`oats-operator-expert` are both OE); the name and the colour tell them apart.

Roster rows, soul cards, the soul page, the context panel and the spawn
dialog show each instance's or soul's harness as a small badge, next to its
name. The badge names the harness the CLI reports; it says nothing about
whether that harness is installed or signed in. Pi's badge is the official
pi.dev press-kit mark (MIT), and Claude Code's is Anthropic's Claude spark
in the theme's colours. The Codex badge is OATS's own drawing, not OpenAI's
logo. OATS is not affiliated with or endorsed by Anthropic or OpenAI. An
unknown or unreported harness shows "?". Sources and licences are in
`packages/desktop/renderer/harness-marks/README.md`.

## Security posture

- The bundled backend binds **127.0.0.1 only** and guards against DNS
  rebinding (loopback Host on every request, loopback Origin on POSTs).
  Do not expose it: it can type into your agent terminals.
- The app never imports framework code from a checkout and accepts no
  framework-root environment override; deployments are read with an
  app-owned read-only reader. Lifecycle actions run the installed `oats` CLI
  by its absolute path, never through a shell: reads with `execFile`, and a
  stop, retire or start as a process in its own session.
- Task text for spawns travels via an owner-only (0600) tempfile, never
  argv. A local start or restart launches only in the server-verified
  instance home. A provider operation on an instance (its harvest included)
  is addressed with `--home` to a home the server's roster reports, and one
  on a soul to a soul and agents root the server lists, never a path the
  caller names.
- Workspace content is treated as untrusted: symlinked directories never
  widen the file API, and capability packages cannot read outside their
  own tree.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Compatible oats CLI required" card | No CLI, or a version outside the range the card itself states. Copy the card's install command, or **Choose oats…** to point at the right binary; **Retry** re-probes. Spawn is disabled until a compatible CLI is verified. |
| "This Desktop is older than the installed oats CLI" card | The CLI found is a released version above the range this Desktop works with, usually because the CLI was updated first. Install OATS Desktop of the version the card names; the card offers no npm command, since installing the CLI this Desktop pins would downgrade it. Reads and terminals keep working meanwhile; **Choose oats…** points at another, compatible CLI and **Retry** re-probes. |
| Spawn disabled, no card | The probe hasn't settled yet (transient, resolves in ms). If it persists, the backend is unreachable — restart the app. |
| Terminals fail to open ("could not attach") | tmux missing, or no live session for that instance. Install tmux (`tmux -V`); check `tmux -L oats ls` (the OATS tmux server, where instances run) and `tmux ls` (your default server, where an instance started by an earlier kernel may still be). |
| Can't select/copy text in a terminal tab | A plain drag selects, and copying is a separate step: ⌘C / Edit › Copy (macOS), Ctrl+Shift+C (Linux/Windows) or right-click › Copy ([Copy from a terminal](#copy-from-a-terminal)). A drag selects only what is on screen: wheel up first for older output. In `oats session attach` in your own terminal, hold **Option** (iTerm2, Ghostty, Terminal.app) or **Shift** while dragging. |
| macOS "app is damaged / can't be opened" | Ad-hoc-signed (not notarized) build + quarantine. Right-click → Open, or clear the quarantine attribute (above). If it persists, verify the bundle: `codesign --verify --deep --strict --verbose=2 "/Applications/OATS Desktop.app"` — a non-zero exit means a broken artifact, report it. |
| Log says `server on 4820 — this app's server at version X (this app is Y), not started by this app — left running — starting a dedicated one on 4821` | Another OATS Desktop server holds the default port: another installed version or a dev checkout that is running, or one an earlier Desktop left running. The app serves from the port it names and never stops a server it did not start. From 0.49.0 a server the app starts exits when the app ends, however it ends (quit, crash or kill). A server left by an earlier Desktop (seen on Linux, where it outlived the app in its own `app-…scope`) must be stopped once by hand: find it with `ss -ltnp 'sport = :4820'` (or `lsof -iTCP:4820 -sTCP:LISTEN` on macOS) and stop that pid, or its scope (`systemctl --user stop <scope>`), then restart the app. |
| Roster empty | The opened directory isn't an OATS deployment (it needs `oats-local.yaml` and `agents/`). Use **Add local workspace…** (the **+** at the top of the sidebar) to select the right folder. |

For bugs, attach the terminal output of the app (`OATS Desktop` prints
server and CLI-discovery logs to stdout) and your platform/arch.

## Building from source

Developer docs live in [`packages/desktop/README.md`](../packages/desktop/README.md)
(run, architecture, view contract) — packaging is `npm run dist`
(electron-builder; macOS ad-hoc signed — not Developer ID, not notarized —
certificate auto-discovery disabled) and
`npm run dist:smoke` verifies the packed artifact. Build/release CI uses the
marked build-verify mode on every leg (inventory + strict codesign
verification on macOS + on Linux the glibc floor, every ELF file of the DEB
and the AppImage read against the version the Install section states, held in
`packages/desktop/scripts/linux-floor.json` + node-pty ABI + a headless run of
the bundled backend, of its liveness collector and of every module main
imports, from `app.asar` and the `client/` directory beside it, no GUI
launch). The Linux leg then runs the
smoke once more with its launch phase, under a virtual display; no macOS leg
launches the window. A local interactive run may also exercise the launch
phase. The headless run starts the backend as the app does, checks that it
answers and that it exits when its stdin closes, and runs the collector once;
it does not exercise the GUI or, on Linux, the AppImage's launcher and
runtime (the glibc floor runs the runtime only to unpack the AppImage).
