# A GLOBAL resident in an existing hosted team

Use this card after `/oats-onboarding` selects fresh versus retained GLOBAL,
authorized owner, R, resident name, team credential authority, service/registry,
scopes/TTL and receive policy. That intake authorizes routine selected steps;
do not ask again for each command. Missing required facts are named blockers.
Worker messaging authority alone does not authorize provisioning or custody.

The native [hosted GLOBAL bootstrap contract](https://github.com/awebai/aweb/blob/4e477ad74dabf5a944898e9d6f3f6d169c7f5ff6/docs/hosted-global-bootstrap.md)
owns CLI authority, init, outputs, diagnostics and recovery. It is published at
native source revision `4e477ad74dabf5a944898e9d6f3f6d169c7f5ff6`. Source landing
does not establish a package release or installation: its HTTP diagnostics and
representative recovery/capture fixtures are not aw 1.36.23 behavior or coverage.
The checkpoints below use the pinned sources listed at the end; they are OATS
integration requirements, not a second native contract.

## Card and supported versions

| Stage | Context, command and writes | Success / one next step | Error or unavailable evidence → remedy |
|---|---|---|---|
| Fresh bootstrap | Selected aw 1.36.24; init syntax also present in the pinned 1.36.23 contract below. Owner-selected empty R and protected team credential. `aw init --global --name <resident> --aweb-url <selected-service> --awid-registry <selected-registry> --do-not-touch-agents-md --json` in R. Writes GLOBAL identity, AWID/hosted state and workspace. | Validate connected/global/canonical team and identity fields below. Next: resident diagnostics. | Nonzero or malformed success → retain private streams/exit and reconcile same context; no automatic retry/remint. |
| Reuse | Existing retained R, same authority; skip init. aw 1.36.24: `aw --identity-home R/.aw doctor identity --offline --json`, then `aw --identity-home R/.aw doctor registry --online --json`. Read-only. | Required identity/registry checks pass; skipped/missing is not success. Next: custody checkpoint. | External `doctor local` is not allowlisted in 1.36.24: `command "aw doctor local" is not yet identity-home-aware; refusing to use an external identity home ...` → native owner supplies missing required local-category evidence; these two categories do not cover it silently. |
| Custody | Owner-selected host/user and retained R; aw 1.36.24 `aw --identity-home R/.aw custody serve`, then `aw --identity-home R/.aw custody status --json` in another owner terminal. Serve is a long-running signing service; status is read-only. | Required socket/team/signing/E2E checks below pass. Next: host configuration of `residents.<resident> = R`. | `custody preflight failed for <resident>: status=<state>; custody service is not running; start aw custody serve for <resident>` or required check absent/false → owner repairs the selected service; no worker daemon startup or identity replacement. |
| Grant seat | Released provider 1.21.1 consumes configured resident; approved scopes/TTL and kernel preview/apply via `/oats-onboarding`, not a manual native grant mint. Writes scoped worker grant and captured locators. | Successful scaffold, intended grant/home/team/scopes and custody attachment. Next: start and receive verification in `/oats-aweb` §4. | `grant_expired`, `grant_revoked`, `grant_subject_inactive`, `grant_issuer_revoked`, `grant_freshness_unavailable` → stop worker messaging; owner uses the already-authorized supported lifecycle, not in-seat repair. |

Fresh bootstrap proceeds to the same diagnostic commands as reuse. The native
external-home allowlist correction is version-qualified to aw 1.36.24 source
`32fe2d795780a8ba90260c631d84f5d5c6fc0190`; a global help flag is not admission proof.
Provider #58's planned registration wrapper is unavailable here; until service
manager integration its contract is one onboarding command plus one printed host
step, not daemon autostart. No command for that future wrapper is invented.
LOCAL minting-root or `spawn-authority` diagnostics are never a GLOBAL launch gate.

## Choose the journey and fix the context

- **New GLOBAL resident:** native `aw init --global` with the selected existing
  team's provisioning key creates the identity and connected workspace. It can
  affect both AWID and the hosted service before the client reports success.
- **Reuse a resident:** validate the selected retained identity and custody under
  its owner. Do not run init, replace it, copy its keys, or choose another identity
  to make setup pass. Existing-global team join attaches an existing identity;
  it does not create the new resident described in the first branch.
- **LOCAL deployment root:** ordinary provider setup can initialize a separate
  local minting root. It is neither fresh GLOBAL creation nor resident reuse.

Before dispatch, record the selected native executable/version, provider commit
and captured module/version, installed kernel version, authorized operator,
existing-team credential authority, resident name, service and registry URLs,
host/user, working directories and intended destinations. Use facts selected by
the owner, not ambient defaults, guessed namespaces or a worker's identity home.
An internal key-bound team UUID is **not** a canonical `name:domain` provider ID.
Canonical team and address are validated bootstrap outputs, not invented inputs.

| Authority/location | Purpose and boundary |
| --- | --- |
| Existing-team provisioning credential | Authorizes the selected native bootstrap; not a resident root key, worker grant or namespace controller. A separately scoped LOCAL credential is not interchangeable with it. |
| Resident parent, e.g. `/absolute/residents/<resident>` | Fresh native cwd or explicitly selected reuse parent. Native material lives in its `.aw`; `settings.oats.aweb.residents.<resident>` points to the **parent**. |
| Resident `.aw` | Root signing and E2E custody. Root-only inspection and grant management belong here under the resident's owner. |
| Separate LOCAL root parent | Optional deployment minting authority for local workers; `root`/`roots` point here, not to the GLOBAL resident or worker. |
| Worker grant home | Provider-created scoped session credentials, with their own session signing key. The worker is resident-root-key-free, **not keyless**. |
| Namespace controller | Separate authority; neither an existing team key nor a grant confers namespace control. This journey does not require creating another team or querying a controller to guess the address. |

Prepare an isolated child environment for each selected authority. Prevent
ambient `AWEB_IDENTITY_HOME`, unrelated authentication and dotenv/context state
from redirecting the operation. Never dump the environment. Keep credentials and
raw output out of argv, shell history, shared logs, mail and PRs.

## Establish diagnostic capture before effects

Before dispatch, the reviewed operator procedure must arrange restricted private
retention of raw stdout, stderr and exit independently of success parsing. If
capture is unavailable, do not dispatch. Nonzero, malformed-success,
timeout/interruption and post-dispatch capture failure stop subsequent stages.
Sanitize outward reports to the operation and actually supplied category/status/
request ID; no raw response, secret, environment dump or invented correlation.
Record measured times for future attempts, not inferred historical durations.
These are procedure requirements; this provider does not implement a universal
protected wrapper. The native contract owns the detailed diagnostic controls.

## Fresh creation, then validation

For the selected **fresh** resident parent, use the fresh-bootstrap command in
the card above. Run the selected `aw` executable with cwd equal to the intended
resident parent.
The authorized operator supplies the selected team key as `AWEB_API_KEY` only in
the protected isolated child environment. No literal key assignment belongs in
this template. No canonical team/address, `--byod`, new account, namespace query
or workspace-team primitive is needed for this existing-team branch.

A completed identity or retained partial is **not a fresh destination**. Do not
silently overwrite it, initialize elsewhere, or substitute another resident.
Use the failure/reconciliation rules below for partial state. Reuse starts with
validation of the retained resident instead of the creation command.

At the pinned native source, JSON suppresses default agent-document injection
and post-init addons; `--do-not-touch-agents-md` makes the custody intent explicit.
Custody is not the worker instruction directory. Do not add docs/channel/hooks
setup switches to imitate worker composition; OATS supplies the worker's modules
and briefing separately. Init still writes identity/workspace state and can
record machine bookkeeping; JSON is not a dry run.

Validate the retained result against the selected authority before progressing:

| Evidence | Required interpretation |
| --- | --- |
| Final native JSON | `status: connected`, `identity_scope: global`, nonempty returned `team_id`, `alias`, `aweb_url`, `stable_id`, `address`; reconcile service with the selected service and returned membership with the authorized existing team. A UUID must not be substituted for `team_id`. These fields do not by themselves establish custody or E2E delivery. |
| Native bootstrap validation | The client validates certificate/team, generated key/DID, `custody: self`, global scope, stable identity/address and credential presence. Response `did`, `team_cert`, `custody` and `api_key` are internal bootstrap fields, **not all final JSON keys**. Use the native contract for their full validation rules; never expose credentials. |
| Selected resident local state | Confirm self-custodial global identity, key/DID and certificate/team consistency using scoped identity/local diagnostics. Do not print private files or copy root material to a worker. Check the actual stored service/registry, not a default guessed from the address. |
| Local E2E publication record | `identity.e2ee.assertion_published` records local publication bookkeeping; it is not an online registry comparison. Init can report connected while warning that publication failed. |
| Authoritative online registry checks | Confirm current key/stable identity, address binding/delivery origin and `awid.did.encryption_key_matches_local` against the selected registry. Skipped, blocked, missing or mismatched checks are not success. Registry registration alone does not prove hosted allocation, credential issuance or message delivery. |

Read templates below are for the **resident root**, under its authorized owner,
with the provisioning key absent and the selected registry/service context
verified. Online reads use the intake-selected diagnostic scope:

```text
aw --identity-home <resident-parent>/.aw doctor identity --offline --json
aw --identity-home <resident-parent>/.aw doctor registry --online --json
```

For aw 1.36.24, external `doctor local` is unsupported; if its evidence is
required, report that missing native-owner prerequisite. Never clear the selected
identity home or switch to an ambient identity to bypass the guard.
`identity` is the local identity category; `registry` is the actual category for
online AWID checks. Do not invent `doctor awid`. Relevant checks include
`identity.local.signing_key_matches_did`, `identity.local.stable_id_expected`,
`awid.did.current_key_matches_local`, `awid.address.matches_local_stable_id` and
`awid.address.delivery_origin`. A diagnostic failure names the required owner
repair; it does not turn an unselected reset or replacement into an authorized
routine step.

## Separate provider configuration and resident custody

If the selected plan needs a LOCAL minting root, use its distinct authority and
explicit deployment/root scope. `oats aweb setup --soul <messaging-soul>` with an
operator-supplied API key runs **plain `aw init`** at the selected setup root;
it is not GLOBAL creation. Setup has no `--global`; `--service` stays join-only,
and `--name` is supported for join and additionally required for `--username`
with the #66 fix. Neither option configures API-key or GLOBAL initialization.
Validate the actual returned canonical
membership and local spawning authority before recording host roots/mappings.
Do not create a new team merely because the existing team's mapping is missing.

Workspace team **labels** map to canonical provider IDs. There is no supported
`settings.oats.aweb.team`. The kernel-selected default/eligible team is authoritative;
a root's current active team is not a substitute. Host-only
`settings.oats.aweb.residents` maps resident names to absolute custody parents;
`root` and `roots[<canonical-team-id>]` select separate LOCAL root parents, with
`roots[team]` taking precedence. Configure only the facts the selected plan needs.

For resident consumption, the provider reads `identity.mode: global`,
`identity.resident`, `identity.scopes` (explicit nonempty list, or the selected
`profile` defaults), `identity.ttl` (default `720h` in provider 1.23.0),
`identity.renew` (`launch` by default or explicit `off`) and `identity.e2ee` (required unless explicitly
false). Profiles are `normal` or `reviewer`; choose scopes/TTL under the owner's
least-authority decision, not by copying another worker's grant.
Do not configure shorter TTLs for customer seats. Explicit shorter durations
remain supported, using native Go duration syntax from 60s through 720h
(30 days); invalid/over-limit values refuse with `E_GRANT_TTL` before effects.
Actual launches re-mint by default, previews do not. Explicit `renew: off`
and failed renewals leave a finite grant: running beyond its expiry without a
successful re-mint can still expire. Non-expiring grants are requested upstream
in oats-aweb#80 and are not provided here. No background renewal runs, and old
homes retain their captured composition/settings until explicitly recomposed.

Assign one host/user/resident root to the selected custody service. Starting that
service is a separate authorized host operation, not a worker action. Before
minting, provider `aw custody status --json` runs from the resident **parent**
with the worker identity override removed. It requires:

- `status: running`, the selected team's `ready: true`, signing readiness and a
  usable `socket_path`;
- `certificate_present` must not be false; supplied `grant_status_endpoint_ready`
  must be true (absence is accepted by this version, not affirmative proof);
- `keys.signing_ready: true` and `sign_plain_message.v1`; by default also
  `keys.encryption_ready: true`, `unwrap_e2ee_message.v1` and
  `create_e2ee_envelope.v1`. Disabling E2E is an explicit choice with a warning,
  not a workaround for failed encrypted delivery.

GLOBAL spawn consumes this existing resident and mints into the new worker's
`.aweb-identity`. It passes the selected canonical team, scopes, TTL, label, output
and custody socket to native grant mint. It requires returned `grant_id`,
`expires_at`, `team_id`, `out`, matching output/team, and verifies recorded
`grant.yaml` socket plus grant-context custody status/socket/resident alias/team.
It captures `identity.grant.id`, `expiresAt`, `scopes` and `home`, and exports the
locator `AWEB_IDENTITY_HOME`, not resident credentials. No manual grant mint is
needed to imitate this path. Some failures after mint invoke provider revocation
and grant-home cleanup; this is not a promise of a transaction or exactly-once
mint/renewal. Preserve the actual failure outcome; do not add manual cleanup.

Grant inspection (`aw id grant show <grant-id> --json`) belongs to resident root
custody authority, not the grant home. In the worker, use scoped `aw whoami` and
only operations permitted by its grant. Do not use root-only `aw id show` or
`aw workspace status` as grant-seat health checks.

## Composition and actual acceptance

Use the selected installed kernel's supported preview and decision-bound apply,
from the intended deployment with the reviewed host settings. OATS 0.41.0 defines
`oats spawn <soul> … --preview --json`, merged settings and `settingsOrigins`,
then `--expect-decision <revision>` on the reviewed apply. Inspect the complete
resolved provider/module, team, identity, host origins, home and launch plan;
refresh a stale decision rather than bypassing it. These are templates, not
permission to compose a worker now.

Preview is preflight, not mint, custody attachment or launch success.
`--no-launch` still executes spawn hooks and can mint a grant; it is not an
observational scaffold. A successful spawn response with an incomplete launch
must not be relabelled as a running worker. Inspect its actual captured receipt
and warnings; do not use generic retries to manufacture acceptance. Kernel spawn
idempotency does not confer exactly-once semantics on native identity creation.

After the selected authorized operation, validate these distinct outcomes:

1. Captured module commit, settings/origins, resident identity and final grant
   locator/scopes/expiry/attachment match the reviewed plan.
2. The actual worker has the intended knowledge/task context and acknowledges
   its assigned work; a prepared source tree or preview is insufficient.
3. Scoped receive readiness and a harmless explicitly authorized acceptance task
   demonstrate incoming presentation, a verified reply and requester-consumed
   intake. Grant issuance, native connection configuration and `ready` alone do
   not establish these. No client-specific email-send or language policy is
   prescribed here.

## Failures, partial state and continuation

| Result | Stop and retain; do not infer |
| --- | --- |
| Nonzero exit, including hosted error | Stop subsequent stages; retain protected streams/exit and only supplied sanitized correlation fields. HTTP status alone does not identify the cause or prove rollback. |
| Exit zero but malformed/incomplete/mismatched success | Refuse advancement; retain raw evidence privately. Success parsing is not diagnostic capture. |
| Timeout/interruption or lost response | Remote outcome is unknown. Registry success does not prove hosted address/allocation/credential commit; a repeat can have further credential effects. No automatic retry. |
| Context, key, destination or authority mismatch | Stop; do not substitute credentials, parent directory, team or resident. Escalate an exact same-context reconciliation decision. |
| Capture unavailable before dispatch | Do not dispatch. If capture fails after dispatch, stop with an uncertain outcome and preserve what remains. |

Native partial resume validates saved material and context and can reuse the same
DID after ordinary failures. **Preservation is not universal:** in aw 1.36.23 a
nonempty returned DID that differs from the generated DID deliberately removes
partial material before later snapshot/persistence. The sole partial signing
material can therefore be lost. This exception is tested native behavior, not
fixed by this documentation. Logs and a public registry record are not a key
backup; no backup/copy/restore/remint workaround is prescribed.

Preserve evidence and material that actually remain. Do not retry, remint, revoke,
reset, delete, clean up or start elsewhere from status alone. A same-context
continuation needs current predecessor facts and an authorized native recovery
procedure. An uncertain outcome is a named reconciliation blocker, not a loop
or a requirement to repeat the original intake. A source/config rollback cannot restore
a deleted key or undo unknown remote effects. Any preservation-contract change
belongs to the existing identity author/reviewer before implementation.

At the pinned aw 1.36.23 source, the resume tests cover error-before-success,
**not** the exact original team-key/no-repository-origin/same-DID case where the
server commits and the response is lost. The linked native source revision adds
real-CLI/service-fixture characterization of that case and protected-capture
examples, reviewed in the native source change. This is separate source evidence;
it does not establish released or installed behavior, deployed-server idempotency
or production E2E acceptance. In particular, the representative continuation
models one identity but two credential issuances.

Any safer preservation/refusal contract remains native-owned and must account
for credential effects and explicitly address mismatch deletion. Protected
capture requirements still need validation for the selected operator procedure,
including capture failure, sensitive output, nonzero/malformed success and
interruption. This docs patch executes none of those tests and selects no
production fault injection, client retry or speculative server repair.

## Version and source anchors

This guide documents inspected contracts, not a universal current-version claim:

- Native aw 1.36.23, standalone commit
  [`61c38162596d1af9085741d70d15900ff9894257`](https://github.com/awebai/aw/tree/61c38162596d1af9085741d70d15900ff9894257):
  `cmd/aw/init.go` (API-key dispatch/JSON addons), `init_apikey.go`
  (bootstrap validation, partial context and mismatch deletion), `init_connect.go`
  (final fields/publication warning), `doctor.go` and `doctor_identity.go`
  (categories and local versus online evidence). Existing identity-domain author
  and independent reviewer matched the relevant native init files to upstream
  `b95bd1f2f0e62f8f77670a67761a1006130039b8`; no deployed-hosted equivalence follows.
- Historical provider 1.21.1 at
  [`ebf1de05174cb326c80f2e40584f4f8501b99fe3`](https://github.com/awebai/oats-aweb/tree/ebf1de05174cb326c80f2e40584f4f8501b99fe3)
  versus documentation base
  [`0a47839f01aaa96801cd0ced4fdf1b36d9312dc3`](https://github.com/awebai/oats-aweb/tree/0a47839f01aaa96801cd0ced4fdf1b36d9312dc3).
  Both label the package 1.21.1; the latter also includes unreleased PR53 readiness
  and PR54 Claude selector behavior. Their plain-setup/pre-existing-resident
  separation and `lib/grant-custody.mjs` checks are unchanged. A version label
  alone does not identify these behaviors; inspect the selected commit/module.
- Installed OATS 0.41.0 `docs/desktop-cli-api.md` preview/decision/apply contract
  (sections at lines 1464–1473 and 1572–1627 in the retained excerpt). This is
  distinct from the OATS 0.42.0 source used for other provider contract tests;
  those tests do not qualify the installed 0.41.0 runtime or a live operation.
