# Desktop schedule observations (K8b)

Schedules uses the installed CLI's **History API 3** read boundary. It does not
read schedule files, reconstruct runs, implement cron/kernel rules, start a
scheduler during a read, or open a terminal from historical provenance.

## Capability and subject

Both `scheduleHistoryApi === 3` (integer) and the `schedule-read-2` feature are
required at server admission **and at the process-execution owner**. Version
strings, `scheduleApi: 2`, `schedule-history`, and unknown capabilities are not
substitutes. The locator forwards the exact supported integer. Mutation support
still requires its independent `schedule` / mutation-API contract.

Read requests require an explicit, advertised local workspace. The admitted
workspace's scope supplies `--dir` and `cwd`. No renderer body supplies a path,
home, environment, server, spec, force/clear flag, cursor or execution command.
The result must echo that scope and, for show, the canonical requested ID.
Read IDs use `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; the existing mutation adapter's
narrower ID vocabulary is not broadened by history support.

Remote history is explicitly unsupported in this slice, even when the local
CLI can mutate schedules remotely. There is no local substitution or optimistic
remote read. Captured definitions can be observed but not edited by the legacy
editor:

> this schedule carries an execution policy the editor cannot preserve; edit via CLI

Enable/disable and other existing operations remain separate CLI mutations;
this read contract grants none of them.

## HTTP, IPC and process boundary

- `POST /api/workspace-schedules?ws=ID`: exactly `{action:"list"}` or
  `{action:"show",id:"..."}`; exactly one nonempty workspace and no other query.
- Legacy `POST /api/schedules?ws=ID` `operation:list|show` spellings normalize into
  the **same** read broker, fences, coalescing and budgets. Extra fields refuse.
- `GET /api/schedules` and non-POST methods on either path return typed 405
  without running a command. No first-workspace default remains.
- Read input acceptance is **16 KiB UTF-8**, including whitespace. The new path
  and main read proxy reject at that cap. The legacy HTTP path shares a strict,
  bounded **64 KiB decoder** with existing mutations; after decoding, read
  aliases exceeding 16 KiB are refused **before admission or dispatch**. This
  preserves existing larger mutation bodies without a weak read alias.
- Host/Origin guards still cover the routes. Normalized main routing covers URL
  aliases, with trusted sender/mainFrame, navigation and copied connection epoch
  checks on success and rejection. Missing/unadvertised workspace selectors are
  not silently replaced by another admitted scope.
- Two **process-wide** read slots, reserved before the first await. Identical
  in-flight requests coalesce across factories/aliases; each waiter re-admits
  independently. No queue or settled cache. Arguments and results are copied.
- Fixed argv: `schedule list --dir SCOPE --json` or
  `schedule show ID --dir SCOPE --json`, `shell:false`, **30 s / 4 MiB**. Ambient
  `PI_AGENTS_ROOT`, `OATS_DEPLOYMENT`, `OATS_RESOLUTION` are removed; host registry
  configuration is retained. Success requires a clean exit and one valid envelope.
- Main uses **35 s / 4 MiB**, consumes the response as a stream, and cancels
  before copying an oversized chunk. It reprojects the public DTO independently.
- Typed errors resolve. Raw stderr, error messages, stacks, candidate trees,
  identity-conflict values and host paths are not published. Allowlisted logical
  refusal source facts (`definitions`/`state`, status, bytes) survive.

The public wrapper is `{scheduleReadViewApi:1,status,workspace,scope,data,reason}`.
The added workspace echo binds the normalized route selector; scope binds the
producer's actual owning context. A refusal may have null identity before
admission. Scope/roots/revision, CLI identity/mode and probe epoch own admission
before dispatch and both completion paths.

## Actual producer shapes and projection

CLI list returns `{scope,scheduleApi:2,scheduleHistoryApi:3,integrity,schedules,
scheduler}`. CLI show returns **`{schedule: Entry}`**, not a separate definition
wrapper. Entry contains definition fields plus scope/canonical ID, history and
observations. **Scope integrity is list-only**; show does not fabricate it.

The public data shape is `{action,scope,integrity,schedules,scheduler,draft}`:

- At most **200 definitions**, **50 rows per job**, **50 aggregate displayed
  rows**. Counts/truncation are validated against returned rows. Excess/mismatch
  is explicit, not a healthy empty fallback.
- Unreadable definitions and corrupt history stay isolated. An unreadable,
  bounded malformed key is display-only, never usable as an action selector.
  Corrupt individual run elements remain visible as corrupt records.
- Run IDs are **opaque**, not rehashed, length-24-hex-validated or deduplicated by
  Desktop. Legacy rows remain separate with unknown settlement. A modern row
  preserves its producer transition order and settled fact; `lastRun` does not
  acquire settlement fields by inference.
- Dates are validated. Malformed time facts become explicitly unreported, never
  `Invalid Date`, an invented date or a duration. Duration needs actual valid,
  ordered start/end facts. `ended` is not task success; `delivered` is not consumed.
- Allowlisted summaries exclude task/message text, argv, environment, execution
  capsules, preparation, raw errors and host registry/unit paths. Credential-like
  details and URLs are withheld. No NLP or diagnosis from error prose.
- Session `{instance,home,incarnation,server,delivery}` is **provenance only**.
  Missing instance is not inferred from a home basename. There is no link, file
  read, terminal attach, Start action or transcript reader. K12 is a separate
  contract, not enabled by API 3 and not included in this release slice.

## Editor and view lifetime

One read on owned view entry, then explicit Refresh (and refresh after an
explicit existing mutation). **No automatic command polling or timer.** Shared
CLI probe settlement may complete a pending initial entry read. The current
observation has a Desktop read timestamp and becomes visibly stale after a
failed refresh or invalidation. Same-view stale rows remain inspectable, not
mutation authority. Workspace/server changes clear retained data; nothing is
persisted or cached across views.

The table and Recent runs use native buttons/switch semantics, details/summary,
headings and table headers. Unchanged nodes remain connected: no wholesale
repaint/focus restoration on refresh, no loss of native text selection,
disclosure or scroll state. Theme tokens only, no opacity over text.

List, show, form, provider operation and mutation completions have separate
intent ownership. Workspace generation, connection, CLI identity, disposal and
visibility revoke both outcomes; ancestor attribute old values catch hide/show
ABA. Detached controls cannot act on a same-ID job in a new workspace. Reads do
not reclaim focus.

Edit performs a **fresh show**, then independently fetches admitted form targets.
The complete bounded allowlisted legacy draft is separate from display data;
list/history never supplies a truncated/redacted task as save input. Unchanged
literal task/message/CRLF, purpose, model (including empty string), explicit false
permissions and each nested wake field are retained. Unknown definition fields,
unsupported kinds/options and captured policy cannot be silently dropped into
an editable draft.

A refreshed/replaced definition revokes an open editor's save authority without
throwing away its draft. Reported creation/update stamps plus projected definition
facts can match a history-only refresh; missing stamps are unknown, not a lease,
and require reopening Edit after a refresh. A concurrent list intent also revokes
an older show on success and rejection. This is **UI observation ownership, not
an invented kernel CAS or revision-bound mutation contract**.

## Qualification scope

`test/schedule-read-{contract,data,boundary,http,view}.test.mjs` exercises fixed
process recording, actual HTTP and main handler bodies in inert harnesses,
stream limits, stale outcomes and JSDOM view/form ownership. Existing schedules
and mutation fixtures remain covered. `test/theme-contrast.test.mjs` inventories
computed table/menu/history surfaces in White, Solarized and Dark.

Stored maintainer receipts are validated outside the repository through the
actual adapter, broker and public reprojection without executing their paths.
Exact producer descriptor-reader probes use a memory-only filesystem. Critical
consumer guards are mutation-tested with in-memory module replacement, leaving
repository bytes unchanged.

Desktop and focused tests run locally. All seven root gates run in PR CI.
Computed CSSOM/inert fixtures are **not native visual, packaged artifact, live
scheduler or terminal acceptance**; those remain maintainer-owned.
