# OATS browser access and Windows support decision proposal

Status: **Draft under amendment after maintainer review. No funding, spike,
implementation, merge or platform commitment approved.** Audience, service
operator, credential route and budget remain unconfirmed.

Prepared for the human and `oats-expert-juan`. This document compares a hosted,
multitenant browser product with Windows desktop options. It specifies a proposed
hosted MVP in enough detail to review its boundaries, identifies what the current
interface can share, and defines the experiments needed to make a funding decision.
Product and interaction decisions remain with oats-desktop-expert; new security
boundaries, CLI contracts and release signing remain with the maintainer. Kernel
changes, if needed, belong to oats-kernel-developer.

Evidence baseline: repository commit `caf5393d523bc6f6180b07e08191cce9121dfacf`
(Desktop package 0.40.1), inspected on 2026-10-03. Code observations below describe
that snapshot. Proposed APIs, limits, milestones and estimates are design proposals,
not existing capabilities or measured performance. No Windows or hosted prototype
has been run for this assessment.

## Decision to make

The immediate need is to let people without a macOS or Linux computer interact
with OATS instances, spawn them and manage them. The initial request also describes
agents running on a Linux server, with multiple users and tenants.

These are two independent choices: **where the interface runs** and **who supplies
the execution environment**. A Windows executable solves client access; it does
not by itself supply a Linux server, customer accounts or tenant isolation. A
hosted service supplies those, whether its eventual client is a browser or Electron.

Provisional recommendation: if users must arrive with only a browser and receive
managed execution, pursue the hosted browser MVP after a bounded feasibility gate.
If the actual audience already has SSH access to managed Linux deployments and
only needs a Windows interface, evaluate a remote-only Windows client first. If
local execution and customer custody are required, assess the existing Linux app
inside WSLg before considering a native Windows UI with a new WSL adapter.
Do not make fully native Windows execution the first route to this narrower need.

Reuse one renderer across approved platforms. Do not fund a UI rewrite or a
separate permanent fork as a prerequisite for either option.

## Goals and explicit exclusions

The intended user can select a workspace, see available souls and instance status,
spawn with an opening instruction, use the agent's interactive terminal, reconnect,
and perform approved lifecycle actions. The hosted interpretation additionally
requires account provisioning, tenant isolation, limits, credential management and
an operator capable of supporting the service.

The proposal is complete for decision purposes when it establishes:

1. Which existing code and invariants can be reused, with evidence.
2. What each Windows option does and does not solve.
3. The hosted trust model, data model, request flows and failure semantics.
4. The minimum product scope and the work required beyond a browser demonstration.
5. Cost drivers, uncertainties, acceptance gates, ownership and decision questions.

Initial implementation exclusions: a new conversational transcript UI, local
Windows session backend, arbitrary customer machine onboarding in the hosted UI,
mobile-first interaction, simultaneous collaborative terminal editing, automated
billing, general shell-as-a-service endpoints, and full Desktop feature parity.
An installed Windows app here means an Electron application; a WinUI/.NET rewrite
is a separate option with no demonstrated benefit for this requirement.

## Current implementation evidence

Paths in this section are relative links to the inspected repository code.

| Area | Observed implementation | Consequence |
| --- | --- | --- |
| Renderer | [index.html](../../renderer/index.html), [shell.mjs](../../renderer/shell.mjs), styles and views are browser DOM and ES modules | Layout, themes, roster, tabs, split panes and most feature views can remain shared |
| View boundary | [views/common.mjs](../../renderer/views/common.mjs) accepts injected `ctx.api`, including Fetch responses | HTTP transport need not be embedded in each view |
| Browser harness | [harness.html](../../renderer/harness.html) and [harness-server.mjs](../../renderer/harness-server.mjs) serve views without Electron, with `openTerminal` stubbed | Evidence of browser-oriented views, not evidence of a functional hosted terminal or production shell |
| Host bridge | [preload.cjs](../../preload.cjs) exposes `window.oatsDesktop`; shell assumes it exists | Full shell will not work by serving the current HTML unchanged |
| Terminal UI | [terminal-tab.mjs](../../renderer/terminal-tab.mjs) calls an injected terminal bridge and renders through xterm.js | Display and much lifecycle/UI logic are reusable; network failure semantics need adaptation |
| Native effects | [terminal-io.mjs](../../terminal-io.mjs), [local-tmux-io.mjs](../../local-tmux-io.mjs), [remote-target.mjs](../../remote-target.mjs) create PTYs and attach exact targets | PTY and tmux stay on the execution host for browser access |
| Ownership | [terminal-owner-leases.md](../terminal-owner-leases.md) binds leases to Electron main-frame/document identities | Preserve the ownership invariant; web authentication cannot reuse Electron principal checks unchanged |
| Backend | [server/oats-web.mjs](../../server/oats-web.mjs) is a zero-dependency loopback HTTP process | It is not a public multitenant API; keep this existing boundary private |
| File reads | `fileRoots()` in that server permits roots from all served local deployments and known worktrees | Workspace selection and path containment do not constitute user authorization |
| CLI authority | [desktop-cli-api.md](../../../../docs/desktop-cli-api.md), [cli-adapter.mjs](../../cli-adapter.mjs) use installed CLI JSON and capability probes | Reuse this authority and strict decoding; do not import/reimplement kernel logic |
| Spawn | [desktop-spawn-preview.md](../desktop-spawn-preview.md), [spawn-apply.mjs](../../server/spawn-apply.mjs) implement bounded, in-memory confirmed local spawn transactions | Persist hosted operation custody around the CLI; do not assume broker memory survives restart |
| Remote spawn | Same document and [spawn-preview.mjs](../../server/spawn-preview.mjs) distinguish local confirmed preview/apply from ordinary server-routed spawn | A Windows remote client needs its own parity gate; present remote support is not proof of identical transaction semantics |
| Observation | [desktop-load-path.md](../desktop-load-path.md) describes held snapshots, coalescing and adaptive cadence | Preserve coalescing; do not run a CLI observation cycle per browser tab |
| Packaging | [electron-builder.config.cjs](../../electron-builder.config.cjs), [build-installers.yml](../../../../.github/workflows/build-installers.yml) target macOS and Linux | Windows requires a real build, native dependency and release qualification effort |

The current backend has Host/Origin loopback guards, not customer login and
resource authorization. Existing route names, arbitrary local paths and terminal
target specs must not become a public interface merely by placing a login proxy
in front of the process.

The current terminal is a live byte stream, not an image of a window and not a
structured chat transcript. A viewer links to the durable tmux source window;
closing the viewer must not stop the agent. This is the behavior to preserve.

## Options and comparison

| Option | Client | Agent execution | What the user must supply | Main additional work |
| --- | --- | --- | --- | --- |
| A Hosted web | Browser | Service-managed Linux environment per tenant | Account and approved repository/model access | Account service, isolation, runner operations, web transport, ongoing hosting |
| B Windows remote client | Installed Electron app | Existing customer/operator Linux server | Windows installation, server access and credentials | Windows port, remote onboarding, CLI/SSH compatibility, signed distribution |
| C0 Existing Linux app in WSLg | Existing Linux Electron app displayed through WSLg | Linux inside WSL, or existing Linux servers through its current remote facilities | Compatible Windows/WSLg, installation permission and Linux prerequisites | Compatibility and policy assessment first; no new native bridge assumed |
| C Windows with WSL adapter | Native Windows Electron app with a new WSL adapter | Linux inside WSL on the user's Windows computer | Permission and resources to install/run WSL | WSL provisioning, process/path bridge, lifecycle and local integration qualification |
| D Fully native Windows | Installed Electron app | Windows processes without WSL | Windows installation and native toolchain | Kernel/session backend and capability portability, then Desktop support |

| Criterion | A Hosted web | B Windows remote | C Windows with WSL | D Native execution |
| --- | --- | --- | --- | --- |
| No client installation | Yes | No | No | No |
| No user-managed Linux environment | Yes | Only if someone else manages the server | Linux still present locally | Yes, after a larger port |
| Runs when laptop sleeps | Yes, subject to service availability | Yes, on remote host | No dependable promise | No dependable promise |
| Local code custody | No, code is hosted | No for server execution | Yes | Yes |
| Service must manage tenants | Yes | Only if we also supply hosting | No for individual local use | No for individual local use |
| Other client operating systems | Browser reach | Separate app builds | Windows only for this adapter | Windows only for this backend |
| Ongoing vendor compute cost | Material | Low if users supply servers | Low | Low |
| Principal uncertainty | Service security and economics | Windows CLI/SSH and remote feature parity | Reliable WSL lifecycle and onboarding | Size of kernel/provider portability work |

These are qualitative judgments, not benchmark scores. If option B connects to
our managed hosting, it inherits option A's tenant and operations work and adds
Windows distribution. It is then an additional client, not a cheaper substitute
for the service.

C0 shares C's local custody, installation requirements and laptop-lifetime limits,
but runs the existing Linux UI and CLI together. It is a separate, potentially
lower-cost compatibility route, not an established supported configuration or a
commitment to the adapter development budget. No OATS WSLg test has been run.

## Shared interface design

Introduce one explicit platform object at renderer startup. The Desktop adapter
wraps the existing preload API; the web adapter implements network operations.
Views continue to receive `ctx` rather than importing transport code. Move direct
`window.oatsDesktop` access behind that boundary gradually, retaining compatibility
while existing Desktop tests run. The interface names below are illustrative.

| Platform capability | Desktop behavior | Hosted behavior |
| --- | --- | --- |
| `api` | Guarded IPC proxy to local backend | Same-origin authenticated HTTPS to a closed gateway API |
| Terminal open/ready/write/resize/close/events | Existing document-owned IPC leases | Connection-owned authenticated terminal protocol |
| Workspace catalog and selection | Registered deployments and Desktop windows | Authorized tenant/workspace catalog and browser route |
| Attachments | Native path extraction/copy and remote upload | Bounded browser upload to the selected tenant; no local path authority |
| Focus/activity | Electron app/window events | Visibility/focus state, reduced across active subscribers server-side |
| Clipboard | Current native/browser integration | Browser permission and gesture rules with visible failure |
| Local workspace/CLI selection | Native pickers | Capability absent; administrator-provisioned runtime status instead |
| Forge credentials | Desktop-owned sign-in flow | Hosted credential onboarding, separately designed and authorized |

Preserve the visual shell, roster, spawn forms, terminal typography, split controls,
loading states, inspector components and semantic theme tokens. Preserve latest-
intent checks on success and rejection. Add capability-driven navigation so an
unsupported action is not shown as a dead button. Capability flags are presentation;
the server independently enforces every permission.

The public hosted DTOs use opaque resource IDs. A compatibility mapper may preserve
existing view shapes where harmless, but internal home paths and tmux socket names
must not become terminal authority. Views that currently construct path selectors
need explicit changes. API parity is not assumed to be byte-for-byte parity.

Web-specific changes include login/account chrome, workspace routes, reconnect
status, browser-reserved shortcuts, upload handling, asset bundling and an HTTPS/WSS
CSP. Do not serve `node_modules` as the production asset strategy. Bundle reviewed
browser dependencies into immutable, versioned assets. Avoid third-party scripts
on terminal pages and never interpret terminal bytes as HTML.

Namespace remembered layout and selection by account, tenant and workspace, and
clear sensitive state on logout/account switch. Do not cache terminal streams or
tenant API responses in a service worker. Two browser tabs may show one workspace;
Desktop's one-window-per-workspace policy does not automatically carry over.

Retain the current keyboard and accessibility foundations. Qualification must cover
Windows Ctrl shortcuts, browser conflicts, IME, focus restoration after dialogs,
screen-reader announcements, reduced motion, zoom and computed AA contrast. These
need the accessible-desktop-interactions workflow when implementation begins.

## Hosted system responsibilities

```mermaid
flowchart TD
    Browser[Shared renderer in browser]
    Gateway[HTTPS gateway and terminal gateway]
    Identity[Identity provider]
    DB[(Accounts memberships operations audit)]
    Scheduler[Provisioner and tenant routing]
    RunnerA[Tenant A Linux VM]
    RunnerB[Tenant B Linux VM]
    CLI[Installed OATS CLI and private management adapter]
    PTY[Terminal broker and PTY]
    Tmux[tmux and agent harnesses]
    Disk[(Tenant persistent volume)]
    Browser -->|HTTPS and WSS| Gateway
    Gateway --> Identity
    Gateway --> DB
    Gateway --> Scheduler
    Scheduler --> RunnerA
    Scheduler --> RunnerB
    RunnerA --> CLI
    RunnerA --> PTY
    PTY --> Tmux
    CLI --> Disk
    Tmux --> Disk
```

The control plane owns accounts, membership, quotas, provisioning and operation
custody. It never executes user repositories or launches agents in its own process
environment. The tenant runner owns a compatible installed CLI, workspace clones,
agent processes and local terminal resources. An adapter invokes the installed CLI
with fixed executable/argv and strict JSON decoding, preserving the existing
Desktop contract and capability gates.

For the MVP, use one tenant VM and one approved deployment per tenant. Multiple
workspaces in one environment are a later organizational convenience, not an
isolation boundary. A tenant starts as one person; multiple trusted members can be
added after membership and revocation tests pass. Horizontal scaling assigns whole
tenant environments to hosts. Do not move a running tmux session between machines.

Keep the current Desktop backend zero-dependency and loopback-only. Reuse pure
decoders and CLI adapters in a private runner component; a narrow local proxy to
selected existing routes is an implementation option after endpoint review. That
proxy must authenticate and authorize each closed call itself, derive its target
from trusted runner scope, and validate requests/results. Rewriting Host/Origin to
loopback is not authorization and must not launder an arbitrary browser request
into the backend's trusted local surface. Never
expose the entire existing route tree. Authentication, database and WebSocket
dependencies belong to a new private hosted package or repository, not the root
kernel package. Final package placement needs maintainer approval.

The runner channel is mutually authenticated and private, with credentials bound
to one tenant and an environment generation. No runner credential can provision
machines, read the control-plane database or name another tenant. Prefer an
outbound runner connection to reduce inbound exposure. A stale VM restored from
backup must not regain authority using an old runner credential.

## Trust and tenant isolation

Threats include malicious customers, compromised browser sessions, hostile
repositories and dependencies, prompt-induced agent actions, terminal escape
payloads, guessed resource IDs, abandoned sockets, and a tenant exhausting compute
or storage. A compromised tenant environment must not reach another tenant or the
hosting control plane.

Proposed compute boundary: a VM per tenant, running workloads without host
administration rights. Harden the host and guest, restrict access to cloud metadata,
platform management networks and other tenant networks, and enforce quotas outside
the agent's authority. No shared host filesystem mounts, Docker sockets, SSH agents
or broad cloud credentials. Containers inside a tenant VM can organize processes,
but are not the sole initial customer boundary. This recommendation is our design
judgment; Docker documents how capabilities, mounts and kernel vulnerabilities
affect container isolation. [Docker security](https://docs.docker.com/engine/security/)

Separate the runner supervisor's management identity from the Unix account running
agents. Agents may execute arbitrary code as the workload account, but cannot read
the supervisor key or change admission limits. The supervisor exposes a closed
operation vocabulary, not an arbitrary executable/cwd/environment RPC. Treat all
runner replies as untrusted structured input and bind them to the expected tenant,
environment generation and request. This separation needs an actual privilege and
filesystem audit; a different process under the same Unix account is insufficient.

All operators within one tenant are trusted with that tenant's execution data.
Terminal control or spawning code can expose credentials and files available to
the workload, even if the web UI hides a settings page. Therefore fine-grained
per-instance confidentiality is not promised inside one tenant. Separate mutually
untrusted users into separate environments. A reader role can view secrets printed
in output; granting it is a data-access grant.

Every database row, cache entry, operation, artifact and terminal session carries
server-verified tenant scope. Client tenant IDs select a requested context; they
do not prove membership. Use scoped database queries and composite foreign keys;
if row-level security is selected, use request roles that cannot bypass it and
transaction-scoped context. Isolation tests must exercise direct object references,
jobs, caches and backup restore, not just list filtering. [OWASP multitenant guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)

## Accounts and permissions

Use an established identity provider through OIDC rather than storing passwords in
the OATS service. The provider is not selected in this proposal. Maintain an
application membership record and revision separate from provider authentication.
Require MFA for tenant owners and platform administrators before production.
Use secure, HttpOnly session cookies, appropriate SameSite settings, CSRF protection
for state changes and explicit Origin validation for terminal handshakes.

Initial roles:

| Action | Reader | Operator | Owner |
| --- | --- | --- | --- |
| Roster, status, approved artifacts | Yes | Yes | Yes |
| Read-only terminal observation | Later phase only | Yes | Yes |
| Terminal input, spawn, start, stop | No | Yes | Yes |
| Retire instance after plan confirmation | No | Yes | Yes |
| Invite/remove members and change roles | No | No | Yes |
| Configure credential references and tenant limits | No | No | Yes, within platform limits |
| Delete/export tenant | No | No | Yes, with fresh authentication |

These role restrictions govern service/control-plane administration. An operator
who can spawn code or control a terminal effectively controls workload files and
workload credentials, including credentials configured by an owner. Owner-only
credential settings do not promise secret confidentiality from operators. The
supervisor management identity, platform secrets and tenant membership controls
must remain outside workload authority regardless of what the UI displays.

In the pilot, one owner per tenant is sufficient, but all requests still pass
membership enforcement. Later membership invites are expiring, single-use and
bound to the intended identity. Prevent removal of the final owner without an
explicit ownership transfer. Platform support has no default terminal or file
access; exceptional access is time-limited and audited under a separate policy.

Revocation increments membership/session authority, blocks new operations and
closes active terminal access. Proposed acceptance target: within five seconds
in a healthy system. The final runner dispatch/write boundary must enforce this
bound using a bounded authority lease, not just gateway socket closure. On a
gateway-runner partition, no fresh authority means no new CLI dispatch or terminal
write after lease expiry, including previously buffered input. This is a proposed
acceptance requirement, not a currently qualified guarantee. An already-started CLI effect may
finish and must be recorded; do not represent revocation as rollback.

OATS/aweb teams remain agent identity and messaging constructs. A website tenant
membership does not automatically create an aweb team membership, and vice versa.
Provisioning any messaging identity must use approved OATS/provider commands.
Hosted custody must be described accurately; server-accessible credentials and
terminal content are not end-to-end encrypted from the service operator.

## Persistent service data

Use a transactional database for service authority and job custody. The kernel
remains the source of truth for OATS lifecycle and workspace facts. Do not maintain
a second writable model of kernel state.

| Record | Required fields and rules |
| --- | --- |
| User | Opaque ID, identity-provider issuer and subject, account status; email is display/contact, not immutable identity |
| Tenant | ID, status, quotas, region, retention policy, owner relationship |
| Membership | Tenant/user pair, role, revision, active/revoked state; unique pair |
| Environment | Tenant ID, opaque ID, generation, runner identity, image version, health and volume references |
| Workspace registration | Tenant/environment IDs, public ID, runner-owned CLI scope reference; no browser-authoritative absolute path |
| Instance observation | Tenant/workspace IDs, opaque ID, exact kernel selector and available creation/session evidence, observed status/time; replaceable cache, not lifecycle authority |
| Operation | Tenant, actor, membership revision, kind, target evidence, immutable request digest, idempotency key, CLI decision/plan, admission/retry expiry, state and bounded receipt |
| Terminal lease | Tenant, actor, browser connection, source target evidence, service runner generation, control fencing number, runner-enforced expiry and cleanup status |
| Credential reference | Tenant, provider, secret-store reference, scope and rotation status; no plaintext secret in ordinary rows |
| Audit event | Actor, tenant, action, target ID, request/operation ID, time and result code; no terminal bytes or credentials |
| Artifact | Tenant, owner operation/instance, storage key, size/hash/type, retention state |

Kernel paths stay internal to runner mappings. Public IDs are not authorization
tokens. Jobs retain the authenticated actor for attribution but recheck current
permission before dispatch. Restored environments receive new generations and
invalidate terminal leases and pending plans from the prior service generation.

### Service generations and kernel identity evidence

Service environment generations, browser epochs and writer fencing numbers name
service-owned resources. They are not kernel instance/session generations. Neither
a random public ID nor a reused home/name gives a compare-and-act runtime identity.
`createdAt`, `startedAt`, `restartCount` and event `incarnation` provide observations
with specific meanings; copying one into a service record does not make every CLI
verb enforce it atomically.

| Action | Existing evidence and checks at the baseline | Limit requiring explicit treatment |
| --- | --- | --- |
| Spawn | Capability-gated `--expect-decision`, placement reservation and `--idempotency-key`; receipt decision, instance/home and launch result; key recorded in surviving home | Decision describes creation; it is not a universal later-session fencing token. No replay safety after home/key evidence is lost |
| Stop | Exact admitted instance/home, CLI `--plan-revision` and key; fresh-plan check; receipt binds key/revision, target rows and per-target stop results | Scope is the facts and endpoint checks the kernel includes in its plan. No assumed generic `expectedIncarnation` field |
| Retire | Exact home, fresh plan revision and idempotency key; first raw receipt and replay envelope; receipt persists beside instances and may outlive home | Retention/partial cleanup is not total deletion. Receipt lifetime and replay do not establish all desired hosted expiry semantics |
| Start/restart | Exact home, advertised verb, kernel lock/recovery and result `target`, `startedAt`, `restartCount`, `reused`, optional restart stop receipt | No general caller idempotency key or expected-session-generation precondition in this public contract; lost response is not permission to repeat |
| Terminal attach | Local validated socket/session/window and exact anchored viewer target; remote CLI `session inspect --home` followed by `session attach --home`, with saved route and kernel target checks | Inspect then attach alone is not proof of an atomic expected session generation; source replacement races need qualification against the actual attach contract |
| Observation/events | Roster `createdAt`/`startedAt`; events API has home `incarnation` and session boundary events | These are evidence for detecting changes, not proof that a subsequent effect was fenced by that value |

Sources: [CLI lifecycle and session contracts](../../../../docs/desktop-cli-api.md),
[instance admission](../../server/instance-admission.mjs),
[lifecycle boundary](../../server/instance-lifecycle.mjs),
[lifecycle receipt decoder](../../renderer/lifecycle-contract.mjs), and the terminal
adapters linked above. Before implementing any hosted stale-target guarantee,
record which actual kernel checks enforce it and test the replacement race. Where
the existing contract is insufficient, refuse the affected operation or request a
kernel-owned contract decision; do not simulate an atomic guarantee with an extra
roster read. No new kernel fields or ledger are requested by this document.

## Proposed public management contract

The following routes are a reviewable vocabulary, not approved endpoint names.
All target operations require active membership, ownership validation and a live
compatible runner. Resource absence outside the caller's scope is returned without
disclosing another tenant's existence.

| Route family | Purpose |
| --- | --- |
| `GET /v1/session` | Current user and authorized tenant summaries |
| `GET /v1/tenants/{t}/workspaces` | Authorized workspace choices |
| `GET .../workspaces/{w}/souls` and `/instances` | Held observations with age and failure state |
| `POST .../workspaces/{w}/spawn-previews` | Validate allowed choices and obtain kernel-bound preview |
| `POST .../workspaces/{w}/spawn-operations` | Confirm one preview and submit a durable operation |
| `GET .../operations/{o}` | Inspect exact outcome; never implicitly retry |
| `POST .../instances/{i}/lifecycle-plans` | Obtain stop/retire plan for the exact admitted target and available identity evidence |
| `POST .../instances/{i}/lifecycle-operations` | Confirm and apply the exact plan |
| `POST .../instances/{i}/terminal-leases` | Request a connection-owned terminal capability |
| `POST .../instances/{i}/attachments` | Later: bounded upload into an approved attachment location |

Do not forward public generic CLI execution, executable selection, arbitrary
server registration, raw paths or environment variables. In particular,
Desktop's CLI reprobe with a selected binary and its local file API are not public
hosted endpoints. Initial read-only artifact support uses an authorized listing
and opaque file IDs; downloads remain scoped and traversal/symlink guarded.

Return a versioned service envelope with a request ID, stable service error code
and an explicitly projected kernel receipt/error where appropriate. Proposed
service codes include `AUTH_REQUIRED`, `ACCESS_DENIED`, `RUNNER_UNAVAILABLE`,
`CLI_INCOMPATIBLE`, `PLAN_STALE`, `QUOTA_EXCEEDED`, `OPERATION_UNKNOWN` and
`TERMINAL_CONTROL_BUSY`. These do not rename or expand the kernel JSON contract.

## Spawn and lifecycle flows

Hosted operations run the CLI locally inside the selected tenant environment.
That deliberately uses the existing local preview/apply semantics even though
the user's browser is remote. No new kernel remote transaction is assumed.

Spawn sequence:

1. Authorize tenant, workspace and operator. Resolve an allowed soul from the
   runner's CLI catalog and validate the closed choices schema.
2. Run capability-gated preview. Bind its decision to actor, tenant, environment
   generation, workspace and choices. Store an expiring preview record. Opening
   instructions are not sent to a read-only preview when the CLI contract excludes them.
3. Show kernel-reported effective launch, placement and readiness, plus applicable
   service quota information. Refusals remain actionable without implying launch.
4. On confirmation, reauthorize and transactionally reserve quota and an operation
   record. The same client intent/digest reuses the same record; a changed digest
   under that key is a conflict. Persist the CLI idempotency key before dispatch.
   Service-issued intents have immutable admission/retry deadlines; arbitrary
   previously unseen client keys never turn an expired submission into a fresh one.
5. The runner records operation custody before invoking the fixed CLI argv. It
   rechecks the exact decision and target; CLI drift refusal requests a fresh
   preview, never silent substitution.
6. Persist a bounded receipt, observe the instance through the CLI, and return its
   public ID. Auto-open the terminal only if the user's latest selection still owns
   the result. Otherwise retain a discoverable completed operation.

Proposed service states: `prepared`, `queued`, `running`, `succeeded`, `refused`,
`partial`, `unknown`. Queue acceptance is not proof of spawn. Quota reservations
are released only after a confirmed no-effect result or reconciled outcome.
Operations that may still run retain their reservation.

Browser retry uses the same operation ID. Gateway crash does not mint a new CLI
key. Runner recovery uses only the current CLI's supported exact receipt and
idempotency semantics. The existing kernel key lifetime is tied to its surviving
home; do not promise forever-exactly-once creation or replay after retirement.
If recovery cannot establish what happened, mark unknown and require reconciliation
against the available exact target and kernel evidence. Never infer success from
a same-named instance or claim an enforced incarnation check that the verb lacks.

Operation retention is part of authority, not merely a log-cleanup preference.
Proposed policy: service-issued submission/retry authority expires no later than
30 days from original admission, and may expire sooner when target evidence or
the kernel's replay guarantee is lost. Expired, missing or compacted intents are
explicitly refused; they are never treated as fresh submissions. A new deliberate
user intent requires a new preview/confirmation. It cannot bypass an unresolved
operation hold on the affected target or quota.

Unresolved `running`, `partial` or `unknown` operations do not age into no-effect
or successful outcomes. Retain minimal identity, request digest, decision/key,
dispatch evidence, authority expiry and quota/reconciliation custody until an
explicit disposition is established. Payload text may be purged separately. After
a confirmed terminal outcome and retry expiry, detailed receipts may be compacted
only if the service can still reject old authority; the bounded token/epoch and
tombstone design must be specified before implementation. This is not an
unconditional duplicate-prevention or exactly-once guarantee.

For tenant deletion, revoke all admission, fence the runner, and reconcile or
explicitly terminate unknown effects before releasing infrastructure reservations.
If evidence must be erased before resolution, permanently refuse the old tenant
and operation namespace rather than recreate it as eligible. Backup rollback must
not roll back the authority epoch: revoke old runner credentials and intent epochs
using control-plane authority outside the restored snapshot, then quarantine
uncertain operations. If that independent authority/evidence cannot be recovered,
keep mutation admission closed. Missing files or records are never no-effect proof.

Stop and retire preserve the existing plan/confirm/apply contract and retention
warnings. Retire is not synonymous with deleting every worktree or retained file.
Start/restart use their actual advertised CLI contract; do not claim idempotency
for verbs that do not supply it. A disconnected caller can inspect its operation
later without causing a retry. Service quotas also cover descendants spawned by
agents: VM/process/disk limits must hold even when the UI gateway is bypassed.

## Terminal protocol and ownership

The terminal gateway bridges xterm.js to a PTY attached to an exact authorized tmux
source. Keep tmux target validation, `=` anchoring, linked-window viewers, source
death isolation and locked viewer keys. Port the lifecycle guarantees from
[terminal-owner-leases.md](../terminal-owner-leases.md); do not transplant Electron
sender-frame checks into a web principal model.

Proposed attachment flow:

1. A management request resolves an authorized public instance ID and the available
   kernel target evidence described above; insufficient enforced identity is a
   contract gap, not an assumed incarnation check.
   Reserve a bounded terminal slot and acquire the instance's writer lease.
2. Issue a short-lived, single-use opaque ticket bound to user session, tenant,
   instance evidence, browser tab nonce and service environment generation. Keep it in memory. Do
   not put it in URLs or logs. Connect to a fixed same-origin WSS endpoint, then
   authenticate with a bounded first message while the connection has no PTY or
   data privileges. Limit and promptly expire unauthenticated sockets.
3. Consume the ticket atomically, validate the cookie session and Origin, and open
   a private viewer. Send readiness only after client listeners are installed.
4. Exchange typed `input`, `resize`, `output`, `ack`, `status` and `close` messages.
   Validate frame type, length, sequence and current fencing number. Server output
   never becomes executable page content.
5. On disconnect, revoke input immediately and close the viewer/PTY. Reconnection
   acquires a fresh lease and viewer; it does not replay input or resurrect a handle.
   The durable source survives browser closure. Uncertain viewer cleanup remains
   accounted for and is reconciled by an exact owned-viewer sweep.

The runner, immediately before every PTY write/resize and CLI dispatch, validates
the current service environment generation, owner/fencing number and unexpired
authority lease. It checks again after asynchronous preparation and while draining
buffers. Revocation discards queued input; an old gateway cannot refresh a fenced
writer. Lease refresh must derive from current authenticated control-plane
membership, not gateway connectivity alone. Runner monotonic deadlines and a
bounded refresh validity policy must account for delay/reordering; a partition
expires authority within the specified bound. Gateway-side socket closure is
helpful cleanup but not the enforcing boundary. Already-written bytes cannot be
recalled, and an already-dispatched CLI process can have effects after revocation.

TLS, explicit Origin checks, session expiration/revocation and authorization beyond
the initial connection are required; WebSockets do not supply them automatically.
[OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

First release: one writer per instance. A second tab sees who holds control and a
clear refusal. Automatic takeover is disallowed while an old writer remains valid.
A later explicit takeover must revoke and fence the old writer before enabling the
new one. Shared read-only viewers are deferred because independent tmux clients can
also influence sizing and resource use. A reader stream must not resize or write.

Keep network input semantics precise: the proposed `input-ack` means that the
runner validated current authority and its PTY write call accepted those bytes.
It does not mean the terminal application read them, a draft was submitted, a
message was inserted, or the model processed it. Output acknowledgements separately
mean xterm's write callback completed. Neither is a model-acceptance receipt.
Do not retry keystrokes after
an uncertain disconnect. On reconnect, obtain a fresh terminal repaint; full
scrollback/transcript restoration is not promised. Browser sleep and background
timer throttling must not cause reconnect storms.

### Harness acceptance remains outside the terminal transport contract

The maintainer supplied bounded internal evidence about current aweb terminal and
Pi delivery behavior. It is attributed evidence, not an independently repeated
audit here or a new OATS API. Internal labels ABMA and ABNV refer to unresolved
input/retry design discussions, not released capabilities. Their essential limit:
after an input invocation may have run, a timeout, malformed receipt or negative
submission report does not prove that no paste or Enter effect occurred. Proven
pre-invocation failure is a different case. Terminal success, `submitted: true`,
verification flags and screen movement do not prove exact message consumption.

The reported producer audit did not establish an enforced pending-input ID,
live-session generation or atomic same-draft Enter-only completion operation.
External inspect followed by paste/Enter cannot safely complete an uncertain draft
by assumption. Reported ABNV offline retry/recovery characterization included repeat
pastes; smaller per-item suppression is only a proposal, not shipped protection or
completion of a previously pasted draft. Hosting/WSS supplies no additional proof.

The reported Pi wrapper returns void and catches asynchronous errors internally;
callback completion does not prove insertion or durable queue admission. The
maintainer reported three semantic failures in offline doubled tests, with three
controls passing, not full live AgentSession/crash-durability qualification. A
future exact request/message and intended-session insertion receipt, a documented
persistence boundary, proven pre-insertion refusal and unknown-resolution behavior
need separate upstream specification/approval. Unknown never authorizes blind
replay, and a later execution error does not undo an insertion.

Evidence provenance supplied by oats-expert-juan, not independently reproduced:
OATS `c746ad7ef9b90d6cb0f53b2ed666d7156ac86693` (`lib/session-input.mjs` and
`lib/core.mjs`); aweb `78c1070855fdc80f8dabf20aeca4afcf2ed923e3`
(`channel-core/src/terminal.ts` and channel acceptance/retry paths); Pi extension
0.3.12 at aweb `5f5c1a07cdfd0e65a41017f5595403040ee73652`
(`pi-extension/src/wake.ts`, `channel-core/src/channel.ts`), and Pi 1.0.1 upstream
`a7229ddc21810d6245105978033b7df645ecc2f7`
(`packages/coding-agent/src/core/agent-session.ts`). These pins identify the reported
evidence scope; they do not establish that every installed version behaves alike.
No retained internal test archives or coordination messages are normative contracts
for this service. No new audit, install or outreach follows from this caveat.

Backpressure is required in both directions. Use bounded gateway/runner queues,
output sequence acknowledgements tied to xterm write completion, and explicit
overflow failure. Pausing a PTY must be bounded so a slow browser cannot indefinitely
stall a workload; detach an over-budget viewer while preserving the source. Choose
thresholds through measurement. xterm's flow-control guidance explains the buffering
problem and write-completion mechanism. [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/)

Starting limits for evaluation, not promised defaults: retain Desktop's 1 MiB
caller-write ceiling, split UTF-8 safely, validate geometry within 1–1000 cells,
and cap terminals per user and tenant as well as globally. Keep small readiness
buffers and deadlines. Browser clipboard access requires an explicit policy for
OSC 52, user activation and refusal; terminal output cannot read the clipboard.

## Credentials repositories and provisioning

Provision from a pinned Linux image containing approved Node/OATS/harness versions,
tmux and Git. Image build provenance and capability probes determine supported
features. A missing or incompatible CLI disables mutations and reports the issue;
it never triggers an optimistic command attempt or alternate implementation.

Pilot onboarding is administrator-assisted: create tenant, allocate VM/volume,
establish restricted runner identity, register approved workspace sources, configure
model/repository credentials, perform readiness checks, and admit the owner. Each
step has durable state and can be retried without duplicate resources. A failed
provision remains unavailable with a concrete remediation; it is not a partially
usable tenant. Provisioning uses CLI/provider commands, never hand-edits kernel
deployment or identity files.

Select a credential model before launch: customer-supplied provider credentials or
platform-funded model access. Validate the supported authentication method for each
harness and the provider's current hosted-use terms in a separate provider review.
This proposal makes no claim that a consumer subscription or browser login may be
shared, automated or resold. Credentials remain on the server; the browser receives
status and references, never a reusable secret after onboarding.

Encrypt secrets at rest, scope repository tokens narrowly, audit rotation and
revoke on tenant offboarding. Inject only tenant workload credentials into agent
processes. Platform database, billing and infrastructure keys never enter the
tenant. Workload credentials are exposed to tenant code by design; encryption at
rest does not hide them from that code or the service operator.

Separate service-account login from Git/model login in the UX. Never ask users to
paste infrastructure credentials into a terminal as the standard onboarding flow.
MVP uses approved workspace templates; arbitrary source registration and messaging
team setup require their own authorization and product design.

## Operations resilience and retention

Run agent sessions independently of gateway lifetime and browser presence. Upgrade
the gateway by draining connections and allowing reattachment. Upgrade runner/CLI
images only through a compatibility gate; do not silently replace the CLI during
an in-flight mutation. Do not use machine suspension as an idle optimization while
an agent or schedule is expected to run.

| Failure | Required behavior |
| --- | --- |
| Browser tab closes or network fails | Revoke/detach its viewer; instance continues; no automatic input replay |
| Gateway restarts | Durable operations remain queryable; terminals reconnect with new authority |
| Runner channel fails | Show last observation as stale; block new effects; reconcile pending operations |
| VM reboots or is lost | Report sessions interrupted; tmux does not survive reboot; restore files and use supported session recovery explicitly |
| Membership revoked | Block admission, fence active sockets, record any already-started effect |
| CLI missing or incompatible | Observation where available, no lifecycle mutations |
| Disk full or process limit reached | Stable failure, quota remains conservative until reconciliation |
| Slow terminal consumer | Bounded buffering and detach; no unbounded memory growth |
| Backup restored | New environment generation, rotated runner authority, no revived old terminal lease |

Use persistent tenant volumes and encrypted backups. Backups preserve files and
records, not live process memory. Define a pilot restore target with the operator
before acceptance; proposed targets are at most 24 hours of file loss and restore
within one working day, explicitly not a production SLA. Test restore into an
isolated environment without duplicate messaging identities sending concurrently.

Initial proposed retention policy for review: no central terminal-content logs;
service audit metadata 90 days; completed operation detail ordinarily 30 days,
subject to the stricter intent-expiry, unresolved-custody and compaction policy in
the spawn/lifecycle section; encrypted
backups 30 days; deleted tenant data purged from active storage after a seven-day
owner recovery window and from backups as they expire. Customer-specific retention,
regional restrictions and legal obligations must be resolved before onboarding.
Local agent transcripts may still exist on tenant storage and must be included in
the disclosed retention/export policy.

Offboarding disables login/runner admission, revokes sockets and credentials,
stops jobs under an explicit policy, applies the unresolved-operation disposition
above, offers an authorized export, and tracks active
volume and backup deletion separately. Export never includes platform identities.
Suspension for nonpayment is a later policy; it must not silently destroy work.

Monitor runner health, observation age, queue age, operation failure/unknown rates,
terminal slots/buffer pressure, CPU/memory/disk, cross-tenant authorization failures
and cost by tenant. Logs contain identifiers and error codes, not prompts, terminal
bytes, tokens or arbitrary CLI stderr. Redaction is secondary to not collecting
secrets. Support tooling must respect the same tenant boundaries.

## MVP scope and user journeys

The first hosted pilot has desktop-sized browsers, invite-only accounts, one owner
and one workspace/environment per tenant, a limited approved soul catalog and
administrator-assisted credentials. It includes login, workspace selection,
instance list/tree, spawn preview/confirmation, interactive terminals, reconnect,
status/attention, start/stop/retire and operation outcome recovery.

Opening journey: login → authorized workspace → current roster or explicit
provisioning/error state. Spawn journey: choose soul → instruction/allowed choices
→ preview/readiness → confirm → visible operation → resulting instance. Resume
journey: return to a running instance → attach to the exact source → continue.
Removal journey: inspect CLI plan and retained work → confirm → exact receipt.

No native binary/folder pickers appear in hosted flows. Read-only Markdown/artifact
viewing can follow once scoped file authority is implemented. Attachments,
organization membership UI, read-only shared terminals, automations, forge review,
arbitrary remote machine registration and mobile layouts follow separate gates.

A service that can only list instances or show captured output is a feasibility
demo, not this MVP. Conversely, native integration parity is not required to prove
the specified user journeys.

## Windows architecture choices

### Existing Linux Desktop entirely inside WSLg

Option C0 uses the existing Linux Desktop build, installed CLI, tmux and harnesses
inside a WSL2 distribution, with WSLg displaying the Linux GUI on Windows. It adds
no native Windows-to-Linux management adapter initially. Current upstream WSLg
supports X11/Wayland GUI applications on eligible Windows versions; Microsoft
states this does not provide a complete Linux desktop environment.
[Microsoft WSL GUI application guidance](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)

This is an unqualified compatibility/policy assessment route. The existing OATS
Linux package has not been tested here under WSLg. Before offering it, an approved
assessment would need to check Electron sandbox/native dependencies, graphics and
xterm fallback, clipboard/IME, file dialogs, launcher behavior, Linux prerequisites,
credentials, local/remote lifecycle and exact viewer cleanup. No such assessment is
started by this document. Do not disable sandboxing just to make a demo launch.

Users still need permission to install/run WSL, a supported device/graphics setup,
Linux package maintenance and enough local resources. UI, paths and credential
stores remain Linux-side; Windows integrations may be limited. Local agents stop
with WSL shutdown/host loss, whereas agents on a separate Linux server can continue.
If C0 meets the audience's needs, a native Windows UI and new WSL bridge may not be
worth funding. If it fails, document the actual limitation before selecting C.

### Remote-only Windows client

Retain Electron, shared renderer and isolated preload. Run agents/tmux on an existing
Linux server. Two transport implementations must be evaluated rather than mixed
implicitly: use a Windows-compatible installed OATS CLI routing through SSH, or use
a separately approved private Linux management adapter reachable through a secure
tunnel. The latter avoids porting the local CLI but introduces a new management
transport and deployment requirement; it is not already available as a product.

Existing `remote-target.mjs` still invokes a local OATS executable for inspect and
attach. Consequently existing remote support does not prove Windows works without
a compatible local invocation strategy. The spike must exercise probe, roster,
spawn, start/stop/retire, PTY attach, upload and cleanup, not merely `ssh` in a window.

Windows-specific work includes CLI discovery and `.cmd` launch behavior without
unsafe shell interpolation, PATH/PATHEXT, POSIX remote path handling on a Windows
host, SSH identity/known-hosts UI, terminal child cleanup, native module ABI builds,
icons/installers, update/uninstall behavior, security software compatibility and
signing. Existing macOS/Linux guards and release outputs remain unchanged.

Concrete audit targets in this snapshot:

- `cli-locator.mjs` searches PATH for extensionless `oats`; the backend's fallback
  assumes an npm `bin` directory and `/bin/sh`. `login-path.mjs` already skips its
  login-shell probe on Windows, but that does not make backend discovery portable.
- The current CLI descriptor is a single binary path, also spawned directly by the
  remote terminal adapter. A safe Windows launcher may need an executable plus a
  validated argument prefix, such as installed Node plus the installed CLI entry
  point. Such a change spans consumers and requires coordinated review.
- The workspace registry admits `/`-absolute local paths; remote-machine setup
  currently derives scope from a primary local deployment. A Windows remote-only
  first-run flow therefore needs a designed trusted workspace bootstrap, not merely
  a new connection button. See [desktop-machines.md](../desktop-machines.md).
- [lib/servers.mjs](../../../../lib/servers.mjs) uses host-native path resolution
  in remote-home comparisons. Audit these on Windows against POSIX address
  semantics; this is an identified portability risk, not a reproduced Windows bug.
- [dist-smoke.mjs](../../scripts/dist-smoke.mjs) assumes non-macOS artifacts are
  Linux packages, and [smoke-probes.mjs](../../scripts/smoke-probes.mjs) launches
  `/bin/sh`. Windows qualification needs platform-specific probes.

Use distinct internal types for Windows local paths, WSL paths plus distribution
identity, and Linux remote paths plus server identity. Do not make one permissive
path validator cover all three.

Electron and node-pty offer Windows primitives, including ConPTY, but their current
upstream support does not qualify OATS's pinned Electron/node-pty combination.
[Electron documentation](https://www.electronjs.org/docs/latest/),
[node-pty documentation](https://github.com/microsoft/node-pty).
Node documents that `.cmd` files cannot be executed as native programs through
`execFile`; use a reviewed invocation strategy instead of general `shell: true`.
[Node child processes](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)

Windows OpenSSH availability is a supported platform facility, but installation,
host enrollment and organization policy still need checking. Existing OATS SSH uses
batch mode, so interactive password or first-host-key prompts are not an onboarding
solution. Public app distribution also needs signing/trust decisions; signing does
not justify promising that every OS warning disappears.
[Microsoft OpenSSH overview](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview),
[Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Remote servers must authenticate the user and grant appropriate Unix/OATS access.
If all users share one Unix account, they share its effective filesystem and agent
authority; installing separate Windows clients does not establish tenancy.

### Windows app with WSL execution

Run OATS, Git, tmux and harnesses inside one selected WSL Linux distribution. The
Windows app discovers and binds to that distribution explicitly. Keep CLI scope,
paths, process environment and tmux identity in the Linux domain, with a structured
bridge to the Windows UI. Do not translate paths by string replacement or allow a
distribution change to retarget an in-flight operation.

Prefer workspace storage on the Linux filesystem for Linux tooling. Native files
are copied/uploaded deliberately. Credential stores and SSH agents live in the
selected Linux environment unless a reviewed integration says otherwise. Explain
where code and credentials reside, how much disk/memory is required and how to
export before uninstalling the distribution.

The installer must detect unsupported/disabled WSL and organization policy without
assuming it can enable Windows features or reboot. Test shutdown, reboot, sleep,
distribution removal, concurrent distro names, and same-named instances in different
distributions. WSL shutdown ends processes; reconnection is not proof of resumed
agent work. This option serves users allowed to run local Linux under Windows,
not users prohibited from doing so.

Microsoft's standard WSL installation procedure uses an administrator terminal and
a restart; forwarded WSL paths use Linux syntax, and its guidance recommends Linux
filesystem storage for Linux tooling. These are onboarding constraints, not proof
that WSL is unavailable on every managed device.
[Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install),
[WSL filesystem interoperability](https://learn.microsoft.com/en-us/windows/wsl/filesystems).

### Fully native Windows execution

ConPTY can host interactive Windows processes, but a PTY is not a durable session
manager. Current OATS uses tmux sessions and POSIX-oriented hooks/process behavior.
A native Windows implementation requires a kernel-owned durable session backend
with identity, inspect, attach, resize, input, source/viewer lifetime, stop and
restart contracts, plus capability/provider and filesystem portability.

That exceeds the Desktop surface and must be designed by the kernel maintainer and
developers. Merely removing a tmux check, running a harness in node-pty, or adding
a Windows installer would not deliver equivalent lifecycle behavior. This option
should be reconsidered only if local execution without WSL is a validated product
requirement that justifies that platform program.

The evidence goes beyond tmux: [core.mjs](../../../../lib/core.mjs) launches through
`/bin/sh`, materializes symlinks and accepts the tmux session backend;
[process-group.mjs](../../../../lib/process-group.mjs) uses POSIX process-group
signaling; [session-viewer.mjs](../../../../lib/session-viewer.mjs) implements tmux
viewer lifetime. Upstream tmux's current supported-platform list does not include
Windows. That does not rule out ports or compatibility layers, but they are not
evidence that the existing OATS lifecycle contract works natively.
[tmux supported platforms](https://github.com/tmux/tmux/blob/master/README)

## Delivery plan and decision gates

No spike or implementation is funded by this proposal or its draft review. The
maintainer's current mandate is assessment-only. Gate 0 requires a separate human
decision before any runtime test, installation, provisioning or implementation.
Choose the smallest relevant route; the following branches are alternatives, not
one cumulative program.

| Gate | Work | Evidence required | Stop condition |
| --- | --- | --- | --- |
| 0 Audience and authority | Confirm existing Linux execution vs managed browser-only execution vs local custody, install/WSL policy and budget owner | Human selects a route and separately authorizes bounded work | Audience/custody policy unconfirmed; no assumed all-route funding |
| B Windows remote | On clean Windows prove safe installed-CLI invocation, trusted first-run workspace/bootstrap, remote identity and target journey | Standard-user packaged client works without an accidental WSL/Git Bash dependency | Requires unscoped kernel bootstrap/contract changes; re-estimate before proceeding |
| C0 WSLg assessment | Assess policy and, only if separately authorized, existing Linux app/CLI in WSLg | Document actual install, graphics, terminal, lifecycle and integration results | WSL disallowed or unacceptable behavior; do not assume a new bridge fixes policy |
| C WSL adapter | Only if C0 fails a required integration need and WSL is allowed, prove explicit distro/user/path/process adapter | Correct lifetime and identity across the Windows/WSL boundary | Unsafe process/identity mapping or support burden; no automatic progression from C0 |
| D Native platform design | Only if native local execution without WSL is essential, commission separate kernel/provider feasibility | Maintainer-owned session and portability scope | No approved kernel program; no Desktop-only estimate |
| A0 Hosted prerequisites | Name operator/security owner, budget and supported credential route | Human authorization before real customer credentials or paid provisioning; use inert fixtures until then | Operator, budget or credential feasibility absent |
| A1 Browser renderer | After A0 authorization, prove real shell through web adapter and retain Desktop behavior | Same essential UI; no Electron global leakage or identity regression | Uncontrolled UI fork or missing kernel authority |
| A2 Hosted isolation | After explicit authorization, two isolated tenants, durable operations and runner-enforced WSS leases | Cross-tenant denial, partition fencing, expiry/rollback and resource-limit evidence | Uncontrolled access or unresolvable duplicate/identity semantics |
| Route review | Review only the selected route's evidence and updated estimates | Human decides stop, further evidence or selected pilot | Benefit does not justify cost/support burden |
| Selected pilot | Separately authorized small cohort on the selected route | Applicable acceptance criteria and named support owner | No reliable recovery, secret handling or operating capacity |
| General release | Further explicit release decision after pilot | Security/QA/operations acceptance and distribution qualification | Pilot reliability/economics below agreed targets |

Browser extraction is required for A, not for B, C0 or C. Windows Electron can
reuse the existing renderer without a browser adapter. Avoid prematurely extracting
every Desktop module into a public library. On the hosted route, first prove one
complete feature and terminal lifecycle through both adapters. Preserve versioned interfaces and contract
fixtures. Roll out behind an explicit platform entry point, leaving the current
Desktop launcher default intact. Rollback disables hosted admission and retains
tenant work; it must not delete workspaces.

## Verification and acceptance

Implementation gates must use real effects where mocks cannot establish behavior.
Desktop-only changes run `cd packages/desktop && node --test`; repository changes
also run `npm run validate` and `npm run check`. Packaging changes require installer
and appropriate tarball gates. Terminal/identity changes need native verification
with exact tmux state before and after; use electron-live-verification for Desktop.

Hosted acceptance:

1. Two unrelated tenants complete spawn/attach/manage without seeing each other's
   list, file, output, job, preview, ticket, cache or export data, including guessed IDs.
2. A revoked user cannot reuse a ticket or dispatch a queued mutation. Test delayed
   buffers and gateway-runner partition at the final runner write boundary, proving
   the lease expiry/fencing bound, not merely gateway socket closure.
3. Within the documented authority/replay window, browser reload, gateway crash and
   lost acknowledgements recover the same operation without blind creation retry.
   Expired/missing intents refuse. Unknown effects retain custody across ordinary
   retention, deletion and backup rollback; absence is not no-effect proof. Browser
   detach preserves the exact durable source.
4. Same-named instances, retired/recreated homes, workspace switches and environment
   replacement cannot retarget a stale operation or lease. Map each guarantee to
   an enforced kernel or runner check; if absent, fail closed and record the open
   contract before claiming acceptance. No model-consumption guarantee is inferred.
5. Huge output, slow clients, malformed frames, invalid UTF-8/control messages,
   excess terminals, process floods and full disk stay within quotas and bounded
   queues. Unicode terminal input and valid control bytes remain correct.
6. Clipboard, IME, paste, resize, wheel scrollback, terminal application mouse mode,
   keyboard navigation and focus behavior work in the supported browser matrix.
7. Restore proves file recovery and identity isolation; UI explicitly distinguishes
   restored files from restarted processes and resumed harness conversations.
8. The service never serializes stored provider or platform secrets into management
   responses, URLs, logs, audit metadata or another tenant's environment. Workload
   operators can deliberately print workload secrets into their own terminal;
   this is part of their authority, not a confidentiality guarantee of the UI.

Proposed first browser matrix: current Chrome and Edge on Windows, plus Firefox
and Safari desktop qualification before claiming general browser support. Publish
the actual tested versions at release. ARM Windows and mobile are not implicitly
covered by x64 tests.

Proposed measurement targets, to be validated rather than advertised: local UI
selection feedback under 100 ms; terminal input-to-display overhead attributable
to our bridge under 50 ms at p95 on a nearby runner, excluding network and harness
compute; stable memory during a 30-minute sustained-output test; revocation within
the five-second authority bound. Record RTT and raw latency distributions. Kernel
catalog/preview operations can be slow; show age/progress instead of inventing a
subsecond promise. Begin with 10 tenants and 20 simultaneous terminal connections
as a load-test scenario, not a production capacity claim.

Windows acceptance additionally requires clean install without developer PATH,
paths containing spaces/non-ASCII, correct remote POSIX paths, SSH host-key failure,
credential recovery, kill/relaunch, sleep/resume, native module loading, uninstall
without workspace loss, and exact source/viewer cleanup. Test the signed release
artifact, not just development Electron. A Windows VM/physical test environment is
required; none was used in this assessment.

## Effort and operating economics

These are low-confidence planning allowances, not delivery quotes. One engineer-
week means a full-time experienced engineer with necessary reviewers and test
machines available. Allowances include developer investigation, implementation,
tests, documentation and ordinary review remediation. They exclude independent
reviewer/product time, dedicated QA/security assessment, operations staffing,
provider/credential approval work, signing fees and infrastructure cost. Those are
additional budget lines, not assumed free or already staffed. Person-time does not
translate directly to calendar time. Re-estimate after the selected route's gate.

| Work | Initial allowance | Major uncertainty |
| --- | --- | --- |
| Browser renderer feasibility A1 | 1–2 engineer-weeks, A only | Shell globals, identity DTOs, terminal lifecycle coupling; optional for Windows |
| Windows remote feasibility B | 1–2 engineer-weeks, B only | Safe CLI execution, first-run local workspace/bootstrap and remote spawn parity |
| Existing Linux app WSLg assessment C0 | 0.5–1 engineer-week if authorized | Compatibility/policy qualification only; no new native adapter or promise of support |
| Native Windows WSL adapter feasibility C | 1–2 engineer-weeks after route selection | Provisioning policy, process and path bridge; independent of browser extraction |
| Hosted two-tenant feasibility | 2–4 engineer-weeks | Runner authority, operation recovery and WSS fencing |
| Windows remote pilot after a successful spike | 4–8 additional engineer-weeks | Onboarding, signing and installed-app qualification; excludes new kernel contracts |
| WSL local pilot after a successful spike | 6–12 additional engineer-weeks | Local setup/support and recovery |
| Hosted invite-only pilot after successful spikes | 10–18 additional engineer-weeks | Auth, isolation, credentials, durable jobs, provisioning, recovery and operations |
| Fully native Windows execution | Not responsibly estimated yet | Requires a separate kernel/provider portability design and spike |

Engineering allowance totals per selected route, before excluded staffing/costs:

| Route | Dependency and arithmetic | What the total does not buy |
| --- | --- | --- |
| A Hosted invite-only pilot | A0 prerequisite decisions, then A1 1–2 + A2 2–4 + pilot 10–18 = **13–24 engineer-weeks** | Public launch, independent security/QA and sustained operations; new kernel contracts invalidate this allowance |
| B Windows remote pilot | B feasibility 1–2 + pilot 4–8 = **5–10 engineer-weeks** | Browser extraction, hosting and new kernel bootstrap/session contracts; such dependencies require a new estimate |
| C0 Linux app through WSLg | **0.5–1 engineer-week assessment only** | A supported release or a remediation budget; failures must be assessed before estimating changes |
| C Native Windows WSL adapter pilot | C feasibility 1–2 + pilot 6–12 = **7–14 engineer-weeks**, or **7.5–15** if C0 assessment precedes it | Browser extraction, fully native execution and excluded independent review/security/QA/support labor |
| D Fully native Windows | **Unscoped** | No 8–12-week or other delivery commitment is supported |

The maintainer described an earlier 3–5-week Windows estimate as a narrow rough
allowance. B's 5–10 engineer-week range includes broader onboarding, signing and
remote-parity qualification. Neither is a measured estimate or a contradiction
resolved by choosing a midpoint; scope and the Windows bootstrap findings determine
the next estimate. Shared work is counted only where the route requires it. Do not
sum every feasibility row into a mandatory program.

A public hosted release needs additional security and operational hardening after
the pilot; no estimate is defensible before pilot findings. The service requires
ongoing maintenance and incident response, not only feature development. Windows
requires ongoing installer/signing, dependency, OS and support maintenance.

Use this monthly cost model when obtaining current provider quotes:

```text
hosted total = control plane + database + monitoring
             + sum(tenant compute hours × compute rate)
             + persistent GiB × storage rate
             + backup GiB × backup rate + network egress
             + model usage + identity/secret service fees
             + support and operational labor
```

Illustrative utilization only: 20 continuously allocated tenant environments at
730 hours/month consume 14,600 environment-hours; 100 consume 73,000. At 20 GiB
per tenant they allocate 400 GiB and 2,000 GiB respectively before backups. These
are arithmetic scenarios, not measured OATS requirements or cloud prices. Size
CPU/RAM from representative workloads, including child agents and builds.

Idle compute dominates a VM-per-tenant baseline. Stopping a VM can reduce compute
cost but also stops agents and schedules, so it requires an explicit product
policy. A browser being closed is not permission to suspend work. Pooling tenants
to reduce costs is a security-design change, not an invisible optimization.

Customer-supplied model keys reduce our model billing exposure but not hosting,
credential, abuse or support obligations. Platform-funded access needs enforceable
provider-side budgets where available; UI counters cannot cap arbitrary tenant
code using credentials. VM quotas bound resources even when agents spawn children
without going through the web gateway.

Compare cost per active user and per completed task, not just per registered user.
Windows B externalizes compute cost only when the customer supplies the server.
Windows C0/C/D externalize it to the customer's hardware and IT support. Neither is
free from the customer's perspective.

## Risks unresolved decisions and owners

| Question or risk | Proposed position | Decision owner / evidence needed |
| --- | --- | --- |
| Is managed execution required or only Windows access? | Treat as the first product gate | Human and oats-expert-juan; actual target users |
| May users install WSL or any software? | Do not assume permissions | Human/product; representative organization policy |
| What is the tenant trust unit? | One mutually trusted person/team per VM | Maintainer; security review |
| Do users need local-only code custody? | If yes, hosted A does not meet that requirement | Human/product |
| Who supplies model access and repository credentials? | Choose one supported pilot model | Maintainer/provider review |
| How are agent messaging teams provisioned? | Approved operator-assisted setup | Messaging integration owner and maintainer |
| Who runs the service and handles incidents? | Named owner before hosted pilot | Human/operations |
| Which region and retention policy? | Explicit pilot terms before onboarding | Human/operations and applicable review |
| How much remote spawn parity is required for B? | Same observable safety outcome, no hidden local fallback | Kernel maintainer and Desktop expert |
| What counts as a Windows native app? | Electron Windows binary; WSL/backend choice stated separately | Human/product |
| Can operator role be restricted within a shared tenant? | No strong confidentiality claim against arbitrary code execution | Maintainer; separate sandboxes if needed |
| Is public self-service signup necessary? | Defer to avoid premature abuse/billing scope | Human/product |
| What budget makes hosted viable? | Quote and measure after isolation spike | Human/operations |

## Requested review

Ask `oats-expert-juan` to review the option framing including C0 WSLg, factual code evidence,
shared-renderer approach, hosted authority boundaries, Windows scope, effort ranges
and branching decision gates. Its assessment verdict can recommend an option or
specific future evidence, request amendments, or recommend declining the project.
The human must separately authorize funding/work; this review does not commission
spikes or give implementation GO.

Specific review questions:

1. Does managed browser access reflect the intended audience, or should a Windows
   remote client be the primary candidate?
2. Is VM-per-tenant and mutually trusted membership an acceptable initial product
   and cost boundary?
3. Is the proposed runner/CLI separation acceptable without weakening Desktop's
   loopback boundary or moving kernel behavior into the service?
4. Which credential model, service operator and monthly budget should be assumed?
5. Which route's evidence should be proposed to the human, and what would change
   the decision? No role is spawned or commissioned by answering this question.

After the human selects the audience and authorizes work, proposed ownership is
Desktop expert for shared UI/Windows client, kernel expert for CLI/session
contracts, integrations expert for harness/repository/model credential feasibility,
and a named operations/security owner before hosted work. These are assignments
for a future decision, not requests to start work.

This proposal is intentionally not entered into the repository's decided design
record index. No endpoints, kernel contracts, signing policy, release or hosting
deployment are approved by writing it. Accepted decisions should later be promoted
into their owning implementation/reference documents.
