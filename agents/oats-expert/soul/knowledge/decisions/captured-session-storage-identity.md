---
type: Decision
title: Durable identity for captured native session storage
status: accepted
description: Require a narrowly versioned kernel-owned external identity witness when captured execution promises to reject replacement of the original native session directory.
tags: [architecture, portable-souls, runtime, custody, sessions]
timestamp: 2026-09-18
---

**Status: accepted by the human 2026-09-18; five-library guard source locally
reviewed and integrated, actual native qualification pending.** The human
subsequently approved the exact five-library enforcement exception below.
The kernel consumer must accept the authorized manifest evolution without
weakening its separate incarnation/home/intent custody checks. The approval remains limited to the session-directory identity witness. It concerns
the directory containing native session history, not harness credentials, the
SDK installation, runtime-bundle grants, a new account identity or a new general
storage service.

# Context

Independent review of the initial zero-plugin Pi-host proposal against runtime
`cd938860` found a mismatch between its promised original-root replacement
protection and existing authority. Native location receipts retain canonical
paths, but not a durable identity of the Pi session directory. A path can name
a different real directory after deletion/recreation or replacement.

The existing recorder can attribute an explicitly injected session directory to
a launch. That is not proof that the same filesystem object remains there across
starts. A marker inside that directory is not an independent witness, because
replacement also replaces the marker. The host proposal cannot claim stronger
protection while simultaneously forbidding every necessary durable witness change.

# Options

1. **Keep path attribution only.** Document its weaker guarantee and drop original-
   root replacement protection. Not recommended for the proposed captured host;
   do not call path equality object-identity validation.
2. **Add a narrowly versioned witness in existing kernel custody.** Recommended.
   Retain nonsecret directory identity outside the protected root, bound to the
   existing incarnation and admitted native action, without a second store or
   identity system.
3. **Redesign the native record engine or all backends.** Not needed as the default
   direction for this small slice; any unavoidable additional surface must be
   identified and approved separately rather than silently expanding scope.

# Decision

Choose option 2: permit the narrowly versioned kernel-owned witness in existing
custody. Under the human's subsequent delivery-workflow direction, developers
close the exact codec/state/compatibility contract in their bounded implementation,
and the maintainer integrates and reviews the combined candidate before main or
release. Separate reviewer-instance and preimplementation handoff waits are not
required for this delivery wave. No further general human milestone approval is
needed within the accepted boundary:

- Prefer an existing kernel index, pending receipt or session receipt. Version
  the changed shape explicitly; reuse an existing suitable directory-identity
  codec rather than inventing competing path or root-resolution authority.
- Retain the witness outside the directory whose identity is being checked,
  under existing trusted custody and original incarnation/action association.
  The witness is evidence, not a new permission or native session identifier.
- Specify exclusive first creation after admission, durable observation and
  persistence before dependent native effects, and validation at every managed
  boundary that relies on this stronger root guarantee.
- Define missing proof, partial creation, unknown outcomes, replay and restart.
  Preserve ambiguous data and hold: do not recreate, claim ownership by path,
  copy a marker into a replacement, duplicate dispatch or silently repair custody.
- Preserve required history/witness evidence across lifecycle operations. This
  does not implement or approve otherwise unfinished retirement/recovery paths.
- Keep legacy path-only receipts literal. Do not backfill them into stronger
  evidence or let old readers silently accept an unsupported format. Document
  public-result and compatibility behavior before implementation.
- The original slice excluded record-runtime edits. After inspection established
  that existing interfaces could not guard the actual dependent reads/appends,
  the human explicitly approved edits to exactly five `packages/record/lib/`
  files: `native-history.mjs`, `sessions-for-home.mjs`, `session-snapshot.mjs`,
  `capture-cc.mjs`, and `formats.mjs`. The last is protected traversal only,
  not transcript parsing. Relevant focused tests are included; recorder-bin,
  parser, journal, store or index redesign remain outside this exception.
  Do not claim protection that only some dependent paths actually enforce.

Path-only attribution is not accepted as a substitute for this stronger guarantee.
The human approval permits the smallest necessary versioned kernel index/pending/
session-receipt witness extension, not arbitrary schema or authority expansion.
The owner/reviewer still owns detailed design and source correctness; any change
outside these bounds requires its own explicit decision.

# Complete-pipeline advertisement

The pinned synchronous record seam comprises `inspectCapturedPiRoot`,
`prepareCapturedPiStart` and `assertCapturedPiStart`, with the existing native
record identifier retained. `CAPTURED_PI_RECORD_VERSION === 2` in native-history
must advertise the **complete** writer, discovery, snapshot/read, capture/append
and traversal enforcement chain, not writer support alone. No v1 fallback,
silent backfill or marker-only implementation qualifies.

The maintainer retained this single advertisement rather than adding separate
version exports to every internal module: the libraries ship together, and
additional self-reported constants do not establish enforcement. Source review
and behavioral checks must cover every dependent read and append boundary.
The original process's pending/witness association also remains valid across
same-execution reconciliation; an advanced retry counter is not a replacement
identity or permission to borrow another process's proof.

The existing external history manifest must retain the expected existing receipt
identifiers before pending publication/root effects. Enumerating surviving files
cannot establish completeness after a receipt disappears. A narrowly versioned
codec in that same manifest is within the approved custody work, not a new store
or general admission index. Missing claimed evidence holds rather than becoming
fresh history; incomplete legacy history must not be upgraded or backfilled.

Before-read protection also concerns the opened descriptor, not only its path.
A temporary ancestor redirect during open can leave a foreign descriptor even
when the named path is normal again. Bind the descriptor to the witnessed,
physically contained named source before reading; a later exception or refusal
to append cannot undo an already-performed foreign read.

# Separate decisions remain separate

The accepted [native harness authentication boundary](/decisions/harness-native-authentication.md)
remains unchanged: launch the already authenticated harness and let it handle
its own credentials. This decision adds no credential view, auth-file selector,
provider allowlist or login operation.

Strict selected curriculum, explicit host/model/mode selection, capability
approvals, source/helper edges and existing native intent/target custody remain
required. The supported offline SDK consumer seam is not a real model/backend
qualification, and approving this witness does not turn it into one.
