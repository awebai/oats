# Desktop readiness (slice 5)

Readiness is an **offline observation**, not permission to spawn and not a
configuration writer. Workspace → **Readiness…** opens the first-run card;
empty Workspace content also offers an invitation. It is not a new navigation
destination or a launch gate. The roster remains real; an empty roster never
means "not enrolled". **Skip for now** dismisses the presentation for this
workspace/session, without changing a check or recording membership.

Capabilities includes a separate **scope-bound effective-readiness** section.
Classic acquisition rows remain independent observations. The consumer does not
parse strings such as `foo activation`, join scopes by capability name, or stamp
one scope verdict onto every package. Soul/instance inspection can show the same
quartet and policy at its qualified target.

## Boundary

`POST /api/workspace-readiness?ws=<advertised workspace ID>` accepts only:

```json
{"action":"read","selector":{"kind":"scope","context":"/admitted/context"}}
```

Other exclusive selectors:

- `{kind:"soul", soul, agentsRoot}`: one local roster soul at that exact root.
- `{kind:"instance", instance, agent, agentsRoot, server:null}`: shared exact
  instance admission resolves the home. No renderer-supplied home or cwd.

Scope contexts are admitted workspace scopes/local agents-root parents. Body
size is limited to 64 KiB. Duplicate/extra/missing query or body keys refuse.
Workspace-addressed route families are pinned in the main-process proxy. The
backend's loopback Host/Origin guards and IPC main-frame/navigation/epoch guards
precede dispatch. Domain errors resolve with stable codes, not raw exceptions.
Remote/server-marked targets refuse, with **no local or classic fallback**.
Captured-mode refusal (`E_UNSUPPORTED_MODE` / `unsupported-action`) is preserved.

The installed CLI must be compatible and positively advertise both the
`readiness` feature and exact integer `readinessApi:1`. A version alone does not
permit invocation. Locator and backend status forward the advertised API; absent,
string or future API versions do not enable it.

Only fixed argv is constructed:

```text
readiness --dir <context> --policy --json
readiness --dir <root-parent> --soul <name> --agents-root <root> --policy --json
readiness --home <resolved-home> --soul <agent> --agents-root <root> --policy --json
```

A home **never** gets `--dir`; the CLI derives its recorded context. Process cwd
is server-owned (the workspace scope for a home). Ambient `PI_AGENTS_ROOT`,
`OATS_DEPLOYMENT` and `OATS_RESOLUTION` cannot redirect this explicit read. No
renderer env, arbitrary argv, direct Git, YAML parsing or kernel import is added.

Offline execution uses `execFile`, `shell:false`, a 15-second deadline and 4 MiB
output limit; the proxy deadline is 20 seconds. A clean exit and valid JSON-v1
envelope are both required. Four distinct reads may be in flight across the
owning process. Exact invoker/CLI/workspace/selector duplicates coalesce; there
is no unbounded queue, persistent fact cache or roster-poll-driven read. Each
caller revalidates its admission and CLI identity after success **or** rejection.

## Projection and semantics

```text
{readinessViewApi:1, status:available|unavailable,
 target:{workspace,context,observedAs,selector,home?}, data, reason}
```

`target.observedAs` is the exact selector kind sent (`scope`, `soul`, `instance`).
The target describes the admitted **invocation**, not a synthesized producer
revision or permission lease. `context` is the invocation context/cwd, not a
claim that a home's recorded repository equals the workspace scope. K5's `at`
is the observation time; its optional additive `subject.selector` is retained
as bounded known scalar metadata. Missing producer echo/revision is not invented.

The four checks are installed/trusted/configured/enrolled. Items retain reported
requiredness, status, producer, evidence and display-only remedy. Unknown, fail,
optional and not-applicable remain distinct. Valid **producer `summary.ready`**
is authoritative; contradictory counts/items, an empty required set marked
Ready, malformed or oversized data fail closed. At most 1,000 items per check,
64 notes and bounded scalar evidence are admitted. Unknown objects/settings and
raw diagnostics are not forwarded.

- Installation is not executable approval. A source signature is separate from
  both. Only a verified signature with a safely reported named signer renders
  **Signed by**. Unsigned, invalid, unknown and N/A are not synonyms. An untrusted
  signing key is labelled separately. Signature `reason` is mapped to fixed
  consumer text: older producers put raw Git stderr there.
- **View policy** expands the same read, without another command. Allowed/denied/
  unknown, `enforced`, origin and work mode are shown separately. A declaration
  or default is advisory, not an enforced instance policy. This is lifecycle
  authority, **not an OS sandbox**.
- Enrolment means reciprocal workspace-member admission, not native login or
  team registration. No Desktop membership inference, config parsing or repair.
- Remedies are inert display text, never automatically executed or pasted into
  an agent terminal. Account state, catalog identity and runtime presence do not
  certify K5 configuration or readiness.

## Deliberately unavailable actions

**Verify signatures…** is unavailable throughout slice 5, with this explanation:

> signature verification is a network action; its bounded-custody contract is not yet advertised by the installed CLI

Ordinary reads never include `--verify-signatures`. A later separately approved
consumer must positively negotiate `readiness-verify` and its bounded CLI-owned
transport/process-group/temporary-directory custody. Even advertisement of that
future feature does not enable verification in this consumer.

**Enrol workspace** is unavailable because there is no installed CLI admission
command/two-document revision receipt seam yet (K11). No `oats onboard`
substitution, guessed command, credential form or file writes. Skip cannot turn
unknown/failing enrolment into N/A or pass.

## Ownership and verification

Selection/refresh/mount/workspace A→B→A/CLI identities guard every async success,
rejection and shared-control cleanup. Old controls, disposal, hidden presentation
and workspace switches cannot steal focus or paint a different subject. Settled
read-only DOM and policy disclosures survive identical roster polls. Explicit
entry/Skip count as selection intent, so older deferred Workspace handoffs lose
ownership. Agent terminals, tmux viewers, key tables and workspace transactions
are unchanged.

Tests use inert CLI, HTTP/IPC and DOM fixtures, including forged requests, strict
feature negotiation, bounded coalescing, stale results on both paths, scope/root
identity, no verification/remediation and all typed states. Computed contrast of
actual readiness markup is checked in all three themes; this is not native GUI
acceptance. Desktop/focused tests run locally; the full seven root gates run in
PR CI. No installed-app restart or operator action is part of qualification.
