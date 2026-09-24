# Desktop readiness (workspace model, `readinessApi: 2`)

Readiness is an **offline observation**, not permission to spawn and not a
configuration writer. The soul inspector shows it for the selected **soul**
(what a spawn of it would resolve now) or the selected **instance** (its home
as spawned). There is no scope readiness: the kernel refuses a read with
neither `--soul` nor `--home` (`E_BAD_ARGS`), and the scope-wide lists are
`oats souls` / `oats capabilities`.

## Boundary

`POST /api/workspace-readiness?ws=<advertised workspace ID>` accepts only
`{"action":"read","selector":…}` with one exclusive selector:

- `{kind:"soul", soul, agentsRoot}`: one local roster soul at that exact root.
- `{kind:"instance", instance, agent, agentsRoot, server:null}`: shared exact
  instance admission resolves the home. No renderer-supplied home or cwd.

Body size is limited to 64 KiB. Duplicate/extra/missing query or body keys
refuse. Workspace-addressed route families are pinned in the main-process
proxy; the backend's loopback Host/Origin guards and IPC
main-frame/navigation/epoch guards precede dispatch. Domain errors resolve with
stable codes, not raw exceptions. Remote/server-marked targets refuse, with
**no local or classic fallback**.

**Gate:** the installed CLI's probe integer `readinessApi` is exactly `2`; there
is no feature string. A 0.25 kernel (`readinessApi: 1`), or an absent, string
or future value, gets the "update OATS" explanation and no request.

Only fixed argv is constructed (`--policy` is kept by the kernel):

```text
readiness --dir <deployment> --soul <name> --agents-root <root> --policy --json
readiness --home <resolved-home> --soul <agent> --agents-root <root> --policy --json
```

A home **never** gets `--dir`. Process cwd is server-owned. Ambient
`PI_AGENTS_ROOT`, `OATS_DEPLOYMENT` and `OATS_RESOLUTION` cannot redirect the
read. No renderer env, arbitrary argv, direct Git, YAML parsing or kernel import.
`--verify-signatures` does not exist on the workspace model and is never sent.

Offline execution uses `execFile`, `shell:false`, a 15-second deadline and a 4 MiB
output limit; the proxy deadline is 20 seconds. A clean exit and a valid JSON-v1
envelope are both required. Four distinct reads may be in flight across the
owning process. Exact invoker/CLI/workspace/selector duplicates coalesce; there
is no unbounded queue, persistent fact cache or roster-poll-driven read. Each
caller revalidates its admission and CLI identity after success **or** rejection.

## Projection and semantics

```text
{readinessViewApi:1, status:available|unavailable,
 target:{workspace,context,observedAs,selector,home?}, data, reason}
```

- `data.subject` is exactly the target: `{kind:"soul", soul, repoKey, commit, team}`
  or `{kind:"instance", instance, home, soul}`. Any other subject fails closed.
- The four checks are the kernel's: **installed · configured · member ·
  providers**. Items keep requiredness, status, producer, bounded evidence
  (a module's `from` renders as its origin) and a display-only remedy.
  Unknown, fail, optional and not-applicable stay distinct.
- **member** is the soul's member repository confirmed in the workspace
  (`oats-membership.yaml`), never login or team registration.
- **providers** relays each bound provider's own binding check **verbatim**:
  `item.result {status, problems[{code, message}], warnings[{code, message}]}`.
  The provider's `status` is one of four, and the item status follows from it:
  `ready` → pass, `needs-configuration` → fail, `authorization-required` →
  fail, `unavailable` → unknown. A known answer that contradicts its item
  status fails closed. The statuses are additive, so an unrecognised one is
  relayed as sent ("The provider answered: <status>.") under the item status
  the kernel reported. `authorization-required` is its own state, shown as **sign in
  needed** (item line and, when every failing provider only needs a sign-in,
  the check's badge), never as a broken provider. `warnings` is always present (possibly `[]`) and
  never changes the status: a passing item can carry warnings (e.g. E2EE
  disabled on a ready messaging binding). The Desktop shows them as reported
  under the item and counts them on the item's line, never in the summary.
  A provider that cannot answer is `unknown` with its `problems` and
  `result: null`. The Desktop renders unknown as unknown; it never special-cases
  a provider.
- Valid **producer `summary.ready`** is authoritative; contradictory counts/items,
  an empty required set marked Ready, malformed or oversized data fail closed. At
  most 1,000 items per check and 64 notes are admitted; unknown objects and raw
  diagnostics are not forwarded.
- **View policy** expands the same read: allowed/denied/unknown, `enforced`,
  origin and work mode are separate. For a soul it is the declaration
  (advisory); for a home the recorded, enforced policy. Lifecycle authority,
  **not an OS sandbox**.
- Remedies are inert display text, never executed or pasted into a terminal.

Removed with the classic model (never rendered): `trusted` and signatures
(declaring a package is the trust decision), `enrolled`, the scope subject, and
the Verify signatures / Enrol workspace controls.

## Ownership and verification

Selection/refresh/mount/workspace A→B→A/CLI identities guard every async success,
rejection and shared-control cleanup. Old controls, disposal, hidden presentation
and workspace switches cannot steal focus or paint a different subject. Settled
read-only DOM and policy disclosures survive identical roster polls. Agent
terminals, tmux viewers, key tables and workspace transactions are unchanged.

Tests replay the kernel capture (`test/fixtures/workspace-v2/f3b2`, readinessApi 2
on a Northwind scratch) through inert CLI, HTTP/IPC and DOM fixtures: forged
requests, the exact integer gate, bounded coalescing, stale results on both
paths, subject binding and every typed state. Computed contrast of actual
readiness markup is checked in all three themes; this is not native GUI
acceptance.

## Classic scopes answer v1 shapes

Until the kernel deletes its classic path, a classic scope still answers
`readinessApi: 1` / `operationsApi: 1` even from a kernel whose probe reports 2.
The Desktop dispatches on the payload's own integer, not only on the probe: a
v1 readiness answer is `classic-workspace` ("still uses the classic layout"),
and a v1 inspection says the same in the inspector. Neither is read, and any
other integer is a protocol error.

