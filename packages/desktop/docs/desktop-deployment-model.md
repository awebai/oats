# Desktop deployment model on kernel JSON (Phase F, F1)

The Desktop is built for workspace model v2. Every fact it shows about a local
deployment comes from the installed kernel's JSON; the Desktop reads no
deployment file (`oats-local.yaml`, `oats-workspace.yaml`, member souls,
manifests or locks) and keeps no fallback reader for older kernels.

## Reads

For each registered deployment directory `D`, the server
(`server/deployment-observer.mjs`) performs two fixed-argv reads with
the accepted CLI, `cwd = D`, no shell, a 30 s timeout and a 4 MiB output
bound (`deployment-read-cli.mjs`); when the probe declares `observe-max-age`
they carry `--max-age <seconds>` (see
[desktop-load-path.md](desktop-load-path.md)):

- `oats status --dir D --json` — the roster. A raw `{root, agents, workspace}`
  object. Instance rows carry `modules[]` drift (or the recorded map when the
  workspace is unreachable), `soul` source, and `identity` only when a
  provider reported one. Its `workspace` object also carries the
  deployment's workspace identity (feature `workspace-identity`), kept as
  reported for [workspace views](#workspace-views-and-deployments).
- `oats workspace status --dir D --json` — the workspace header: a
  `schemaVersion: 1` envelope with `workspaceStatusApi: 1`: workspace name,
  key and commit, members, packages and `unsynced`/`stale`. There is no
  package approval (kernel feature `packages-no-approval`): declaring a
  package in `packages:` is the trust decision.

A nonzero exit is never success, even with plausible stdout. A kernel refusal
keeps only its bounded `code`/`message`. Ambient instance/deployment selectors
(`PI_AGENTS_ROOT`, `OATS_INSTANCE_HOME`, `OATS_DEPLOYMENT`, …) are removed from
the child environment.

## Capability gates

Reads are gated on the accepted probe (`oats version --json`), never on a
version number: `workspaceApi === 2`, `workspace-v2` and
`packages-no-approval` for the header, plus `instance-modules` and
`served-identity` for the roster. A missing feature is
shown by name in the header and roster; nothing is invoked optimistically.
Matching deployments into workspace views needs `workspace-identity`; without
it each deployment keeps a view of its own under its deployment id, the switcher
lists them as before (not under "Not matched to a workspace"), and the
deployment list says why.
`ACCEPT_RANGE` is `>=0.25.8 <0.45.0`: the floor admits main's kernel before
0.26.0 was tagged, the ceiling admits 0.27 (the harness rename, gated on feature
`harness`) through 0.30 (team model v2, gated on feature `team-model-2`; the
0.29 team shapes are still read), 0.31 (Herdr removed; per-instance reads and
plans routed by `--server`/`--home`, gated on the probe's `remote` entries),
0.32, 0.33 (spawn preview `--max-age`, feature `spawn-preview-max-age`), 0.34
(`capabilities show`, feature `capability-show`), 0.35 (`capture --file`,
feature `capture-file`), 0.36 (workspace identity on `status`, feature
`workspace-identity`), 0.37 (launch preview, no new feature), 0.38 (team
model 3, feature `team-model-3`, which replaces `team-model-2`: the team views
are gated on their feature), 0.39 (server connect, the capability route and
servers per workspace, features `server-connect`, `capability-route` and
`servers-per-workspace`), 0.40 (needs input, feature `waiting-on-you`), 0.41
(retirement deletes no branch; `retire --delete-branch` is refused and the
Desktop no longer offers it; new sessions run on the OATS tmux server, named
by the socket each row records), 0.42 (a retire plan carries two recovery
notes and a retire receipt's `workRecovery` adds `home`, `notCopied` and
`afterHooks`, which the lifecycle readers accept), 0.43 (schedule and
trigger rows carry `description`, and `<kind> update <id> --description`
sets one, feature `automation-descriptions`, which gates the summary
writes) and 0.44 (launch-prompt answers: the spawn preview's optional
`launchPromptAnswers`, `E_SPAWN_INCOMPLETE` details' optional `launchPrompts`
and the `launch-prompt` instance event, all read as optional, no new gate), and the `packages-no-approval` fence is the real
gate.

## Projection and ownership

`deployment-data.mjs` validates and copies each command's own shape once for
rendering; it computes no drift and invents no identity. The roster root must
be `D/agents`, every soul directory must be inside `D`, and the header's
`workspace.local` must be `D/oats-local.yaml`. An instance row whose reported
home is not `<soul dir>/instances/<instance>`, or that repeats another row's
home, is **withheld** and counted in the header — never published, addressed
or silently dropped.

The observer admits at most two deployments at once, and the cycle reads the
registered deployments through a pool of that size (`mapBounded`), first come
first served: every deployment is read each cycle, and a slow one holds one
slot while the others go through the other. The observer reserves its bounded slots synchronously, admits on the current
deployment/CLI revision before each invocation and on completion, releases a
reservation only after both reads settle, coalesces in flight only, and copies
results per waiter. `/api/panel` serves the latest observation and never waits
on a CLI read, so readiness probes stay responsive. The spawn catalog
(`oats souls`) and the capabilities table (`oats capabilities`) are read in the
same cycle but never block the roster; when they run, what is held and when a
cycle runs is [desktop-load-path.md](desktop-load-path.md).

## The open set and adding a workspace

The Desktop keeps two sets, never confused. The **served** set is the list of
deployment directories its app-owned server is started with, one `--dir` each:
only deployments that validate now. The **persisted** open set is
`workspace-open.json` in the app's user data: every saved path, whether or not
it validates at this moment, plus what was opened since. A deployment is a
directory holding a regular (lstat, non-following) `oats-local.yaml`; nothing
else counts (`wsValidate` in `main.mjs`, `validateWorkspace` in
`workspace-registry.mjs`).

The persisted set can therefore hold entries that are not served: a deployment
on a volume that is not mounted yet, or a folder that stopped being a
deployment (the Desktop cannot tell the two apart, so it does not guess). Such
an entry is inert: it is never served, never reported as "not served" (that
needs a deployment that validates), and never offered by the switcher. Each
launch re-validates the persisted set, so a deployment that came back is served
again. **Only an explicit remove drops a saved path**; nothing else does.

- **Launch.** `restoreWorkspaceDirs` opens the saved deployments plus the
  launch directory (`--dir`, `OATS_DESKTOP_DIR` or the cwd) when that is one. A
  launch from a folder that is not a deployment (a parent such as `~/Agents`)
  opens the saved set and logs that it did. A folder that is not a deployment
  is never served, whatever the launch (`/` from Finder included): when nothing
  is a deployment the server starts with no `--dir` (it serves no local
  deployment, never its cwd; main starts it in the first served deployment,
  else the home directory), and the first window is *choosing*.
- **Persisting.** `persistedOpenSet` writes the saved paths as they were, in
  order, then the served deployments they lack, each once. Only deployments are
  ever added to it (`persistableDirs`), so a non-deployment never enters the
  file, and it is never written empty. A launch writes it only when it opened a
  deployment the file lacks (`startupOpenSet`); an add writes it on commit
  (`commitOpenSet`). Neither drops a saved path that does not validate now.
- **Adding.** Every add goes through `createPerformAdd`: `decideAdd`
  (canonical path, provenance, validation), then the transactional executor
  (`createAddExecutor`). The replacement server is started with `stageDirs`:
  the members of the served set that still validate plus the new deployment,
  never a path that does not validate. Only the persisted set never loses an
  entry; a served deployment that went missing during the session is not
  served by the replacement, and stays persisted. Both sets are committed only once the new server
  advertises the deployment, the persisted one first; any failure (a failed
  write included) restarts the previous server and leaves both sets as they
  were. A refusal returns
  before any effect, so the open set and the running server are untouched.
- **Provenance.** `workspace:add` admits only a path the Desktop offered or
  knows: a suggestion, a deployment offered beside a refused pick, or one in
  the session's known set (the saved file as read, the open set, every
  committed add). The native picker (`workspace:pick`) is its own provenance.
  Suggestions are the deployments in the known set that are not served (a
  saved one whose volume was mounted after launch), the validated recents,
  and the deployments directly inside `~/Agents` (`deploymentsInside`: at most
  `PICK_SCAN_LIMIT` entries, links not followed, nothing parsed), so a fresh
  machine needs no Browse.
- **A picked folder that is not a deployment** is refused with "This folder
  isn't an OATS deployment: it has no oats-local.yaml. Choose the deployment
  folder itself, the one that contains oats-local.yaml." `pickedFolderChoices`
  says where the deployment is, without parsing anything: the deployments one
  level down (at most 200 entries read, typed by the entry so links are not
  followed, sorted by name, 20 listed and "and N more"), or the deployment the
  folder is inside (up to 8 levels up). Each choice is one click through the
  normal add. With no choice, onboarding (`oats onboard`, through a
  single-use offer for that exact folder) is the secondary action "Set up a
  new deployment here…", never the default reaction.

## Workspace views and deployments

A **deployment** is one place a workspace runs: a local deployment directory
the server is started with (its id is the canonical path) or a group of the
kernel's remote roster (id `remote:<server>:<targetKey>`). A **workspace
view** is what the switcher lists and a window shows: every deployment, on
this Mac or on a registered server, that reports the same workspace identity.
Views are built per request from the held observations and the remembered
remote identities, never by a CLI read (`server/workspace-views.mjs`, the
`OATSWEB_VIEWS` block of `server/oats-web.mjs`).

A matched identity's view id is `ws:` and 20 hex characters of a hash of its
key and default team: never a path, so it cannot collide with a deployment
id. A deployment that cannot be matched is **unattached**: it gets a view of
its own whose id is its deployment id, so a selection saved under that id
still names it.

### The identity

- **Local:** the `workspace` object of the deployment's own `oats status
  --json`, kept by `deployment-data.mjs`, and only when the probe declares
  `workspace-identity`. It is always read fresh.
- **Remote:** the group's `workspace` from `oats server roster --json`,
  verbatim, from a reached group only. `null` means no report; an object with
  no `key` field comes from a host before 0.36.0, which never reports one.

Nothing is derived from a path, a ref or a host name, and a shape the
contract does not allow is not matched.

### Matching

Matching follows the kernel's rules,
[Matching workspaces across machines and Matching teams across machines](../../../docs/desktop-cli-api.md#workspace-identity-feature-workspace-identity-oats-0360).
The outcomes:

- Deployments share a view when each reports `keyFrom: "workspace"`, their
  `key`s are equal and their default teams (`defaultTeam.team`) are equal.
  `ref` is never compared.
- An unmapped default team matches only unmapped.
- Unattached: `keyFrom: "member"`, a `null` key, an unknown team (a `null`
  default team with `standalone: false` and `teamsFrom: "local"`), no report,
  and a host before 0.36.0.
- The same key with another default team is another workspace. Both views'
  names then say which team: its label, else its id, or `unmapped`.

A view is named by its first local deployment's workspace name, else the
key's last segment.

### The primary deployment

A view's **primary** deployment is its first local deployment, else its
first. Deployment-level surfaces read and act on it: the Workspace header and
Setup, Capabilities, Sync, Automations, Schedules, the Teams configuration,
the soul inspector, Brain and launch configurations. In a view of two or more
deployments each of them says which under its heading ("On This Mac ·
~/Agents/oats"); a view of one shows no such line. The Deployments page has
no primary: each deployment has its own tab, and nothing there is marked
"primary".

### The panel

`/api/panel?ws=<view id | deployment id>` answers a view. A deployment id
answers the view that holds it; no `?ws=` answers the first view.

- `workspace` is the view (`id`, `name`, `primary`, and `key` and `teamId`
  when it is matched). `primary` is the primary deployment's id: a route that
  echoes the deployment it resolved (readiness, spawn preview) is sent that id,
  never the view id. `deployment`, `error` and the stamps are the primary
  deployment's.
- `workspaces` is the switcher's list of views, each with its `deployments`
  ids, `deploymentLabels`, `machines` (each machine once, in order) and
  `notLive` (how many of its deployments aren't live, stale ones included). The switcher shows the
  name, one muted line of machines ("This Mac · altair") and a mark when
  `notLive` is not zero: never a path, an id or a reason. Unattached views
  carry `unattached`, their `reason`, `short` and the `ref` they report, and
  are listed under "Not matched to a workspace" with the machine and the short
  reason; choosing one opens its tab on the Deployments page
  (`requestDeploymentTab`, `renderer/deployment-tabs.mjs`). Those fields are
  sent only when this computer's CLI has `workspace-identity`: without it
  nothing could be matched, and the entries list as they did before views.
- `deployments` lists every deployment of the view, even a single one:
  `{id, machine, path, label, local, reachable, identityFrom, primary,
  stale?, reason?, short?, fix?, note?}`. `machine` is "This Mac" or the server's label, else its
  id. `deploymentLabel` (`renderer/deployment-label.mjs`) shows it as "This
  Mac · ~/Agents/oats" or "altair · ~/Agents/tsm": the home directory as
  `~` (on a remote, a `/Users/<name>` or `/home/<name>` prefix, a display
  guess) and the last two segments of a long path. A deployment is live
  (`reachable`), not reached (with its `reason`), remembered
  (`identityFrom: "remembered"`, the last report, not live), or stale
  (`stale`: this computer's deployment whose last re-read failed, its rows
  the last observation, "Last read failed" with the kernel's message). A
  stale deployment's rows wait for a current read, as on a stale roster:
  Start and the actions menu in the sidebar, the overview's actions. It stays
  `reachable`, so spawning there is not blocked. `note` is information, not a
  failure.
- `instances` is the union of every deployment's rows, each tagged
  `deployment: {id, machine, path}`. The sidebar's instance list shows a
  heading per deployment (in its group-heading style, named by
  `machineLabels`: the machine, with the path tail when one machine holds two;
  the machine is uppercased, a path tail never is, since a path is
  case-sensitive) only when the view has two or more, and none for a deployment with no rows;
  with one it has no headings. Rows never repeat the workspace name, and a
  row's identity line keeps its host.

### A workspace's own machines

The view's key (its primary local deployment's, `keyFrom: "workspace"` only)
also chooses which registered servers the window offers: Where to run, the
Setup tab's Machines box and Add a machine list only the registrations that
report that key. See [desktop-machines.md](desktop-machines.md).

### The Deployments page

The former Active overview (stage `hierarchy`, Mod+1) shows the view's
overview trees and nothing deployment-specific beyond them. Its tabs
(`renderer/deployment-tabs.mjs`) are **All**, then one per deployment in
served order, named by `machineLabels`; a view of one deployment has only
that deployment's tab, so the machine is always named. The selected tab is
remembered per view in localStorage (`oats.desktop.deploymentTab`, ids only,
at most 32 views). When the tabs overflow, the strip scrolls horizontally and
the selected or focused tab is revealed, as in the terminal tab strip. The
header's count line counts the selected tab and sits at the right of the
header. The page has no Spawn button (Spec E): `S` on the canvas, the
sidebar's Spawn instance, Quick Open and the soul cards spawn.

- **All** stacks one section per deployment, headed by `deploymentLabel`
  (the full path in a tooltip) and its counts: the machine in the
  group-label style (uppercase), the `· path` in normal case in the muted
  secondary style, like the counts; relations never cross
  sections, and pan, zoom and fit work over the whole canvas.
- **A deployment's tab** shows only that deployment's tree.
- A non-live deployment's heading carries a state chip ("not reached",
  "remembered", "stale"; "not matched" for a reached one with a reason) and
  its `short` reason, with **How to fix** under it: the `fix` steps when
  there are any (they carry every fact the sentence has, a host or a
  reference), else the full sentence (`reason`), and any `note`. On its own
  tab, a non-live deployment with no rows shows that block as the empty
  state.
- A live deployment's `note` (a remote that now reports another workspace, a
  standalone host's local teams) is said under **Details** on its heading,
  with no chip and no mark. A view of one deployment with a note keeps that
  heading; with no rows the note heads the usual empty message.

### Scope per row

- **Instance-addressed** requests go to the row's own deployment,
  `?ws=<row.deployment.id>`: terminal resolution, chat, start, restart,
  harvest, lifecycle, readiness, events, Git, the instance's pull request
  and review threads, and capabilities, launch configurations and
  schedules that name a home. The server resolves these
  only by exact deployment id, so a view id there is refused, and
  `admitInstance` resolves a row only inside its own deployment. The
  schedule form's add and update go to the deployment its home list was read
  from, and only while that form is open; a list action (remove, reconcile,
  host install) goes to the view on screen, never to a deployment an earlier
  form read.
- **Deployment-level** requests (the agents catalog, teams and soul teams,
  sync, automations, schedules without a home, capability show and catalog,
  Brain, a soul's launch configurations, spawn preview and apply) may send
  the view id: the server reads the view's primary deployment. Spawn sends
  the chosen deployment's id, and a remote spawn's reply names the view that
  holds the new group.
- **View-level:** `/api/panel`, `/api/team-members` and `/api/forge-roster`
  (the union of the view's local deployments' rows and clones).
- "Is this still the workspace on screen?" checks are keyed by the view id.
  Main lets a caller select every id `servedSelectors(panel.workspaces)`
  returns (`api-url.mjs`): every view id and every deployment id, so a
  deployment id is never rewritten.

### Remembered remote identity

`remote-identity.json` in the app's user data (`server/remote-identity.mjs`)
holds the last identity each remote group reported, keyed by
`<server>:<targetKey>`. It is written atomically (a temporary file, then
rename) with mode 0600; a missing or malformed file is an empty memory.

- Only a reached group with an identity is a report, and a fresh report
  always wins. A group that reports another workspace moves to that view, and
  its deployment says so for the session ("altair now reports workspace
  tsm.").
- An unreachable group with a remembered identity stays in its view, not
  reached, with `identityFrom: "remembered"`.
- Memory never attaches a local deployment.
- A group that a roster answer no longer lists is dropped, with its memory.
  With no roster answer at all, the remembered groups are shown not reached,
  with no rows and the roster's failure as their reason.

### Reasons

Each deployment that is not live, or not matched, carries its reason in three
parts (`deploymentReasonParts`): `short`, a few words for a heading or the
switcher ("ssh needs a prompt", "OATS too old to report its workspace");
`reason`, the one plain sentence; and `fix`, the plain steps (none when the
sentence already says what happens next, as for a timeout). The sentences:

- ssh needs a prompt or a host key (`E_SSH`): "altair needs ssh to connect
  without a prompt; run `ssh altair` once in a terminal."
- Timed out (`E_ROSTER_BUDGET`, `E_CLI_TIMEOUT`). The kernel reports an ssh
  that timed out as `E_SSH` with ssh's own text, so a timeout is recognised
  from that text (a known limit).
- Any other failed read: "<machine> was not reached (<code>)."
- The host's OATS is too old to report its workspace (the group was reached
  but its object has no `key`), or the host reports no workspace (`null`).
- An unresolved member reference (`keyFrom: "member"`): run `oats sync`
  there.
- An invalid reference (`null` key): the ref and "fix oats-local.yaml"; the
  fix step names the ref.
- This computer's deployment whose re-read failed (the last observation kept,
  `E_REMOTE_UNREADABLE`): "This deployment's last read failed: <the
  kernel's message>. It shows what was last observed." It is `stale`.
- An unknown team: "This host hasn't observed its workspace yet; run oats
  sync there."
- Standalone and unmapped: "Teams are local only on this host
  (standalone)." This is a `note`, not a failure.
- This computer's OATS can't read other machines, or is too old to report
  workspaces (no `workspace-identity`).

### Migration

- A selection saved before views (a path or a `remote:…` id) opens the view
  that holds that deployment, and the renderer adopts the view id
  (`staleWorkspaceSelection`).
- Tab memory, open terminal tabs and spawn jobs kept under a deployment id
  move to the view that holds it.
- `servers.json`, saved routes and `workspace-open.json` are untouched: the
  open set still lists deployment directories.
- A group that never reports keeps a view of its own.

## One window per workspace

Main keeps at most one window per workspace view id (`window-set.mjs`). A
window is bound to its workspace by its renderer URL's hash, exactly
`#ws=<encodeURIComponent(id)>` (`renderer/window-binding.mjs`); no hash is a
window with no workspace yet. Every privileged frame check accepts the
renderer file with no hash or that hash and nothing else: another hash or any
query is refused (`trustedRendererUrl`, shared by main, the proxies and the
terminal owner).

- **Requests.** The API proxy reads the sending frame's workspace. A bound
  window's implicit `?ws=` is its own workspace, never main's verified one,
  and an explicit one is never rewritten (`apiUrl`'s bound mode).
- **Binding.** A window switches through `window:claim-workspace`: main
  refuses a workspace another window holds and brings that window to the
  front (or, for a view that moved under a window, doesn't); a deployment id
  is bound as the view that holds it. The renderer runs one claim at a time
  and commits a switch only after main's yes (`switchWorkspace` in
  `renderer/views/common.mjs`), so a switch never leaves its hash and main's
  registry apart.
- **A view observed under a window.** A window bound to a deployment whose
  identity is observed later (its view gets a `ws:` id) is moved to that view
  in main as soon as the served list names it (`noteServed`), focusing
  nothing, so no other window can take the workspace meanwhile. Its hash
  still names the deployment until its next roster read follows the view
  (the #482 rehome claim, a no-op in main by then); its requests stay
  valid in between, the deployment id being served. If another window
  already has the view, nothing moves, and that follow leaves this window
  choosing.
- **No workspace.** A New Window, a window whose view moved to a
  workspace another window has, or the first window of a launch with no
  local deployment to serve, is *choosing*: main's refusal carries the
  served choices, and the window reads nothing until it binds. Its choices
  follow what is served: its roster poll asks main (`window:choices`, which
  re-reads `/api/panel` and binds nothing), so the remote views served a few
  seconds after launch appear. Its switcher menu also lists the suggestions
  under **On this computer**, looked up each time the menu opens; one click
  runs the normal add and opens the deployment in this window. Only with
  nothing served and nothing suggested does it say no choices are reported.
- **Records.** `windows.json` (`window-records.mjs`) keeps each window's
  view id, the deployments that view held, its bounds and state, written
  atomically after moves settle. A launch restores the windows whose views
  are served, bounds clamped onto a visible display. A `ws:` view id exists
  only once the server has observed a deployment's identity, a few seconds
  after it starts: until then a record resolves through its deployments, to
  the view that holds one of them (as the server's `viewFor` does), and the
  window follows to its `ws:` view when it is observed, by the same rehome
  claim, focusing nothing. A record goes only when its window is closed
  while its workspace is served, never at quit, or at launch when its view
  and every deployment it names are folders that exist but are not
  deployments (a window once bound to `/`): such a folder is never served.
  A record naming a missing path stays, like a saved deployment on a volume
  not mounted yet.
- **Per window.** Suggestions, picks and adds have a generation and a
  provenance per sending window; adds still run one at a time through the
  one executor, since each replaces the shared server.

## A deployment the server does not serve, or does not answer for

A window never waits silently on "Reading the deployment…":

- **Not served.** The server answers any explicit `?ws=` that is neither a
  view id nor a deployment id it serves (a path, a bare id, a remote it no
  longer has) on `/api/panel` and `/api/agents` with 404 `{ error, code:
  "E_WORKSPACE_NOT_SERVED", workspace }` (`workspaceNotServed` in
  `renderer/deployment-header.mjs`) instead of the first view's data. No
  `?ws=` still means the first view. The main process's API proxy refuses
  the same reads with the same body, without fetching, for a deployment it
  knows (and that is still one) but the server does not advertise
  (`createUnservedRefusal` in `api-url.mjs`). While the server is being
  replaced it refuses against what the outgoing server advertised, so a
  Re-add's own reads are never rewritten to another workspace before the new
  server advertises it. From a window with no workspace yet, an id it does
  not know is still pinned to the verified workspace and the renderer adopts
  the served one (`staleWorkspaceSelection`). A window bound to a workspace
  (below) is never rewritten: any workspace-scoped request of its own whose
  workspace (its `?ws=`, else the window's) is not advertised gets the same
  404 on every workspace-scoped route (`windowRefusal` in `api-url.mjs`).
- **No answer.** A deployment left without an observation, on one
  connection, for `PENDING_LIMIT_MS` (45 s: the 30 s deployment read timeout
  plus the cycle around it) is reported as no answer (`createPendingWatch`).
  The wait runs from the first read that brought none: answered "pending",
  failed in transport (the proxy's timeout, the bridge down) or not answered
  yet. Any other answer ends it, a Retry starts it over, and an observation
  that lands later replaces the error. The deadline is a timer owned by its
  subject (cancelled by an answer, another deployment or connection, a Retry
  or the view's teardown), so it fires at 45 s even while a read that never
  answers holds the poll: both views poll one read at a time and never
  supersede a read in flight. A connection change is the exception: both
  views read on the new connection at once, which revokes the old read's
  outcome and arms the new connection's own deadline.
- **With an observation on screen** (a new connection still reading), a
  "pending" answer keeps the rows as they are, never an empty roster; past
  the bound they go stale with the no-answer reason.
- **Where.** The sidebar roster uses the shared failed state
  (`renderer/loading.mjs`, with a second action) and the Deployments page its
  notice: the message names the deployment path, Retry is always offered and
  **Re-add workspace** when the server does not serve a local deployment.
  Re-add sends that exact path through `workspace:add`, so it restarts the
  server with the whole set. Its outcome belongs to the selection it started
  in: after a switch it does nothing, and a refusal never replaces an
  observation that landed meanwhile. Background re-reads of a failed state
  are not announced again. The switcher keeps offering the served views.

## Remote rows

A remote deployment is one group of the kernel's remote roster (`oats server
roster --json`, projected by `server/remote-roster.mjs`), shown in its
workspace's view; its rows carry `server`, `home`, and the kernel's
`addressable` and `missingRemotely` facts.

- **One predicate.** `canAddressRemote(row)` in `renderer/remote-address.mjs`
  (re-exported by `server/instance-admission.mjs`): a local row, or a remote row
  with `addressable === true`. It gates every action on a row: opening the
  terminal, Start…, the actions menu, the context panel's buttons, the start
  and restart dialog and route, launch configurations, inspection, lifecycle
  plans and applies, readiness, activity, Git and diff, and the wait for a
  started or spawned instance's terminal. `savedRoute` (spawned from this
  machine) decides only when this computer's OATS predates 0.31 and reports no
  `addressable`: a row it spawned stays reachable through its saved route.
- **Why a row can't open.** `rowReason(row)` in the same module is the one
  source of a row's reason: a short label on the roster meta line (Herdr no
  longer supported, gone from `<server>`, not reachable on `<server>`,
  `<server>` not reached, state unknown), and the full sentence used as the
  row's `title`, `aria-description` and the actions menu's reason. The server
  label is the registration's label, else the server id.
- **Admission.** `admitInstance` admits a remote selector only in its own
  remote deployment (the same server id in another group is another
  deployment), for a row that passes `canAddressRemote`, when this machine's
  probe lists the operation's `remote` entry (`readiness`, `instance-events`,
  `instance-git`, `lifecycle-plans`). Otherwise it refuses and nothing is sent;
  a local selector never resolves in a remote deployment, or the reverse.
- **Addressing.** Every routed command names `--server <id> --home <abs>`, runs
  from this machine's first deployment directory (else the home directory)
  as its cwd, and carries no
  `--dir` (the kernel sends the registered workspace). Nothing remote is
  addressed by a bare `--instance`. A remote terminal is keyed
  `["remote", server, home]`.
- **Deadlines.** A remote read or plan has 45 s at the CLI (ssh's 15 s connect
  timeout plus the command) and 50 s at the renderer→main proxy; an apply keeps
  its 600 s / 610 s.
- **Refusals.** A host refusal is relayed as `{code, message, detail, remote:
  true}` (`hostReason`): the kernel's code, a headline naming the server
  (`remoteHeadline`, the view's own sentence for codes outside its table), and
  the kernel's message as the detail, through the display filter. Every hop
  re-validates it (`remoteReason`: the headline and the detail must each
  already be a display line); views show the headline with the code and detail
  behind Details. A missing `remote` entry is
  "This computer's OATS can't route this to `<server>`. Update OATS here."
- **The display filter** (`renderer/display-text.mjs`, `displayLine`) is the
  one way a refusal's `detail` reaches a view. Text that looks like a credential,
  or holds DEL or a C0 control character other than tab and line feed, is
  withheld whole (`[Detail withheld]`), tested on the text as given. Otherwise it becomes one
  line: tab, line feed and the Unicode line and paragraph separators become a
  space, runs of spaces collapse, the ends are trimmed, each remaining
  character of the waiting note's refused set (control, bidirectional
  embedding, override and isolate, zero-width space, word joiner, BOM, tag
  characters) becomes U+FFFD, and the line is bounded to 2048. The set has one
  definition, in that module. The result is lossy and for display only: two
  texts can become the same line, so it is never compared, selected by,
  sent in a request or used as a path, a command or a name. It is for free
  text, not for a name that identifies something.
  - A view sets the detail as text, alone inside a `<bdi>`
    (`codeLineNodes`); the code and Desktop's own words stay outside it.
  - A refusal's detail never goes into an attribute: the stale line's `title`
    holds the read's message and the code, the code only in the kernel's code
    shape. The detail stays in Details.
  - A headline shows the server's label as a display line too (a label with
    nothing to show reads "the server"); routing, comparison and requests keep
    the label and the server id as the roster reports them.
- **Views.** A remote read in flight says "Reading from `<server>`…". A remote
  row's pull request stays unavailable: the forge reads this machine's clones.
- **Lifecycle.** A remote apply that times out or loses its link is an unknown
  outcome, never a failure; codes the router or the host refuse before any
  effect (`E_REMOTE_INCOMPATIBLE`, `E_AMBIGUOUS`, `E_HOME_MISMATCH`,
  `E_SNAPSHOT_UNKNOWN`) are refused. The routed retire receipt may also carry
  `server` and `target`; a local one may not. After any remote apply the
  remote roster is re-read at once.

## Unchanged, v2-agnostic

Terminal-target liveness (`server/liveness.mjs`, run out of process by `server/liveness-main.mjs`) still
observes the exact recorded tmux socket/session/window — it reads no deployment
file. A Herdr-recorded row (a `sessionTarget`, or `runtimeState: "unsupported"`)
is never probed: it is reported unsupported with the kernel's E_HERDR_REMOVED
`runtimeError`, or with the E_HERDR_REMOVED stem when an older kernel gave none.
`remotePanel` does the same for remote rows, including an older remote kernel's
`backend: herdr` row, and `unsupportedSession()` in
`renderer/instance-presentation.mjs` is the one rule both sides use. Such a row
cannot open, start or restart; it can retire. The terminal owner broker, tmux admission, file
guard, spawn preview/apply, lifecycle, events, schedules and Git boundaries are
unchanged; they now receive their roster rows from the kernel observation.

## Retired

`server/deployment.mjs` (config/soul/manifest/lock readers, legacy local-soul
directories, digest replication), `server/model.mjs` (TASK/STATE inference,
knowledge counts), the `oats-web.mjs collect` child, and the catalog DTO
(`server/catalog.mjs`, `/api/catalog`, `renderer/official-catalog.mjs`) are
deleted. Workspace registration validates a directory holding a regular
`oats-local.yaml` (existence only); there is no team-scope sibling discovery.

## Known later-slice residuals

- The composite admission key still names the kernel's roster root
  `agentsRoot` across the preview/apply/lifecycle/events/schedule boundaries.
- The Capabilities tab's classic `list` inventory is a 0.24 surface.
- Souls not yet materialized in `D/agents` (workspace members' souls) are the
  F3 v2 spawn catalog.
