# CLI → Desktop file opening — proposed contract

**Status: CLI delivery proposal only; the external command is not implemented or
approved.** Command spelling, wire schema, capability advertisement and transport
require coordinator/cli-dev agreement. The renderer file chooser/viewer described
below is implemented separately, without a new CLI command, endpoint, IPC channel
or dependency.

OATS remains **soul/agent/capability-centered**. Markdown and code are supporting
read-only artifacts in ordinary workspace tabs, alongside existing views. This is
**a file viewer, not an editor**: no save, rename, format, execute or workspace
creation. ORCA is a UI-quality reference only; its worktree-first information
architecture and central file explorer are **not adopted**.

## Existing surfaces (not the proposed delivery channel)

- [`server/oats-web.mjs`](../server/oats-web.mjs), `fileRoots`,
  `resolveGuardedFile`, `fileData`: `GET /api/file?path=<absolute>` reads files; it
  does **not** request a Desktop tab. Roots cover admitted agents/local-soul roots
  and known local instances' homes, `<home>/work` and repos across watched
  workspaces. Remote roster paths grant no local access. Roots are canonicalized
  at admission; only the requested path is re-resolved at use and compared by
  exact-root/root-plus-separator containment. The local-soul sibling admission
  checks `lstat` and its canonical parent. The route rejects non-absolute paths,
  missing/outside files, non-regular files, sizes over 2 MiB and NUL-bearing data.
  It is **not workspace-pinned**; adding `ws` does not narrow that allowlist.
- [`renderer/views/markdown.mjs`](../renderer/views/markdown.mjs) renders guarded
  Markdown or highlighted text, with per-mount cleanup. Markdown passes through
  DOMPurify and post-sanitize anchor normalization; relative links re-enter
  `ctx.openFile`. [`renderer/shell.mjs`](../renderer/shell.mjs) owns ordinary
  workspace-scoped file tabs. This is not an external command receiver.
- The **renderer browser-file chooser** (`renderer/open-file.mjs`) is separate:
  explicit user selection
  supplies a browser `File` and bytes to a renderer-local, read-only tab. Its name
  (including any browser fake path) is not an authenticated absolute filesystem
  identity. It must not grant server roots, forward paths to privileged readers,
  or resolve local sibling links without separately authorized selection. Keep
  chooser-local tab identity distinct from server-backed paths; cancellation is
  inert. It is not `cli:pick`, `workspace:pick`, or terminal file attachment.
- [`main.mjs`](../main.mjs) restricts privileged IPC by `senderFrame` URL to the
  app renderer (plus fragment); [`api-url.mjs`](../api-url.mjs) checks resolved
  proxy origin and pins workspace-addressed route families to advertised IDs.
  Server Host guards cover every request; POST additionally checks supplied
  Origin. These guards are **not authentication of an external CLI request**.
  Navigation/new-window locks must remain. [`single-instance.mjs`](../single-instance.mjs)
  only raises the existing window on repeated launch; it does not consume files.
- [`workspace-registry.mjs`](../workspace-registry.mjs) validates workspace/team
  identity and transactionally admits workspaces; a file request must not bypass
  that process. [`server-compat.mjs`](../server-compat.mjs) verifies backend
  package/version and workspace coverage, not merely a live port.
- [`cli-locator.mjs`](../cli-locator.mjs) and
  [`cli-adapter.mjs`](../cli-adapter.mjs) keep lifecycle operations on a compatible
  installed CLI via absolute executable/argv and JSON receipts. Absent or
  incompatible CLI means observation-only, never a bundled kernel fallback.

## Proposed agent-facing command and identity

Illustrative syntax only — **do not run; not an existing command**:

```text
oats desktop open-file [--home <instance-home>] [--dir <workspace-context>] --json -- <path>
```

One local file per invocation. The kernel/CLI owns argument parsing, scope and
home resolution, path normalization and canonicalization. Relative `<path>` is
proposed to mean relative to the CLI invocation cwd, never Desktop's cwd, active
terminal cwd or current renderer workspace; `--dir` selects configuration context,
not the file base. From an instance home, `work/docs/plan.md` is explicit. Treat
paths literally after `--`; no glob, shell, URL, environment or command expansion
inside this command. `file:`, `javascript:`, `data:`, custom executable URLs and
network locations are not accepted file selectors.

Resolve the originating instance home through CLI authority (explicit `--home`
or verified instance context), not a bare instance/soul name. Carry canonical
home, agents-root and canonical workspace/team scope ID; compare them with the
receiving app's validated workspace and local roster. A repository/worktree path
is not a workspace ID, and instance `work` is a mode, not a path. Mismatched
home/scope, same-named twins, unknown homes or remote host identities fail closed;
never reinterpret a remote absolute path as local. Non-instance invocation and
remote delivery are out of this first proposal.

The CLI sends a canonical absolute file selector, **not authority to read it**.
Desktop independently verifies containment for the named workspace/home, then
retains the existing guarded reader. The existing cross-workspace allowlist alone
is insufficient for this new request. No new root is admitted from request data.
Neither component imports/reimplements the other's lifecycle logic.

## Proposed delivery, ownership and acknowledgement

- **No implicit Desktop launch**, OS `open` fallback, backend startup/replacement,
  window creation, workspace addition or app activation by executable URL. Target
  an already-running, ready Desktop session. A listening HTTP server is not proof
  that a Desktop window exists or owns it.
- Require a negotiated file-open protocol version and explicit capability on
  both CLI and Desktop, in addition to existing compatibility checks. General
  `desktopApi: 1`, package version or a successful `/api/file` read does not imply
  support. Capability name/version floor remain cli-dev decisions; old, pending,
  unknown or mismatched peers refuse without fallback or ignored new flags.
- Transport is **undecided**. Before implementation, the coordinator must approve
  local-user authentication, endpoint discovery/provenance, permissions and peer
  verification. Do not repurpose GET, the generic API proxy, terminal IPC,
  second-launch argv or a deep link as an unreviewed privileged channel. No
  arbitrary caller-supplied URL/port, filesystem scanning or network relay.
- Proposed logical request fields: protocol version, unique request ID, expiry,
  resolved workspace/home/agents-root, absolute path and read-only intent. Bind it
  to an authenticated Desktop session, window/renderer lifetime and server epoch;
  the request cannot nominate an arbitrary Electron webContents ID. No file
  content, model settings, commands, PTY target, credentials or executable URL.
- Enforce finite limits at the receiving owner, not just in renderer UI.
  Candidate ceilings for review: one path, 8 KiB request/ack, 2 MiB actual file
  bytes, 5-second end-to-end deadline, 16 pending requests per session. Rate and
  dedup-cache bounds must also be agreed before implementation. Reject overload;
  never persist a backlog for the next app launch. Bound reading/rendering too:
  today's pre-read `stat` size check plus `readFileSync` is not an atomic bounded
  read or a complete file-replacement/encoding defense.
- Proposed conservative focus policy: accept only into the explicitly matched,
  already-open **active workspace** of one unambiguous live owner window. Otherwise
  return a not-active/ambiguous-owner result; do not switch workspaces or guess
  “first window.” Open/select a normal file tab, deduplicated by workspace +
  canonical file identity. No special file sidebar or new editor layout.
- Capture workspace generation (including A → B → A), latest selection intent,
  owner lifetime and epoch at dispatch; recheck on success **and rejection**.
  Close, reload, navigation, newer selection or expiry makes outstanding work
  inert. Never focus a terminal, revive a closed tab or display stale errors.
- `--json` should emit one bounded versioned result, with diagnostics on stderr.
  Final success means the owning renderer loaded and committed the readable tab
  (or selected the matching loaded tab), not merely queued a request. Ack echoes
  request ID, resolved workspace/home/path and owner-scoped tab ID with
  `opened`/`selected`; it does not claim the human read the file. A receipt must
  not carry file contents or secrets.
- Use stable structured refusal codes and nonzero CLI exit for unavailable,
  incompatible, unauthorized, invalid identity/path, inactive workspace,
  ambiguous owner, missing/denied/unsupported/oversized file, busy, cancelled or
  timeout. Exact spellings/schema are proposed, not existing CLI API. Receiver
  domain failures resolve as results, not leaked IPC exceptions. A lost final
  ack is **outcome unknown**, never success or proof that nothing opened. Retries
  reuse the request ID within a bounded dedup lifetime; no duplicate tab/focus
  effect and no replay into a replacement session. Expired uncommitted work dies.

## Untrusted artifacts and side-effect exclusions

Preserve sanitization and anchor normalization for all Markdown, including raw
HTML; highlighting/HTML/code is inert display, never execution or HTML preview.
Labels, paths and errors enter safe text/DOM properties. No scripts, handlers,
forms, embedded active documents, executable schemes or navigation that inherits
preload privileges. No automatic remote images/resources or linked-file reads;
explicit local links must pass the same read authorization, and external HTTP(S)
links only the existing guarded user-click policy. Browser-selected files cannot
silently acquire absolute-path authority through embedded links.

Regular-text/type/encoding, symlink replacement and actual byte-limit defenses
need behavioral verification before enabling the command; do not claim the
current reader already guarantees race-free reads or strict UTF-8 validation.

Opening, failing, closing or retrying a file must not write files, change Git,
spawn/retire/restart an agent, change model/provider/configuration, send a prompt,
attach/copy into a PTY, create tmux viewers or alter terminal targets/input focus.
Existing observation-only viewing remains usable without this future command.

## Acceptance cases (future tests, not executed evidence)

| Case | Required outcome |
| --- | --- |
| Markdown and source code from a verified home | Read-only normal tabs in the intended workspace; source never runs; repeated canonical path selects its existing tab. |
| Relative paths, spaces, leading dash, symlink alias | CLI alone resolves against invocation cwd; literal argv handling; canonical identity returned; no shell interpretation. |
| Same names across roots/workspaces; remote lookalike | Exact home/scope match only; mismatches refuse without global fallback or local reads of remote paths. |
| `..`, sibling-prefix escape, external symlink, root swap | Deny outside admitted scope, with no leaked bytes; immutable root admission preserved; replacement races fail closed. |
| Missing, unreadable, directory, FIFO/device, binary, malformed encoding, growing/oversized file | Bounded typed failure; no blocking special-file read, unbounded allocation or false success. |
| App absent, backend alone, incompatible/missing capability | Nonzero structured refusal with manual-launch/update guidance; no launch, port scan or workspace/server mutation. |
| Forged peer/frame/URL, stale session or ambiguous window | Refuse at the authoritative boundary; no renderer delivery, navigation or authority broadening. |
| Slow success AND rejection during A → B → A, newer selection, close/reload | Old work cannot select/reopen tabs, paint errors or steal focus; mutation-removing ownership checks must fail tests. |
| Flood, duplicate, expiry, lost ack, app restart | Enforced caps/deadline; replay-safe receipt or explicit unknown outcome; no durable queue or duplicate UI effect. |
| Hostile Markdown/HTML/links, code and filenames | Inert content, no executable URLs/automatic remote loads; safe text labels; links cannot bypass file guards. |
| Browser chooser select/cancel and local links | Only selected bytes are available; no inferred absolute path, server-root expansion or PTY attachment; cancellation inert. |
| All success/error paths | File/Git/model state and PTY/tmux targets/bytes unchanged; keyboard tab access, close and workspace memory retain normal viewer semantics. |

## Decisions required before implementation

1. **Coordinator/security:** approve transport and discovery/authentication threat
   model, lifetime ownership, per-workspace read admission and read-race hardening;
   exact quotas/expiry/dedup semantics. Existing guards must not be weakened.
2. **cli-dev:** own kernel command syntax, home/scope and relative-path semantics,
   protocol/capability advertisement and compatibility floor, JSON/exit/error
   contract and CLI-side tests. No Desktop-side invented kernel mutation.
3. **Maintainer + ux-designer:** approve conservative foreground/active-workspace
   behavior, normal-tab placement and chooser UX while retaining soul-first IA.
4. **Desktop + CLI owners:** agree cross-boundary behavioral tests and controlled
   live verification before declaring support. This document supplies no approval
   or implementation evidence.
