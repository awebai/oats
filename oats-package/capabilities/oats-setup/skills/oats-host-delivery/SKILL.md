---
name: oats-host-delivery
description: >-
  Use when setting up or checking how messages reach the agents on a host:
  the two delivery choices every host with messaging seats makes. Claude
  channel delivery (the approved route: Claude's managed-settings file,
  `claudeChannelMode: approved`, the aweb-channel plugin, the admitted
  banner; the development fallback and what it costs; session delivery).
  The host wake broker (`aw wake run` as a per-user launchd or systemd
  --user service, `AW_WAKE_OATS_BIN` and PATH, restarting it after an aw
  upgrade, `aw wake status`). Also for "why didn't my agent wake",
  `wake-daemon-not-running`, `joined-team-poll-only`,
  `channel-dev-confirmation` and the development-channel prompt.
  `/oats-onboarding` card 4 makes these choices and card 8 checks them.
  Part of the setup and config of an OATS workspace (oats.setup);
  day-to-day operation inside an instance is oats.core.
---

# Host message delivery: Claude channels and the wake broker

Every host that runs messaging seats needs two delivery choices. Neither
has a safe default:

- **An unset `claudeChannelMode` starts every Claude home in development
  mode.** Nobody chose that.
- **A host with no wake broker gives every joined team poll-only receive,**
  and gives Codex and `delivery: session` homes no wakes at all.

`oats doctor` stays clean in both cases. This skill is the one place that
teaches both choices. `/oats-onboarding` card 4 makes them, card 8 checks
them, and the onboarding hand-back records them. The provider's side is
`/oats-aweb` §4 and §7.

What wakes each home (oats.aweb 1.15 and later):

| Home | Its primary identity is woken by | The broker is needed for |
|---|---|---|
| Claude, `delivery: channel` (the default) | the aweb channel plugin: [Choice 1](#choice-1-claude-channel-delivery) | its joined teams |
| pi, `delivery: channel` | its `@awebai/pi` extension | its joined teams |
| Codex, any delivery | the host wake broker | everything |
| any runtime, `delivery: session` | the host wake broker | everything |

A joined team's `receive: native` always means the broker, never a Claude or
pi channel. So **the host needs the broker as soon as one home on it has a
joined team, runs Codex, or uses `delivery: session`**:
[Choice 2](#choice-2-the-host-wake-broker).

**Record both choices** in the onboarding hand-back, each with its check:

```text
Claude channel delivery: approved | development (chosen: <reason>) | session | no Claude seats here
Host wake broker: installed (<manager> unit, aw <version>) | not needed (<why>) | declined (joined teams poll-only, accepted by <who>)
```

## Choice 1: Claude channel delivery

Pick one for the host's Claude seats:

| Choice | Setting (`oats-local.yaml`, `settings.oats.aweb`) | When |
|---|---|---|
| **approved** (default for unattended hosts) | `claudeChannelMode: approved` | Use it whenever a human admin can write the managed-settings file, or the organization admin can set its two keys. [Steps below](#claude-channel-delivery-approved-route). |
| **development** (fallback) | `claudeChannelMode: development`, written explicitly | When the approved route is not available yet. Know its costs: [the development fallback](#the-development-fallback). |
| **session** | `delivery: session` | When Claude should be woken like Codex, by the broker typing into its terminal. It uses no plugin and shows no prompt, and it needs [Choice 2](#choice-2-the-host-wake-broker). |

Whatever you choose, write the key. A missing key is not a choice: it is how
hosts end up in development mode by accident.

## Claude channel delivery (approved route)

With `claudeChannelMode: approved`, oats.aweb starts Claude with
`--channels plugin:aweb-channel@awebai-marketplace`. Claude then shows no
“WARNING: Loading development channels” prompt, because it admits the plugin
when a root-owned managed-settings file on the machine lists it.

- The route does not depend on the Claude version.
- There is no prompt for OATS to confirm. From OATS 0.52.0, development
  mode's prompt is confirmed by OATS itself (`docs/configuration.md`, “The
  development-channel confirmation”). On OATS 0.44 to 0.51 it needed the
  `launchPromptAnswers` consent.

The contract is `docs/configuration.md`, “Claude channel delivery: the
approved route”. The provider's behaviour and the receive proof are in
`/oats-aweb` §4.

**Prerequisites:** the intake selects Claude seats with channel delivery on
this host; a human admin with sudo on this machine, because OATS never writes
the managed-settings file; and which managed-policy source governs the
account. Claude reads its managed policy from the **first source present**:
server-managed settings (a claude.ai Team/Enterprise organization's admin
console), then an MDM profile (`com.anthropic.claudecode` on macOS), then the
file. On an account governed by server-managed settings or MDM the file is
ignored: the organization admin sets the same two keys there instead, and
steps 1–2 do not apply. Pro/Max accounts and plain API-key use have no
server-managed settings, so the file applies.

1. **Read what is there.** The file is `/etc/claude-code/managed-settings.json`
   on Linux and `/Library/Application Support/ClaudeCode/managed-settings.json`
   on macOS. Claude also reads drop-ins in `managed-settings.d/*.json` beside
   it. Read the file and any drop-ins before changing anything.
2. **The admin sets two keys**, in a file owned by root, mode 0644. The content
   is exactly:

   ```json
   {"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}
   ```

   If the file exists, merge these two keys into it and never overwrite its
   other keys (to an existing `allowedChannelPlugins`, add the aweb-channel
   entry), or put them in a drop-in of their own,
   `managed-settings.d/50-aweb.json` beside it (Claude merges the file first,
   then the drop-ins in name order; lists combine). **Setting
   `allowedChannelPlugins` replaces Anthropic's default channel allowlist on
   this host** (the official discord, telegram, fakechat and imessage
   plugins): if the host uses any of them, list them too. Always
   include `channelsEnabled: true`: API-key users need it whenever any managed
   policy exists, and so do Team/Enterprise subscribers; Pro/Max ignore it.
   When no file exists yet, on Linux:

   ```bash
   sudo install -d -m 0755 /etc/claude-code
   echo '{"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}' \
     | sudo tee /etc/claude-code/managed-settings.json >/dev/null
   sudo chown root /etc/claude-code/managed-settings.json
   sudo chmod 0644 /etc/claude-code/managed-settings.json
   ```

   On macOS:

   ```bash
   sudo install -d -m 0755 "/Library/Application Support/ClaudeCode"
   echo '{"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}' \
     | sudo tee "/Library/Application Support/ClaudeCode/managed-settings.json" >/dev/null
   sudo chown root "/Library/Application Support/ClaudeCode/managed-settings.json"
   sudo chmod 0644 "/Library/Application Support/ClaudeCode/managed-settings.json"
   ```

   Read it back: `ls -l` shows owner root and `-rw-r--r--`, and the file is
   valid JSON with both keys.
3. **The plugin.** `aweb-channel` is installed from the marketplace named
   `awebai-marketplace` (GitHub `awebai/claude-plugins`) and enabled, in the
   Claude config directory the host's Claude launch configuration uses (its
   `CLAUDE_CONFIG_DIR`, else `~/.claude`). The allowlist matches the
   marketplace by name. With that `CLAUDE_CONFIG_DIR` set in the shell:

   ```bash
   claude plugin marketplace add awebai/claude-plugins
   claude plugin install aweb-channel@awebai-marketplace
   claude plugin list   # aweb-channel@awebai-marketplace, enabled
   ```
4. **OATS settings**, in this host's `oats-local.yaml` under
   `settings.oats.aweb`: `claudeChannelMode: approved` (host-only), and
   `delivery: channel` for the whole host, or per spawn with
   `--provider oats.aweb delivery=channel`. With channel delivery, pi uses its
   `@awebai/pi` extension and Codex always uses the host broker.

**Effects:** a machine-wide Claude policy file and host settings; no home
changes. **Existing homes** keep the delivery and channel mode recorded at
their spawn: respawn a home to adopt this route. Never restart running agents
as part of setup without the operator's word.

**Success** (read at `/oats-onboarding` cards 6 and 8):

1. The spawn preview shows `settings.oats.aweb.claudeChannelMode: approved`
   and `delivery: channel`.
2. The started session shows no development prompt, and its banner shows
   “Channels (experimental) messages from plugin:aweb-channel@awebai-marketplace
   inject directly in this session”, followed by “restart without --channels
   to stop”. At normal terminal widths the banner wraps over two rows: look
   for each part, not for one string.
3. The banner says none of `not on the approved channels allowlist`,
   `not on your org's approved channels list`, `blocked by org policy` or
   `plugin not installed`.
4. Receive is proven only by the `/oats-aweb` nonce exchange.

**Next:** return to `/oats-onboarding` card 4's sync.

**Failure → cause → remedy:**

| What the session shows | Cause | Remedy |
|---|---|---|
| `not on the approved channels allowlist` | the effective managed policy has no `allowedChannelPlugins` (no file, the file not read, or the key missing), so Anthropic's default list applied | write or fix the file (steps 1–2) |
| `not on your org's approved channels list` | the effective policy has an `allowedChannelPlugins` without this plugin and marketplace pair: the names in the file are wrong, or a higher source (server-managed settings or MDM) supplies its own list | fix the entry, or have the organization admin add it |
| `blocked by org policy` (then “Inbound messages will be silently dropped”) | the effective policy lacks `channelsEnabled: true`, which Team/Enterprise subscribers need, and API-key use whenever any managed policy exists | add the key, or have the organization admin set it |
| `plugin:aweb-channel@awebai-marketplace · plugin not installed` | the plugin is not installed in the launch's Claude config directory | step 3 |
| the development prompt still appears | the home started in development mode, not approved: the host setting is missing, or the home was spawned before the change | step 4, then respawn the home |

When unsure, check in order: the preview's mode; which managed-policy source
governs the account; the file (the OS's path, root, 0644, valid JSON, both
keys, exact plugin and marketplace names); the plugin in the launch's config
directory. The admitted banner without a completed nonce exchange is not
receive: `/oats-aweb` §4.

**Limits:** channels are an Anthropic research preview, and Anthropic's
account-level feature flag gates them on every route; neither is an OATS
setting.

## The development fallback

`claudeChannelMode: development` makes oats.aweb start Claude with
`--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`.
It needs no managed policy, so it works the day a host is set up. These are
its costs, and they are why it is a fallback and not the default for an
unattended host:

- **A prompt at every start.** Claude shows “WARNING: Loading development
  channels” whenever the home starts or restarts. OATS 0.52.0 and later
  confirms it once at launch by typing into the session
  (`docs/configuration.md`, “The development-channel confirmation”). Nothing
  else may answer it: not the provider, not the broker, not an agent.
- **A readiness warning that stays.** Readiness warns
  `channel-dev-confirmation` until the home's last start recorded
  `launchPrompts.status: completed`.
- **Inspection when a start goes wrong.** A start whose confirmation is
  `blocked` or `incomplete` leaves a session someone must inspect
  (`oats session inspect --home <home> --json`, and the kernel's
  `launch-prompt` readiness item) before anything is started again.
- **Telemetry opt-outs disable it, as they do approved mode.** When Claude
  ignores the flag, the home has no channel delivery at all, and readiness
  warns `claude-channels-unavailable`.

Choose it by writing `claudeChannelMode: development`, never by leaving the
key out. To leave it later, set up the approved route, change the key, and
respawn the homes. A home keeps the mode it was spawned with.

## Choice 2: the host wake broker

The broker is aw's daemon, `aw wake run`. Each host user runs one, and it
serves every home registered with it. It types wakes into those homes'
terminals: it runs the OATS CLI (`oats session inspect` / `oats session
input`), and for each registration it runs a delivery child on Node. Homes
register themselves at spawn and launch, so there is nothing to do per home.
Its state lives in `~/.config/aw/wake` (or `AW_WAKE_STATE_DIR`).

**When the host needs it:** some home on it has a joined team (any runtime),
runs Codex, or uses `delivery: session`. Settle this at onboarding, before
the first such home is spawned.

**What happens without it:**

- a joined team's `receive` is recorded as `poll` (reason
  `wake-daemon-not-running`), and readiness warns `joined-team-poll-only`;
- a Codex or `delivery: session` home gets no wakes, and readiness reports
  the problem `wake-daemon-not-running`.

**Who installs it.** The operator does, in their own terminal, as the user
who runs the instances, outside every instance home. A per-user service
starts with an almost empty PATH, so the unit has to name, by absolute path:

- `aw`;
- `oats`, through `AW_WAKE_OATS_BIN`, the executable the broker runs;
- the directories of `oats` and `node`, through `PATH`: `oats` is a Node
  program, and the delivery child runs on Node.

Those paths must come from the operator's own shell. An agent's shell can
carry a session's own PATH, which is the same reason the host timer is
installed by the operator (`/oats-automations`, “One host timer, no
daemon”). An agent hands over the steps below and checks
the result afterwards. It never runs them itself.

**Before installing:**

- `aw version` must meet the provider's floor (1.36.33 from oats.aweb
  1.26.0).
- `aw wake status --json` must not already show `daemon_running: true`. A
  broker started by hand in some terminal would make the service's own start
  exit at once ("A second start exits 0 reporting the running daemon"). Stop
  that one first.
- If a unit for `aw wake run` already exists on this host, keep it. Check
  it against the unit below and use the restart and check steps below.

```bash
command -v aw oats node   # in the operator's terminal: the three absolute paths for the unit
aw version
aw wake status --json     # daemon_running must be false before the service takes over
```

Prefer stable paths. A version manager's per-version directory changes when
Node or aw is upgraded, and the unit then points at a path that is gone. If
you use one, edit the unit after each upgrade (see “After an aw upgrade”).

**Linux (systemd --user).** Write
`~/.config/systemd/user/ai.aweb.wake.service`, replacing `<AW>`, `<OATS>`
and `<NODE_DIR>` with the paths above. `<OATS_DIR>` is the directory that
holds `oats`.

```ini
[Unit]
Description=aweb host wake broker
After=network-online.target

[Service]
ExecStart=<AW> wake run
Environment="PATH=<OATS_DIR>:<NODE_DIR>:/usr/local/bin:/usr/bin:/bin"
Environment="AW_WAKE_OATS_BIN=<OATS>"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

systemd expands `%` in these values: write a literal `%` as `%%`. Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai.aweb.wake.service
systemctl --user status ai.aweb.wake.service --no-pager | head -5
loginctl show-user "$USER" -p Linger   # Linger=no: the service stops when the user's last session ends
```

On a host where nobody stays logged in, enable linger:
`sudo loginctl enable-linger <user>`. That needs an admin.

**macOS (launchd).** Write `~/Library/LaunchAgents/ai.aweb.wake.plist`.
launchd does not expand `~`, so every path in it is absolute, the log path
included. `<HOME>` is the user's home directory.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.aweb.wake</string>
  <key>ProgramArguments</key>
  <array><string><AW></string><string>wake</string><string>run</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string><OATS_DIR>:<NODE_DIR>:/usr/local/bin:/usr/bin:/bin</string>
    <key>AW_WAKE_OATS_BIN</key><string><OATS></string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string><HOME>/Library/Logs/ai.aweb.wake.log</string>
  <key>StandardErrorPath</key><string><HOME>/Library/Logs/ai.aweb.wake.log</string>
</dict>
</plist>
```

```bash
plutil -lint ~/Library/LaunchAgents/ai.aweb.wake.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.aweb.wake.plist
launchctl print gui/$(id -u)/ai.aweb.wake | grep -m1 state   # state = running
```

A LaunchAgent runs only while that user is logged in, like the desktop
session the OATS terminals run in.

**After an aw upgrade, restart the broker.** A running daemon keeps the code
it started with until it restarts. Readiness compares the daemon's own
version with the floor and warns `wake-daemon-outdated` when it is behind.
Restart it after every aw upgrade, and also after `oats` or Node moves (edit
the unit's paths first):

```bash
systemctl --user restart ai.aweb.wake.service           # Linux; after editing the unit: daemon-reload first
launchctl kickstart -k gui/$(id -u)/ai.aweb.wake        # macOS; after editing the plist: bootout, then bootstrap
```

A restart is safe at any time. The daemon re-reads its registrations, and
mail that was not yet presented is raised again from the server's unread
state.

**Check** (the onboarding hand-back records these results):

```bash
aw version
aw wake status --json              # daemon_running, daemon_version_state, daemon_version, instances
oats readiness --home H --json     # for each home that needs the broker
```


1. `aw wake status --json` shows `daemon_running: true`,
   `daemon_version_state: "reported"`, and a `daemon_version` equal to what
   `aw version` prints.
2. For every home that needs the broker, `oats readiness --home H --json` has
   none of `wake-daemon-not-running`, `wake-daemon-outdated`,
   `wake-daemon-version-unknown` or `joined-team-poll-only`, and the home is
   listed in the status's `instances`.
3. Receive is proven only by a nonce exchange to one broker-woken identity: a
   joined team's identity, or a Codex or session home (`/oats-aweb` §4
   “Receive verification and recovery”). Readiness and status rows prove the
   route, not delivery.

A home that joined a team while the broker was down keeps `receive: poll`
until it registers again. Its next start does that, and it is the operator's
word that restarts it (`oats session restart --home H`).

**A false warning on oats.aweb 1.27.2:** readiness reports
`wake-status-stale` for every home that needs the broker, even while the
broker runs and delivers
([oats-aweb#116](https://github.com/awebai/oats-aweb/issues/116)). oats.aweb
1.27.3 fixes it. On 1.27.2, move the pin (`/oats-package-pins`); don't
chase the broker.

**Failure → cause → remedy:**

| What you see | Cause | Remedy |
|---|---|---|
| `wake-daemon-not-running` | no service, or it is crash-looping | install it; read its log: `journalctl --user -u ai.aweb.wake.service -n 50`, or `~/Library/Logs/ai.aweb.wake.log` |
| `wake-daemon-outdated`, or `daemon_version` differs from `aw version` | aw was upgraded and the daemon was not restarted | restart it (above) |
| `wake-daemon-version-unknown` | the running daemon is too old to report its version | upgrade aw, then restart |
| the log says `oats` or `node` is not found | the unit's `AW_WAKE_OATS_BIN` or `PATH` is wrong, or points at a moved version | fix the paths, reload, restart |
| the service restarts every few seconds and status names another `daemon_pid` | a broker started by hand is running | stop that one; the service then owns the broker |
| status is running but one home gets no wakes | its registration or stream, not the server | read the daemon's log for that identity's path (stream-connected versus stream-unavailable); a status row proves absence, never its cause |
| `joined-team-poll-only` with the broker running | the home registered while the broker was down | restart that home, with the operator's word |

## Never

- Leave `claudeChannelMode` unset.
- Write Claude's managed-settings file, or install, restart or remove the
  broker's service, from an agent's shell. Hand the steps to the admin or
  the operator, and check the result afterwards.
- Take over or delete a broker unit somebody else wrote.
- Restart or respawn running agents without the operator's word.
- Treat a banner, a readiness answer or a status row as proof of receive.
  Only the nonce exchange proves it.
