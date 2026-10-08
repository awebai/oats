# @awebai/oats-desktop

The OATS desktop app — a VS Code-style Electron shell around the OATS control
panel, with a **real integrated terminal** (xterm.js + node-pty attaching
straight to the agents' tmux sessions).

Private package: NOT part of the published npm `files` set of the root
package; its dependencies (electron, node-pty, xterm) live here only.

## Run

```bash
cd packages/desktop
npm install          # postinstall bundles renderer/vendor/highlight.mjs (esbuild)
npm run rebuild      # rebuild node-pty against the Electron ABI (first install / electron upgrade)
npm start            # launches the app; connects to the backend server on 127.0.0.1:4820 or spawns the bundled one
```

Flags/env:
- `--dir <workspace>` / `OATS_DESKTOP_DIR` — the OATS workspace the panel shows
  (default: this repo's root).
- `OATS_DESKTOP_PORT` — backend server port (default 4820).

## Brand artwork

`assets/brand/oats-logo.png` is the one source of the app's brand artwork
(the human-supplied logo, SHA-256 `b1d21d9a…de69e`). Every derived icon —
the macOS `oats.icns`, the Linux `NxN.png` set and the 2x sidebar mark — lives
in `assets/brand/generated/` and is regenerated from the source by one
command:

```bash
cd packages/desktop
npm run icons              # rewrite assets/brand/generated/ from the source
npm run icons -- --check   # verify the checked-in set derives from the source
```

`build-icons.mjs` is zero-dependency (square source, premultiplied-alpha
area averaging, transparency preserved); `test/brand-icons.test.mjs` fails if
any checked-in icon's pixels stop matching what the source derives.

## UX and architecture

The shell has three navigation contexts:

- **Active overview** — the home surface: a fitted, zoomable tidy tree of
  running and idle instances with `parentInstance` spawn relationships. Agent boxes can
  be repositioned freely; edges follow live.
- **Instances** — the shell's single sidebar becomes a compact, recursively
  nested roster. Selecting a running instance opens its direct tmux-attach
  xterm terminal in the main area. Terminal tabs are scoped to this context.
- **Soul roster** — searchable soul cards with explicit **Spawn** and
  **View brain** actions. Brain and markdown artifacts are scoped to this
  context; the markdown reader is the flagship file surface.

- `main.mjs` — Electron main: server management (connect-or-spawn the bundled server),
  IPC `api` proxy, node-pty terminals (`tmux attach-session -t <target>`).
  Closing a terminal tab kills the pty ONLY — tmux sessions are the durable
  hosts and always survive.
- `server/oats-web.mjs` — the bundled zero-dependency backend: a loopback-only
  `node:http` server exposing the `/api/*` surface (roster, spawn, brain,
  session capture, keys, file). The deployment model is the installed kernel's
  JSON: `oats status --json` (roster) and `oats workspace status --json`
  (workspace header), read by `server/deployment-observer.mjs` — the app reads
  no deployment file and never imports the framework kernel; lifecycle
  mutations require a compatible installed `oats` CLI. See
  [docs/desktop-deployment-model.md](docs/desktop-deployment-model.md); when
  the kernel is asked and what the server holds between asks is
  [docs/desktop-load-path.md](docs/desktop-load-path.md).
  Binds 127.0.0.1 only — it can type into your terminals. A server the app
  starts ends with the app, however main ends: its stdin is a pipe only main
  holds, and with `--exit-on-stdin-close` the server exits at its EOF
  (`server-host.mjs`, `serverSpawnSpec`). A server started by hand has no such
  tie. What the programs it
  starts receive is [below](#the-environment-of-the-programs-desktop-starts).
- `preload.cjs` — contextBridge surface (`window.oatsDesktop`); renderer runs
  with contextIsolation on, nodeIntegration off.
- `host-theme.mjs` — the theme of the computer that runs Desktop, for the
  "This computer" theme choice: reads and follows Omarchy's `colors.toml`, else
  the system's light or dark appearance, and sends plain state to the windows.
- `renderer/shell.mjs` — contextual single sidebar, stage host, artifact-tab
  host, command palette, recursive instance roster, and integrated terminals.
- `renderer/views/*.mjs` — feature views per the shared contract:
  `mount(el, ctx)` / `unmount()`, `ctx = { api, openFile, openTerminal }`.
  The shell adds feature-detected `openBrain` / `openView` affordances.
  `mount()` MAY return a disposer function; the host prefers it over the
  module-level `unmount()` (required for multi-mounted views such as markdown).
  `views/common.mjs` carries shared helpers and the workspace bus;
  `theme.css` carries the AA semantic tokens of the three built-in themes
  (White, Solarized, Dark); a fourth choice, This computer, shows the host's
  theme on a built-in base (renderer/README.md);
  `loading.mjs` / `loading.css` are the shared loading-state primitive
  (skeletons, refreshing, stale and failed; see renderer/README.md). Bare ESM deps
  (marked, dompurify, highlight.js) resolve through the importmap in
  `index.html`; highlight.js is bundled to `renderer/vendor/` by
  `build-vendor.mjs` (postinstall) because its `es/` entry is a
  dual-package CJS shim browsers cannot load.

### The environment of the programs Desktop starts

A program Desktop starts gets the user's environment: nothing Desktop or its
packaging added reaches it. The backend and its liveness collector, which are
the packaged executable running as Node, are started with their parent's
environment and clean their own before anything else. The main process keeps
its environment and gives each child the cleaned one when it starts it.

It matters because a tmux server takes its environment from the program that
creates it (the oats CLI on a spawn or a start, or `tmux` itself), and every
pane on that server then has it.

The rule is one function, `cliEnvironment(source)` in `cli-environment.mjs`,
which imports nothing:

- `ELECTRON_RUN_AS_NODE` (main sets it for the backend) and `CHROME_DESKTOP`
  (Electron sets it on Linux) are removed.
- `MallocNanoZone` is removed when it is exactly `0`: the launch environment
  Electron's `Info.plist` declares on macOS.
- When the environment has `APPDIR` (an absolute path other than `/`; the
  AppImage's mount), `APPIMAGE`, `APPDIR`, `ARGV0` and `OWD` are removed, and
  every other value is read as a `:` list: entries that are the mount or under
  it are dropped, with the empty ones, and a name with nothing left is
  removed. A value with no such entry is passed through unchanged.

Where it is applied:

- **A process that runs as Node cleans itself first.** The first import of
  `server/oats-web.mjs` and of `server/liveness-main.mjs` is
  `server/own-environment.mjs`, which changes `process.env` in place. It has
  to be an import, and the first one: modules take their environment when they
  are loaded (`server/forge.mjs`, `server/tmux-status.mjs`), and a module's
  imports are evaluated in order, each completely before the next. So
  `own-environment.mjs` and `cli-environment.mjs` must keep no other imports
  and no top-level `await`, and nothing may import an entry module or be
  preloaded ahead of one. After that no place in `server/` that starts a
  program needs the function, and none has it.
- **Such a process is started with its parent's environment**, so the
  executable starts as it always did (on an AppImage that includes the library
  path into the mount). Main starts the backend with
  `{ ...process.env, ELECTRON_RUN_AS_NODE: "1" }`; the backend starts the
  collector with `launchEnvironment`, the copy `own-environment.mjs` took
  before cleaning. No other child receives either.
- **Main cleans nothing of its own** (Electron and the AppImage's machinery
  read it). Every program it starts gets `cliEnvironment(<the environment at
  that moment>)`, computed at the call: the login shell, `oats` workspace
  verbs, the terminal viewers' `tmux` calls and PTY, the remote terminal and
  its `oats session` calls, the orphan-viewer sweep. `gh`'s allow-list
  (`forgeEnvironment`) is picked from it too. That is the one copy made at
  module load, so after the login shell's `PATH` is applied, `gh`'s `PATH` is
  taken again from `forgeEnvironment()`. The `PATH` the login shell answers is
  not assumed clean (a profile can print anything), and main's own `PATH` is
  whatever the merge returns; children are filtered when they start.

A new child of the main process needs `cliEnvironment`; a new child of the
backend or the collector needs nothing.

Limits, known and not fixed:

- A packaged Electron empties most of `NODE_OPTIONS` before any Desktop code
  runs, so a user's `NODE_OPTIONS` does not reach the CLI.
- The AppImage launcher also adds entries that are not under its mount, and
  those stay. As generated by `app-builder-lib` 26.15.3
  (`generateAppRunScript`): `/usr/share/gnome`, `/usr/local/share/` and
  `/usr/share/`, appended to `XDG_DATA_DIRS` after the user's entries. A user
  with no `XDG_DATA_DIRS` therefore gets one made of those three.
- The rule follows `APPDIR` in the environment, whoever set it. Desktop
  started from a shell that is itself inside another AppImage drops that
  image's entries too. A launcher run without the AppImage runtime (an
  extracted image) does not export `APPDIR`, so its entries are not
  recognised.
- A value that is rewritten also loses the user's own empty entries.
- A user's own `MallocNanoZone=0` is removed too: it cannot be told from the
  one the app's launch declares.
- A tmux server that is already running with such an environment is not
  changed ([#616](https://github.com/awebai/oats/issues/616)).
