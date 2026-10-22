# OATS TUI (preview)

`oats tui` is the OATS terminal client: one full-screen, keyboard-only program
for people who work in terminals and on machines with no display. It ships
inside `@awebai/oats` and is never published on its own.

**It is a preview.** This version shows a workspace's instances, on this
machine and on the other machines registered on it, in one list, follows
them, opens agents' terminals as tabs in a panel beside the list, split in two groups when you want, stops, starts, restarts and retires an
agent after a confirmation, and spawns an agent on this machine. While it is a preview its screens and its
configuration file may change without notice.

[`docs/tui.md`](../../docs/tui.md) is the reference: how to start it, what the
view shows, the keys and how to change them, what it reads and runs, the
complete list of what it changes in the terminal and restores, and what it
never does.

## For developers

| path | contents |
|---|---|
| `bin/tui.mjs` | the entry `bin/oats.mjs` loads: it imports the whole module graph, then runs `main()` |
| `lib/main.mjs` | the start (arguments, environment, terminal, `tui.json`, deployment, kernel, and outside every deployment this computer's list of deployments) and the loop: events through `reduce`, effects out, the frame drawn; the list's reads, the add of the deployment the run starts in and the switcher's Remove, through the shared `cliDeploymentList`; the slow schedule of the needs-input dot of the listed deployments the run does not serve (the shared `createListedWaiting`, over `cliDeploymentIdentity`), its set following what is listed and served |
| `lib/actions.mjs` | the action table and its default keys: the reducer, the cheat sheet and the help read the effective one. The keys shared with the Desktop are not written here: the leader's table and the plain keys of the list come from `packages/client/keymap.mjs`, and `test/keymap.test.mjs` fails on a row of the shared table the TUI does not handle |
| `lib/config.mjs` | `tui.json` (`~/.oats/config/tui.json`): moved once from where earlier versions read it, read once, checked, and the effective action table; the default leader is the shared one (`keymap.mjs` `leaderKey`, Ctrl+X on every platform) |
| `lib/client.mjs` | the one module that imports the shared readers (`packages/client/`), and the client's terms |
| `lib/panel.mjs` | the open terminals, as tabs: the run's private tmux server (one control client, one window per tab, up to `MAX_TERMINALS`, each at the size its caller gives), the kernel's `oats session attach` in a pane of each, captures of the displayed tabs only (up to `MAX_SHOWN`, one per group of a split) when tmux says their pane changed, a hidden tab's output marking it, keys typed into the shown tab, and the sweep of what a dead run left; the only module that runs tmux (THE TABS in its header) |
| `lib/read.mjs` | the effects of reading: the deployment, the kernel record, the observer of every deployment opened in the run, the roster of other machines (`oats server roster --json`), the refresh loop, the liveness collector, ending every read, the identity reads of this computer's listed deployments the run has not opened (`createIdentityReads`: one at a time, under a budget, never on a timer), the changes (a stop or retire apply, a start or restart: never ended, their output in files of the run's private directory), the one look at the file system the switcher needs (whether a picked row is a deployment), and `startExec`, the exec of the list's read before the terminal is taken |
| `lib/store.mjs` | the state and `reduce(state, event)`: pure. It holds the tabs' order, their groups, the shown one of each and the rule for the neighbour after a close (`TAB_LIMIT`, held to the panel's `MAX_TERMINALS` by a test), and each workspace's memory for the run (THE MEMORY OF A WORKSPACE: its place, its palette recency, and its tabs as it was left, opened again one at a time when it is opened again); the list of workspaces' focus and cursor, and the leader's moves between workspaces (the shared `workspaceStep`) |
| `lib/model.mjs` | from the state to the rows and the detail to draw, and to the switcher's rows (a workspace and a line per deployment of it, matched by the shared `listedViews` over the served deployments and the identities the reads learned), and from those the list of workspaces (`workspaceList`: its rows, which open, their state words and dots; `listWindow`: five rows at most), by calling the shared readers: pure, no cell position |
| `lib/term/keys.mjs` | bytes to key events: a pure parser with an injected clock; under the kitty keyboard protocol it reads a `CSI … u` key as its legacy bytes read, a chord as its own id |
| `lib/term/kitty.mjs` | the kitty keyboard protocol: the flags asked for, a `CSI … u` key read, and the bytes the same key sends without the protocol (`legacyBytes`), which is what an agent is typed |
| `lib/term/width.mjs` | the cells a grapheme takes |
| `lib/term/text.mjs` | safe text, the only thing the screen draws: `lit()` and `shown()` |
| `lib/term/style.mjs` | style values: the TUI's own (the sixteen ANSI colours and four attributes) and an agent's (its colours, 256 and RGB included, and attributes, from a capture) |
| `lib/term/capture.mjs` | a pane's capture (`capture-pane -e -N`) to rows of cells: characters and an allowlist of SGR, every other sequence and control dropped |
| `lib/term/through.mjs` | the bytes typed while a terminal has the focus: the back key's grammar and bytes, and the scanner that takes the back key, a chord and a bracketed paste out of them and, under the kitty keyboard protocol, types every other key as its legacy bytes |
| `lib/term/screen.mjs` | the cell buffer and the bytes of a frame |
| `lib/term/tty.mjs` | the guard: enter, leave, signals, suspend, resize, one write per frame; the kitty keyboard protocol pushed, asked about and popped on every way out |
| `lib/views/` | pure functions from the model and a size to rows of spans: the frame (the sidebar: the list of workspaces (`workspaces.mjs`) or its title, the accordion of the three views and the cheat sheet; the main area beside it), the list, the detail, the Capabilities view (`capabilities.mjs`), the switcher, the help, the confirmation of an act (`act.mjs`), the spawn prompt (`spawn.mjs`), the split's geometry (`split.mjs`) |

Rules the tests pin (`test/tui-boundary.test.mjs` reads the files):

- No dependency, and no import outside `node:` modules, this package and the
  one path in `lib/client.mjs`. No dynamic `import()`.
- Nothing in `lib/` or `bin/` of the kernel imports this package, except the
  one dynamic import where `bin/oats.mjs` dispatches the word.
- Only `term/screen.mjs` and `term/tty.mjs` write an ESC byte in a string,
  and only they write to the terminal. `term/through.mjs` (the back key's
  bytes), `term/kitty.mjs` (a key's legacy bytes) and `lib/panel.mjs` (the paste marks it types into the agent's
  pane) hold theirs as numbers. Views are pure: no IO, no clock, no escape
  bytes.
- No function of this package decodes a kernel answer, groups or orders
  instances, or decides what a failed read means: `lib/model.mjs` and
  `lib/read.mjs` call the shared readers and pass their answers on. A string
  the shared readers give reaches the screen through `shown()`.
- The store holds no size and no cell: a key event carries the height of the
  panes as the last frame drew them.
- Every read runs in a session of its own and is ended on every way out.
  The viewer runs in a pane of the run's private tmux server
  (`lib/panel.mjs`), never on the user's terminal: the guard never lends the
  terminal, and `panel.end()` kills that server on every way out. After a
  SIGKILL the server's keeper window kills it: the keeper reads the run's
  FIFO `alive`, whose write end the TUI holds, until no writer is left (see
  THE KEEPER in `lib/panel.mjs`, which says why the control client's stdin
  EOF is not enough). The next run's sweep removes the directory. The panel
  runs a process to make that FIFO, to ask tmux's version, to start the
  server, to make a window and to end the server, and the sweep one to ask
  whether a socket answers; every frame, key, resize and close goes through
  its one control client, and a capture runs only after tmux said a
  displayed tab's pane changed (each group's shown tab, two at most); a
  hidden tab's first output captures nothing, marks it and pauses its pane
  for the control client until it is displayed again, when it is
  continued before its capture (THE OUTPUT OF A TAB NOT DRAWN in
  `lib/panel.mjs`). A capture goes out of band: tmux saves it to the run's file
  `capture`, so no pane's text is ever in the control client's stream, and
  a block that says what its command never says ends that client (THE
  CAPTURE in `lib/panel.mjs`). A
  change (`lib/read.mjs` `changeExec`: the apply of a stop or a retire, a
  start, a restart, a spawn's apply) is never signalled on the way out: it
  is let go, and its output goes to files, so it never meets a closed pipe.
  Only a spawn's apply has a deadline, the shared apply's, at which it is
  sent its signal (`timeout`, `killSignal`), and only while the run lasts:
  every timer the shared spawn arms is the run's (`lib/main.mjs`
  `createRunTimers`), cleared as the run ends.
- The acts decide nothing the shared home decides: which act a row offers is
  `instanceActs`, a stop or a retire is the shared confirmation over the
  run's one lifecycle boundary, a start or a restart is `startInstance`, and
  no lifecycle sentence is written in this package where the shared home
  has one. A retire this run sent is held by the shared retires-in-flight
  tracker, one per run (`lib/main.mjs`): its row reads Retiring… from the
  send until a read begun after its answer covers the row (a cycle's
  entry marked `read` for this machine's rows, numbered against
  `lib/read.mjs` `begun()`; a roster outcome that reached the row's
  machine for another's), and at once again after a refusal.
- The screen takes safe text only. Text the TUI did not write goes through
  `shown()`; `lit()` is for the TUI's own words and refuses anything the
  display filter would change, a run of spaces included, so a row is spans
  placed by column, never one padded string.

Tests: `node --test packages/tui/test/*.test.mjs`, the root tests
`test/tui-*.test.mjs`, and the end-to-end tests in a real tmux on a private
socket (`test/tui-terminal.test.mjs`; `test/tui-panel.test.mjs` for the
terminal panel, with a second private server for the agents, and
`test/tui-acts.test.mjs` for the acts, both run on CI only).
`packages/tui/test/panel.test.mjs` drives `lib/panel.mjs` against a fake
tmux (`test/fixtures/panel/tmux.mjs`) that records each call and plays the
control-mode answers. All of them need the root's install
(`npm ci` at the repository root). The package has no dependency of its own,
but one of its tests runs the real kernel, which has: "KERNEL_BIN is this
install's own bin/oats.mjs, and its `version --json` is a record the probe
accepts" (`packages/tui/test/read.test.mjs`).
