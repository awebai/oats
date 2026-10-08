# Desktop Schedules and Triggers (feature `automations`)

The Schedules and Triggers pages read and act through the installed CLI's
workspace automations contract (kernel 0.29.0: feature `automations`,
`automationsApi: 1`; `docs/desktop-cli-api.md` § "Workspace triggers and
schedules"). The Desktop never reads automation files, evaluates cron or
placement, or re-derives where something runs: `runsHere`, `reason`,
`enabledHere` and `nextDue` are the kernel's.

## Boundary

`POST /api/automations?ws=<id>` with `{ kind, action, key? }` (body ≤ 4 KiB,
exactly one `ws`, the server-wide loopback Origin guard):

| kind | actions | key |
|---|---|---|
| `trigger` | `list` | none |
| `trigger` | `status` | optional |
| `trigger` | `enable`, `disable`, `test` | required |
| `schedule` | `list` | none |
| `schedule` | `enable`, `disable`, `test`, `run`, `reconcile` | required |
| `trigger`, `schedule` | `describe` (with `description`) | required, local |

`key` is the row's qualified id (`local/<id>`, `<member>/<id>`) or a bare local
id, never option-shaped. The server runs `oats <kind> <action> [key] --dir
<workspace scope> --json` (argv only, the accepted CLI binary; 30 s, 60 s for
`trigger test`) for a **local** workspace only.

`describe` (feature `automation-descriptions`, kernel 0.43) sets or clears a
local item's summary: `oats <kind> update <key> --description=<text> --dir …
--json`, the text as ONE `=` token so a `-`-led value never becomes a flag, and
`""` (exactly `--description=`) clears it. The server refuses before any call a
workspace key, `description` on any other action, and text outside the
kernel's rule (one line of 1 to 200 code points, no `\p{Cc}`, no U+2028 or
U+2029); without the feature it answers `E_DESCRIPTIONS_UNAVAILABLE`. The
kernel answers `{ schedule: <row> }` or `{ trigger: <row> }`.

The answer resolves; it never rejects:

`{ automationsViewApi: 1, status: "ok" | "unavailable", kind, action, result, reason }`

- `result` is the kernel's result verbatim; the renderer's `automation-rows`
  adapter projects it.
- A kernel refusal keeps its own code and bounded message
  (`E_AUTOMATION_NOT_HERE`, `E_AUTOMATION_WORKSPACE`, …).
- The Desktop's codes: `E_AUTOMATIONS_UNAVAILABLE` (no feature or API),
  `E_WORKSPACE_UNKNOWN`, `E_UNSUPPORTED_REMOTE`, `E_BAD_ARGS`, `E_CLI_PROTOCOL`
  (a document of the wrong shape).

The app proxy classifies `/api/automations` as its own route, pins the verified
workspace unless the server advertises the one asked, keeps duplicate `ws` for
the backend's refusal, and allows 90 s.

## Summaries and the detail page

The adapter (`renderer/automation-rows.mjs`) reads every fact a view shows
from the kernel row explicitly: what each run sends (a wake's `message` and
`home`, a command's `argv` and `cwd`, an `operation` and its `home`), a spawn's
`purpose`, `backend`, `yolo` and own `wake` (under `spawn` for a trigger), the
run state (`running`, `attempt`, `pendingWake`) and `createdAt`/`updatedAt`.
`raw` feeds only the local editor's draft.

- **The list row** shows the bare `name` beside its origin tag (the qualified
  id is the title and the accessible name). Under it, `summaryLine`: the
  `description` as text; else the first non-empty line of the task (spawn,
  trigger) or wake message, muted italic, titled "No summary set — first line
  of the prompt"; else "No summary". Nothing is ever derived from argv.
- **The detail page** shows the name with the qualified id under it, then the
  summary or "No summary". What it sends is shown whole, never summarized;
  Spawns (spawn schedules, triggers) adds the purpose, permissions, backend
  and the recurring wake. `runState` gives the Run state card. `running` is
  the job lock, a host slot, not proof of a launch: an attempt whose effects
  are unconfirmed keeps its lock. So unknown wins (an attempt with an error, an
  attempt without its lock, or a last run of outcome `unknown`), with its exit
  facts, whether it still holds the slot, *Check run state* and the
  `reconcileCommand` to paste (`oats schedule reconcile <qualified id>
  [--clear] --dir <scope>`); otherwise a held lock is "Running since"; and a
  wake waiting to be delivered. An Invalid or
  Unreadable item gets its own card (code, field, message); Comes from adds
  the package template's provenance and a local item's times.
- **Writes** need `automation-descriptions` (`automationDescriptionsSupported`;
  reading needs no gate, an older kernel sends null). *Edit summary* (the
  lede, the page bar and the row menu, local rows only) opens one modal
  sheet per view. Its save is a latest-intent operation: closing or disposing
  invalidates it, focus parks on the sheet's status line while it runs, and it
  returns to the opening control, or the same control by identity after the
  re-read. Both editors send the text as typed (the kernel keeps boundary
  spaces); only an empty value clears. Neither sets a native `maxlength`: it
  counts UTF-16 units and would cut a valid summary of emoji short, so the
  code-point rule (`descriptionValid`) alone limits the length, with its message. The schedule form's Summary field shows only with the feature;
  without it the form keeps the stored summary as it is.

## A trigger's status and test (kernel 0.49 fields)

`triggerStatus(json, id, { source })` and `testResult(json, kind, { source })`
project `oats trigger status` and `oats trigger test`; `source` is the list
row's `on.source` (status rows carry no `on`). Every 0.49 field is optional:
without it the page renders as before. Each kernel string (subjects, events,
instance names, error messages and codes, poll errors) goes through
`displayLine` and is set as text; `null` from it is absent. A malformed entry
is skipped.

- **Event labels** (`eventLabel(entry, source)`): the event's `subject` (a
  string), else its `number`, prefixed `#` only for a `github.pull_request`
  source; with neither, the event `key`. Used for waiting, live and fired
  events, the list row's last fire and the Test card. Never `#null`; a `null`
  repo omits the Repo fact.
- **Recent fires** shows, in order: *Last poll* (`<time>: <prs> pull requests,
  <matching> matching`, or `<time> failed: <error>`; nothing when `lastPoll`
  is absent or malformed, and the counts must be non-negative safe integers);
  *Last error* (the message, then the code in mono); *Waiting* (`pending`,
  newest `observedAt` first, an unparseable time last, kernel order among
  ties; at most 10, then "and N more"); *Live now* (`live`: instance and
  label); then the fires.
- **The Test card** lists each `wouldFire` entry as `<label> → <instance>`
  (the name the spawn would be asked to derive), "(held)" when held, and
  "name shortened to fit" with an `aria-description` (and title) when
  `nameCut`; with no `instance`, only the label.

## Opening a definition

A row's file opens read-only in a tab from `origin.localPath` (this
deployment's own file, or the member's clone here) through the contained
`/api/file`; without one, the kernel's `origin.url` opens externally; else the
action is disabled with its reason.

## The local form

Local schedules are still created and edited by the form, through
`POST /api/schedules` (`add`, `update`, `remove`, `reconcile`, `host-*`). The
draft (`renderer/schedule-read-data.mjs`, `scheduleDraft`) is the stored local job exactly, or
nothing ("edit it with the CLI") when the form cannot keep a field.

## Tests

`test/automations-server.test.mjs` (captured argv, verbatim results, refusals,
gates, keys, the adapter over the real shapes), `automations-view.test.mjs`,
`automation-descriptions.test.mjs` (summaries, every detail card, Edit summary,
the gate, the form's Summary), `trigger-subject-rows.test.mjs` and
`trigger-subject-view.test.mjs` (the 0.49 status and test fields),
`schedule-draft.test.mjs`,
`normalized-api-guards.test.mjs`; fixtures `test/fixtures/automations/kernel/`
and `test/fixtures/automation-descriptions/` (kernel captures,
`provenance.json`; the latter re-captured with `CAPTURE_COMMIT=<oid> node
capture-descriptions.mjs <kernel tree>`).
