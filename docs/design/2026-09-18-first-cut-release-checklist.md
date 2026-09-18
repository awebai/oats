# First-cut retained execution: installation and release checklist

This is an execution checklist for the release owner, **not a completed-release or
runtime-readiness claim**. The first-cut goal is an actual runnable packaged retained
path. A narrowly working profile does not establish full Desktop/plugin/lifecycle or
private-provider parity. Developers deliver code; the parent reviews combined code,
integrates, runs real acceptance and is the sole publisher. No independent-reviewer
wait is required by the current human workflow.

## 1. Freeze what is actually being shipped

- Record exact framework commit/tree, provider commit/manifest and runtime-consumer
  revision; retained resolutions, source/helper bindings, protocol selection and
  emitted witnesses must agree with that combination. Prior closed source gates are
  evidence at their old pins, not qualification of the new SDK host or protocol22.
- Include the explicit print-mode SDK host/parser/native-services assembly only when
  its complete retained eligibility/curriculum, kernel-owned task/args/thinking/history
  controls and approved external session-directory identity witness are implemented.
  Path-only history attribution is not an original-root identity witness.
- Launch the user's already-authenticated harness through its normal native profile,
  auth/helpers/OAuth/model configuration. **No auth-file selector, CredentialStore,
  key/provider allowlist, empty production store, profile substitution, credential
  inspection/copy or new login questionnaire.** Strict selected curriculum/history is
  a separate boundary, not a reason to replace native authentication.
- Preserve selected hard runtime/bridge/plugin requirements. If the first supported
  host is zero-plugin, a profile selecting an unqualified plugin/bridge remains held;
  do not remove that requirement to advertise default-OKF success.
- Record-runtime changes remain limited to the exact additional boundary explicitly
  assigned by the parent after resolving its scope. Do not import held patches or
  bypass the guard. No general record-package rewrite, bootstrap grammar, role-source
  adoption or proposed retirement semantics is part of this checklist.

## 2. Metadata and package surfaces (parent-controlled)

Choose an actual unused release version **V** after the final code/pin selection;
verify it against existing published artifacts. Do not invent a tag or claim that
source/API2/protocol22 alone establishes a package compatibility floor.

| Surface | Required check/update |
|---|---|
| `package.json`, `package-lock.json` | Kernel version/root lock agree; SDK host's real runtime dependencies/import resolution are declared and available after installation, not accidentally from a development/global checkout. Keep manifest exports usable. |
| `packages/pi/package.json` | Version agrees with kernel; actual supported SDK/native package dependency contract and extension resource paths are truthful. |
| `packages/desktop/package.json`, `packages/desktop/package-lock.json` | All three release manifests and lock root entries use V. This metadata alignment does not mean complete Desktop behavior is qualified. |
| Provider distribution/capability manifests | Selected provider version and minimum OATS floor must include its actual supported wire/input/runtime requirements. Source-main with old metadata is not a released compatibility claim. |
| `scripts/okf-source-inventory.json`, `capabilities/oats-okf/`, `package-catalog.json` | If shipping an updated default provider, use the authoritative provider source and existing mirror/finalization tooling, then verify exact retained closure/canonical aliases and real published refs. Never hand-edit the mirror or point a catalog at an invented tag. |
| `docs/release-notes/<actual-tag>.md` | Exact tag-matching filename exists before build/tag. List implemented profile/actual gates and every remaining refusal; no real-worker/learning or model-health claim from inert output. |

The existing `.github/workflows/release.yml` and `scripts/release-lane.mjs` derive V
for **root, Pi and Desktop**, using `--allow-same-version`. The older release skill's
blanket two-package/no-same-version description is not the current implementation.
No developer package/version edits are authorized by this checklist alone.

## 3. Artifact/install boundary

Release owner uses the existing release tooling; this lane performs no pack/install/
publish operation. Build from the exact reviewed commit, not moving HEAD.

1. Run the applicable syntax/project/package gates on that assembled tree. Confirm
   the new SDK host/bin, parser, native adapter and all runtime dependencies are in the
   **actual** kernel tarball; Pi bridge resources must also be in its tarball. Verify
   no deployment config/lock, agents/instances, credentials, private KB or scratch leaks.
2. Keep canonical Git payload aliases intact for selected capabilities. npm's omission
   of source symlinks does not make its copied provider subtree a self-contained Git
   distribution; use the supported complete provider acquisition path.
3. Pack kernel and Pi bridge once and record hashes. Install those exact tarballs in a
   clean external location, outside the source checkout. Confirm installed CLI/core/
   SDK-host dependency resolution with no repository-module or unselected resource
   fallback. A checkout scaffold is not an installed-artifact test.
4. Use existing public `prepare --request` with an explicit valid source export,
   deployment and workspace-or-standalone context. Approval/reprepare is explicit;
   no private scratch input/current-config hole filling. Do not assume the parked five
   roles or public bootstrap package have been adopted/published.
5. Inspect retained instructions/skills/launch inputs and preserve unsupported-profile
   refusals. Create only a new owned home; do not overwrite old instances/state. A
   source-complete helper is selected by its **SOURCE edge**, not a bare helper-ID
   start. No-launch can still run admitted hooks and is not a real session gate.

## 4. Parent-run real first-cut acceptance

Use the already assigned single provider/native path rather than inventing a second
matrix. Pin and retain its real results separately from old inert/seeded evidence.

- Both tmux and Herdr are required, not a deferred optional backend. For Herdr select
  the exact supported protocol and explicit operator-managed executable/socket; the
  server snapshot must match it. IDs are observed receipts. No automatic daemon start,
  tmux fallback, fabricated caller context or focused user session.
- Run an actual retained primary and exact SOURCE-helper through the new host, using
  normal authenticated native harness operation. Verify an actual turn/task result,
  selected curriculum and original session-directory identity/history continuity.
  Source deletion/current-config poison must not redirect the retained selection.
- Record dispatch acceptance separately from model health, task completion, capture,
  judged knowledge delivery, acceptance and fresh-reader learning. With default OKF,
  use the provider's explicit private owned directory-store path and required selected
  launcher/bridge; do not fake a worker/process/transcript or convert seed data into
  learning evidence. If a required bridge is unqualified, report the exact hold.
- Preserve source versus helper execution authority and original incarnation/intent/
  pending/history receipts across replay/restart/failure. Same-ID ambiguity never
  authorizes redispatch. Missing public retirement/recovery remains a documented hold,
  not permission to call a legacy/private fallback or delete an uncertain home.
- Credential/account/private-messaging authority is not granted by backend/model success.
  External human/admin private-aweb evidence cannot be manufactured by this gate.

## 5. Publication and honest first-cut status

The existing tag workflow publishes only after build/test/smoke **and Desktop matrix**
jobs are green; npm kernel then Pi, GitHub release/assets last. The existing runnerless
lane can stage exact artifacts and publish its two staged npm tarballs; the parent owns
whether/how to use that documented route. Do not edit away gates to meet a clock.

Before publication retain exact source/tag ancestry, version probes, package checksums,
provider provenance and completed gate receipts. Verify published versions, package
integrities/source identity and installed behavior afterward. Do not move a tag after
any publication; distinguish partial npm publication, GitHub assets and bump-PR results
before retrying the appropriate existing phase. No force-push or credential repair here.

If packaging or a required real gate is incomplete at the first-cut deadline, deliver
its exact candidate artifacts plus named hold; label it **candidate**, not published or
usable for the blocked profile. Do not reset the agreed clock or conflate npm readiness
with all-platform Desktop delivery.

### Explicit limitations to carry into release notes unless genuinely closed

- Adapter20/22 unit support is not public caller/schema22 or real-server readiness.
- SDK feasibility/inert dispatch is not an actual normal-auth model turn.
- Zero-plugin success is not eligibility for a selected plugin/bridge/managed profile.
- Directory/history custody is not completed public retirement, wake or recovery.
- Source/provider gates are not actual worker/capture/learning/private-aweb proof.
- A packaged CLI/Pi path is not complete Desktop/platform behavior or rollout parity.

Every open item retains its existing refusal and owner. This checklist changes no
runtime semantics, metadata, release automation, live state or production authority.
