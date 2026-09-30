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

## Opening a workspace

The app starts on the directory it was launched with (its own folder by
default). To view a deployment, open the workspace switcher in the sidebar
and choose **Add workspace → Browse**, then point it at an OATS deployment —
the directory (the operator's choice) holding `oats-local.yaml` and `agents/`.
A picked folder without `oats-local.yaml` is offered onboarding instead. The
Desktop never parses the deployment: its members, lock state and header come
from `oats workspace status`, and its instances from the deployment's one
`agents/` root.
Added workspaces are remembered and offered as suggestions next time.

Launch flags for scripted use: `--dir <workspace>` and `OATS_DESKTOP_PORT`.

## Scheduling agents and wake messages

Open **Schedules** in the selected workspace to launch a new agent on a cron,
wake an existing agent with a message, or harvest its knowledge. **Schedule…**
on a Soul roster card preselects that soul. Choose the task or message, repeat
pattern and time zone; new agent jobs also offer harness, model, permissions
and session backend. The list shows the next run, last observed outcome and
whether the host scheduler is enabled. Pause, edit, run now and delete operate
on that workspace's saved jobs. Launching an agent is reported separately from
the end of its run; neither means its task succeeded.

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
| Terminals fail to open ("could not attach") | tmux missing, or no live session for that instance. Install tmux (`tmux -V`); check `tmux ls`. |
| Can't select/copy text in a terminal tab | The terminal runs with tmux mouse handling, so a plain drag scrolls/passes through. Hold **Option** (macOS) or **Shift** while dragging to make a local selection, then copy (Cmd+C / right-click → Copy). |
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
