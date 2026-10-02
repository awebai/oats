# Desktop load path: parallel cycle, held catalogs, focus-safe cadence

How the backend (`server/oats-web.mjs`) turns kernel reads into what the
renderer sees, and why it is shaped this way. The kernel stays the model
(`docs/desktop-deployment-model.md`); this page is about *when* the backend
asks it and *what it keeps*.

## The observation cycle

One cycle reads every registered deployment (`observeDeployment` each),
at most `MAX_DEPLOYMENT_OBSERVATIONS` (2) at a time, first come first served
(`mapBounded`, `server/deployment-observer.mjs`): the bound is the observer's
own admission, so no deployment is refused for being third. An empty
deployment (no souls, no instances) is an observation like any other: it is
published as `observed` with no instances, never left `pending`. For each:

1. `oats status` and `oats workspace status` run together
   (`server/deployment-observer.mjs`). On a **cold** cycle — nothing held for
   the deployment, or only a failure past its retry window — `oats souls` and
   `oats capabilities` start in the same tick, *unbound*: their key is not
   known until the workspace status lands.
2. When the two roster reads land, the roster snapshot is published. It never
   waits on souls or capabilities.
3. The cycle's key (`soulCatalogKey`: CLI bin/version, workspace commit,
   member commits/status, externals) binds the unbound reads (`settle`). A
   read that already landed is bound the same way. The souls catalog is
   attached to the published snapshot entry when it lands; `/api/agents`
   reports `refreshing: true` until then.
4. On a **warm** cycle nothing but the two roster reads runs. Souls and
   capabilities are re-read only when their key moves.

The holding rules live once, in `server/keyed-catalog.mjs`, and the two
catalogs are thin wrappers over it (`soul-catalog.mjs`,
`capability-catalog.mjs`):

- one flight per deployment; a failed read keeps the last good value with the
  failure next to it, and background cycles retry it only after 60 s;
- an unbound prefetch is bound **only by the same cycle's settle**. Every
  prefetch opens a cycle; a flight (or a landed value) from an older cycle —
  its roster reads failed — is never bound to a state it was not read under,
  and that cycle reads under its own key at settle time. A value that landed
  unbound is still *held*, so a deployment whose roster reads keep failing
  (a status timeout) costs
  one souls/capabilities read per window, not one per cycle. A value held
  under `null` answers for no key;
- the retry window throttles background cycles, never a user: a request that
  finds no good value held (`demand`) reads now; `refresh` is a live read
  (`--max-age 0`) that joins only a live flight for the same key — a
  background flight in the air may carry heads up to a minute old, so a live
  one starts beside it. On a kernel without `observe-max-age` every flight is
  live, so a refresh always joins.
- `observedAt` is the kernel's `observation.observedAt` when reported, else the
  read's completion time; a failure keeps the previous stamp. A malformed
  `observation` block is *no stamp* (`observationData` projects nulls): the
  stamp is provenance beside the result, and a bad stamp never costs the
  roster, the catalog or the document.
- a keyed flight that lands after the key moved on (a newer `settle`,
  `demand` or `refresh` under another key) is not held, so a slow read under
  an old state never overwrites the newer state's entry; every flight still
  resolves with the entry *it* built, so a request awaiting it is answered for
  the key it asked, never with whatever happens to be held (or nothing).

Every held result also has an **age bound**: `HELD_TTL_MS` (60 s, the
background max-age; `server/keyed-catalog.mjs`) from the time it was stored,
for the souls catalog, the capabilities table and inspections alike. Past it
the entry is `stale`, and staleness is **request-driven**: the observation
cycle still answers from a stale entry and never starts a catalog re-read
because of age alone (a `souls` plus an `oats capabilities` run — 26–34 s,
hundreds of git processes — per deployment every minute, focused or blurred,
is exactly the churn the app must not cause; key changes and admission
re-read as before). A *request* that finds the entry stale — `/api/agents`
(`revalidateCatalog`), a `/api/workspace-sync` read — answers at once from
the held value with `refreshing: true` and starts **one** re-read behind it
(`revalidate`: single-flight, joined by every request and cycle until it
lands, attached to the published entry when it does; it starts nothing while
another key's flight is in the air — that read answers). An inspect past its
TTL is a miss and awaits its per-subject read (~7 s). `/api/agents` is
*polled* by the renderer's Spawn/Workspace view every 8 s while mounted, so
its revalidation is gated on window focus (`refreshLoop.focused()`):
focused with that view open, the souls catalog is re-read about once per TTL
+ read; blurred or minimized, never. The capabilities table is read on tab
open and Retry only, so it needs no gate. So a catalog is re-read when
*viewed* after 60 s: a Workspace-tab visit never waits for a kernel run while
the key is unchanged, and a blurred app costs nothing. The key sees what
`workspace status` reports; the TTL bounds what it cannot — local
configuration edited outside Desktop (`oats teams`, `oats soul teams`, `oats
sync` from a terminal, an agent editing its own teams) is seen within the TTL
plus one read *of the next time someone looks*. There is no pre-emptive
(TTL/2) refresh: the kernel's local-configuration revision behind
`observe-max-age` is the real fix and comes as a follow-up. The Desktop does
not stat, name or parse
any deployment file to find out sooner: which files hold local configuration
is the kernel's to know (`test/desktop-package-boundary.test.mjs` enforces
it), and a kernel-computed local-configuration revision is the maintainer's
planned follow-up behind `observe-max-age`.

The capabilities key (`capabilityCatalogKey`) is the souls key plus package
identity (id, version, commit, integrity from the lock rows) and lock currency
(`declaredPackages`, `unsynced`, `stale`, lock path/version): the table lists
member and package capabilities and whether the lock is current, and nothing
else in `workspace status` changes it.

## The request path never runs a kernel read it can avoid

- `POST /api/workspace-sync {action:"read"}` answers from the held table at
  once while it is a healthy answer inside its TTL. When the latest re-read failed the answer is
  today's failure shape (`status` non-ok, `reason`, `capabilities: null` —
  the renderer shows the error and Retry exactly as before) with the additive
  `lastGood: { capabilities, observedAt } | null` beside it for a renderer that
  can label a stale table; a healthy shape is never a stale one. A request
  that finds no healthy table held — a first read, or a held failure, table
  behind it or not (today's Retry button is a plain read) — reads now,
  whatever the retry window says, and answers with what lands; a healthy table
  past `HELD_TTL_MS` is answered at once and this request starts (or joins)
  its re-read, announced as `refreshing`. `refresh: true` forces a live read.
  An ok `sync` forgets the held table.
- `POST /api/capabilities {action:"show"|"file"}` (`oats capabilities show`, the capability
  page's Contents; `server/capability-show.mjs`) goes through its own LRU of 48 decoded
  answers with in-flight coalescing. Keys: (deployment, selector, the held catalog row's
  commit[, file path]). A capability's content at one commit never changes, so the commit is
  the whole invalidation story: a sync or pull moves it and the next read misses. A row
  without a commit, and an answer about another commit than the row's (the head moved
  between the two reads), are coalesced but never held. A `file` request is answered only for
  a path the (cached) show listing names. The cache is cleared when the CLI changes.
- `POST /api/capabilities {action:"inspect"}` goes through a bounded LRU with
  in-flight coalescing (`server/inspect-cache.mjs`, 256 entries): two identical
  concurrent inspections are one kernel process; a repeat is a hit for at
  most `INSPECT_CACHE_TTL_MS` (= `HELD_TTL_MS`) after it was stored, then a
  miss: the TTL bounds what no key can see (local configuration, teams
  changed on the messaging side, the launch choice this machine would make
  now). Keys: `inspect --soul` → (deployment, server, soul, agents root,
  capabilities key);
  `inspect --home` → (deployment, server, home, instance, and the status row's
  identity and drift facts: createdAt, startedAt, soul, modules), so a retire,
  restart or drift change is another subject. `refresh: true` bypasses the
  entry and shares only a live flight; the soul page's Refresh ("Inspect
  again", `renderer/soul-inspector.mjs` `show(selection, { user: true })`)
  sends it, a plain visit does not. `run` never reads or fills the cache.
  A **remote** workspace has no state key and no invalidation signal on this
  machine, so its inspections are shared between concurrent requests but
  never held between visits (`store: false`): every visit is live, as before.
- Every mutation the backend performs for a local deployment
  (`observeMutation`: lifecycle apply, spawn apply, session start/restart,
  operation run, sync, teams and soul-teams writes) drops the inspect entries
  held under that workspace's *scope* (the deployment directory the kernel
  was pointed at) and observes the roster live. A real CLI change drops
  everything.

## Cadence and window state

`server/refresh-loop.mjs` owns when a cycle runs: the next one starts a fixed
interval **after** the previous completed — 5 s while a window is focused,
30 s while every window is blurred or hidden — so a slow kernel is never asked
twice at once and an idle app costs little. A cycle requested during a cycle
(a mutation's follow-up) runs exactly once right after.

The Electron main process posts `{ focused }` (a strict body: that key and
nothing else) to `POST /api/window-state` when the reduction of its windows
flips (`window-activity.mjs`: visible, not minimized, focused). Focus
returning runs one prompt cycle. A headless server assumes "focused".

The remote roster (`refreshRemoteSnapshot`, one bounded `server roster` read
per configured host) runs on a second `createRefreshLoop`: 10 s after
completion while focused, 30 s while blurred, driven by the same window
state.

Each window's sidebar roster re-reads every 4 s while that window is focused
and every 30 s (the blurred cadence) while it is not
(`renderer/roster-cadence.mjs`); focus returning reads at once. The server
observes no faster while blurred, so an unfocused window's extra reads would
show nothing new.

## The CLI probe is compared, not trusted by identity

A window focus re-probes the CLI (`POST /api/cli/reprobe`). The probe
generation — the revision every pending deployment read is admitted under —
moves only when `probeSignature` (`renderer/cli-probe-contract.mjs`:
everything but `probedAt`, `tried`, `source`) changes. An unchanged probe
updates the diagnostics in place, cancels nothing and wipes nothing. The
renderer's `cli-status.mjs` applies the same rule before notifying its
subscribers (which treat a notification as "the CLI changed"), so the focus
reprobe is a no-op end to end. A changed bin, version, feature list, API
integer or remote list still invalidates as before.

## `--max-age` (kernel feature `observe-max-age`)

When the probe declares the feature, the read adapters
(`deployment-read-cli.mjs`, `workspace-cli.mjs`, `cli-adapter.mjs
cliCapability`) append `--max-age <seconds>` to status, workspace status,
souls, capabilities and inspect: `0` for the first cycle of a deployment
(admission), a mutation's follow-up and any `refresh: true`; `60` for
background cycles, key-change re-reads, inspect cache misses and the focus
prompt cycle. Without the feature the argv is byte-identical to the flagless
one whatever the caller asked. Reuse is local only: a routed call (`--server`)
never carries the flag, and mutating verbs refuse the option
(`renderer/deployment-contract.mjs`: `maxAgeArgv`, `validMaxAge`). The kernel
reports `observation` only when the flag was passed; otherwise `observedAt` is
the read's completion time.

## Contract additions (renderer-facing, additive)

`/api/panel`, `/api/agents`, `/api/workspace-sync` read and `/api/capabilities`
inspect carry `observedAt` (ISO string or null) and `refreshing` (boolean).
A failed `/api/workspace-sync` read also carries `lastGood` (`{ capabilities,
observedAt }` or null). Existing fields are unchanged.

An explicit `?ws=` the server does not serve on `/api/panel` or `/api/agents`
is a 404 `E_WORKSPACE_NOT_SERVED`, never the first workspace's answer
([desktop-deployment-model.md](desktop-deployment-model.md)).

## Testing

- Unit: `test/keyed-catalog` behaviour through `test/soul-catalog.test.mjs` and
  `test/capability-catalog.test.mjs` (both with a fake clock: no kernel run
  past the TTL without a request; a request answers at once with
  `refreshing` and starts exactly one re-read, shared by concurrent requests
  and cycles; Refresh live); `test/inspect-cache.test.mjs`;
  `test/refresh-loop.test.mjs` (fake timers); `test/max-age.test.mjs` (flag
  gate per adapter); `test/cli-probe-signature.test.mjs`,
  `test/cli-status-parity.test.mjs` (emit on change);
  `test/window-activity.test.mjs`.
- The shipped server with a scripted fake kernel:
  `test/load-path-server.test.mjs` on `test/helpers/load-path-server.mjs`.
  The fake logs every call at start and at end and **gates** the verbs the
  test names: a gated call waits after its start line until the test releases
  it, so every ordering asserted (souls started with the roster reads, the
  roster published before souls landed, two identical inspections one kernel
  run) is controlled, never timed — no delays, wall-clock waits or margins.
  Cycles run on demand: the server is blurred for the whole test (30 s
  cadence, out of reach) and a focus flip runs one prompt cycle; the cadence
  and the blur back-off themselves are proven with fake timers in
  `test/refresh-loop.test.mjs`. It proves the cold cycle, held catalogs,
  coalescing, the unchanged-focus no-op, the catalog landing before and after
  publication, the mutation follow-up and the `--max-age` gate on and off, in
  a few seconds (50/50 in a loop under a saturated CPU).
- Against a real deployment: `node server/oats-web.mjs start --port <p> --dir
  <deployment> --oats-bin <timing shim>` and poll the endpoints; never launch
  the packaged app for this.
