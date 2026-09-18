# Explicit Herdr protocol20/22 adapter compatibility

The host-local adapter in `lib/herdr.mjs` supports exactly numeric protocols **20**
(documented0.8 baseline) and **22** (documented0.9.0 native schema). This is explicit
selection, not version negotiation or proof of an installed/running backend.

## Shared adapter interface

- `HERDR_PROTOCOL` remains20 for existing legacy/default behavior. In particular,
  the unchanged legacy `ensureHerdr` path is not silently switched to22.
- `HERDR_SUPPORTED_PROTOCOLS` is the frozen `[20,22]` set.
- `isSupportedHerdrProtocol(value)` accepts only those numbers; no strings,
  omitted/null value, protocol21, future number or range is accepted.
- `herdrSnapshot(target, io)` requires a supported explicit target protocol before
  issuing a command, then requires **snapshot.protocol === target.protocol** and a
  pane inventory. A20 target cannot accept a22 snapshot, or vice versa. Missing or
  malformed observations refuse; saved target metadata is not upgraded/downgraded.
- `allocateHerdr` also validates the selected protocol before workspace creation,
  preserving it alongside the actual returned workspace/pane/terminal identifiers.
  As before, callers own preflight/admission and the pending/observed-target ledger;
  allocation is not a new independent lifecycle transaction.
- `validHerdrTarget` recognizes both explicit protocols with its existing target
  checks. Delivered strict workspace/pane/terminal uniqueness, explicit socket
  transport, replacement refusal, run/input/stop behavior and server-error handling
  are retained. No daemon, focused target or alternate-backend fallback is added.

The captured caller and generated request/target schema must use the same set and
retain selected/admitted/observed target equality. That integration belongs to the
lifecycle owner (`lib/captured-session-backend.mjs`, core and shared schema generator),
not this adapter-only change. A current const20 caller still correctly refuses22 until
that separate integration lands. API availability is not protocol/host/model readiness.

## Documented native0.9 subset

The bundled protocol22 schema retains `.result.snapshot`, panes/agents and their
workspace/pane/terminal identifiers, `.result.root_pane` allocation identifiers,
agent status values and process-info fields used by the existing adapter. The CLI
spellings remain `api snapshot`, `workspace create --cwd ... --label ... --no-focus`,
`pane run <id> <command>`, `pane process-info --pane <id>` and `pane close <id>`.

These observations justify reusing the adapter, not treating arbitrary later protocol
numbers as compatible. Client version, server version, endpoint-protocol generation,
OATS API version and native request version remain distinct facts. Explicit existing
operator-managed executable/socket and actual server protocol must be qualified by the
real acceptance gate. No `HERDR_ENV` value is fabricated or focused user session used.

## Evidence boundary

`test/herdr-protocol.test.mjs` uses injected inert command responses, not a live
server or process:20/22 preservation, unknown/missing refusal before commands, exact
snapshot mismatches, actual-ID projection, explicit command/socket transport, strict
ambiguous/foreign/replaced targets and stop/input behavior. Existing adapter tests
remain applicable. The controlled scaffold probe composes resources and normally
retires without invoking a backend.

This slice does not qualify public native protocol22 integration, real model health,
Pi managed-resource eligibility, worker completion, public retirement/recovery, private
messaging, release floors or production. None of those guards is removed. Ordinary
already-authenticated harness operation remains separate from this backend adapter;
no auth-file selector, credential copy or production profile substitution is introduced.
