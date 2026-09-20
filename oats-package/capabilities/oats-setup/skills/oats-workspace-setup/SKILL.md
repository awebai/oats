---
name: oats-workspace-setup
description: >-
  Use when adopting or declaring an OATS Git workspace, publishing repository
  exports/backlinks, selecting source-complete soul editions, preparing a fresh
  local deployment or guiding prepare/approve/scaffold/start. Distinguish shared
  definitions from local provider/runtime inputs and existing classic config.
  Do not invent workspace init/adopt commands or bypass an unready provider.
---

# Workspace and source-complete setup

Distilled from the existing workspace-adoption guide and accepted preparation
flow. Preparation/execution baseline: **OATS 0.24.0**; the read-only source
inspection step below requires the later merged implementation named there.
This is the `oats.setup` capability's procedure, not a new kernel setup command
or a recreation of the removed kernel setup skill. Ask before writes,
acquisition, approval, enrollment or spawning.

## 1. Agree what is shared and what remains local

A workspace is a logical role; it can share a repository with source exports or
live in a separate repository. `oats-workspace.yaml` and `oats.yaml` are distinct
contracts even when co-located. Importing a public soul or installing its package
must NOT implicitly select the publisher's workspace or enroll an adopter there.

| Git-shared declaration | Operator-local input or evidence |
| --- | --- |
| Workspace membership candidates and reviewed source import pins | Local source access and qualified repository observations |
| Repository backlink and real package/soul export paths | Checkout mappings and explicitly chosen work target |
| Capability requirements and logical knowledge interests | Provider settings, explicit store binding, private human/team choices |
| Complete instructions and skill resources | Native harness/model/auth, backend endpoint, home and durable state |
| Reviewed source revision | Exact executable approval, current readiness and deployment acceptance |

The shared workspace is not a shared live runtime. Do not commit machine paths,
credentials, private team identifiers or live locks/state into public definitions.
Preserve old configs, knowledge, identities, sessions, histories and pending jobs.
A package's classic config template is not a Git workspace definition.

## 2. Declare the workspace and real member exports

1. In the chosen workspace repository, author `oats-workspace.yaml`: intended
   members, real source imports and bounded shared defaults. Membership does not
   activate every member's capabilities or select its task provider.
2. Each member declares its reciprocal workspace backlink in root `oats.yaml`
   and advertises actual exports. A package root must contain `oats-package.json`;
   an npm root alone is not an OATS distribution. Soul exports name the complete
   source directory AND its real definition file.
3. If the workspace repository is also a member, admit it explicitly. Qualify
   matching reciprocal observations; a missing backlink, fork or stale observation
   is not membership. Do not paper over a mismatch with a local path guess.
4. Knowledge exports require an existing provider declaration/base. Empty or
   uninitialized storage is not accepted knowledge; corpus publication/visibility
   and accepted writers are separate operator/steward decisions.

Omitted membership/backlink revisions mean observing the host's actual default
branch, not guessing `main`. Observations within one preparation are frozen.
A pinned older workspace and backlinks at a newer commit may be correctly stale;
choose a fresh coherent observation, never rewrite an old retained record.

## 3. Publish source-complete soul editions before import pins

A portable edition keeps canonical `AGENTS.md` with `CLAUDE.md -> AGENTS.md`, a
complete definition, skill/resource closure and explicit required capabilities.
Do not copy a live home or fabricate a knowledge owner. Preserve an existing
edition's stable owner and read/write interests when making a transitional copy.

For a new edition, declare `requires.capabilities.oats.core` with its real reviewed
package source by default; it is visible and removable, never a hidden kernel
requirement. A setup-expert edition declares both `oats.core` and `oats.setup`.
The accepted onboarding design targets that first expert, but this resource-only
package does not implement a command that automatically creates/instantiates it.

Review and publish the complete source first. Then pin the workspace import to
its ACTUAL reviewed/published immutable revision and chosen adopter alias. An
initial `imports: []` may stage publication; it is not an adopted usable graph.
Never invent the future SHA of a commit containing its own import. A later
workspace metadata change need not advance an independently pinned source.

Official capability discovery uses the reviewed catalog in the oats repository.
New entries need actual published package revisions; discovery is not installation
or executable trust. Do not promise install-by-ID before a catalog entry exists.

## 4. Inspect source metadata, then author the preparation input

The read-only source inspector is implemented by merged PR24, framework commit
`da38e5a9646b6fc83593a0df95a70d24ed4324ec`. Use a reviewed CLI containing that
implementation (or a later release that includes it), not merely a CLI satisfying
this capability's version floor. The **original 0.24.0 release** lacks this route
and can ignore the request flag and consult ambient classic configuration.

```sh
oats inspect --request /absolute/inspection.json --json
```

Its authored inspection input uses `deployment`, `workTarget`, `source` and
`origin`, plus explicit `workspace` (and optional `member` / `catalogIndexes`)
or `standaloneContextKey`. Source can be an advertised workspace alias or the
full `{source,soul,revision,alias}` reference. Workspace/member requests carry
their own existing origins and still require matching reciprocal observations;
standalone adoption does not inherit the publisher's workspace. Do not combine
this request mode with current-context flags or captured selectors.

The result is **non-authorizing metadata**, not a preparation request or issued
fresh-mutation witness. `ok: true` may report `needs-configuration` or
`separate-deployment-required`; even `ready-for-preparation` confers no approval,
enrollment or provider readiness. Opaque provider payloads/adoption values are
omitted, and `source.reference` is not returned as reusable mutation input.
Keep the original authored inputs. Inspection owns transient repository scratch
but writes no deployment state and runs no provider codec, hook or native runtime.
It does not lock paths against later changes. Preparation retains its own
validation/custody rules.

If using the original 0.24.0 CLI, omit this unavailable inspection convenience
and use the existing explicit preparation stages below; do not invoke classic
inspection as a portable fallback or treat it as a fresh preparation witness.

Use a fresh explicit physical deployment/home where existing managed state
conflicts. Missing paths need approved operator provisioning, not automatic repair.
The work target, source, deployment and captured home/work are separate identities.
Observing a repository does not make non-directory captured placement available.

Keep the original authored request for the existing preparation entrypoint. It
may select a workspace (source and origin) plus an imported source alias after
publication, or a full `{source,soul,revision,alias}` source reference and explicit
standalone context. Use `mode: directory` for the supported captured scaffold.
Do not pass an inspection result/private scratch/workTarget wrapper as preparation
input, mix request mode with other prepare flags, or fill gaps from inherited
OATS selectors/current classic config.

The preparation request's optional `operator` object has **required** `policy`
and `document` fields, and only these **optional** fields: `localBase`,
`allowLocalPaths`, `sourceContext`, `bindings`. Software/provider/source/settings
selections belong in `operator.policy`; provider-owned values belong in the
sibling `operator.bindings`, not directly under `operator` or inside `policy`.
For example, this is an **operator fragment**, not a complete preparation request:

```json
{
  "operator": {
    "policy": {},
    "document": { "kind": "operator", "id": "local-preparation" },
    "bindings": {}
  }
}
```

Keep `policy: {}` even when no software override is needed. Fill bindings as the
selected providers require; empty bindings are not a readiness claim. `document`
identifies input provenance, not executable trust or native authorization.

For the chosen profile supply all required capabilities, exact runtime/model and
native permission intent, explicit backend endpoint, and provider-owned bindings:

- OKF 2.1.x supports logical inheritance such as `inherit: stores.oats`, mapped to
  `/bindings/knowledge/stores/oats`. An explicit ownership `destination: oats`
  uses that store; omitting destination intentionally requires `write.default`.
  Supply the actual store locator, accepted owned/read nodes, absolute host-owned
  `bindings-file` / `state-dir`, and `harvest-runtime`. Omitted `harvest-model`
  preserves native-default intent; whether the selected runtime supports it is
  a separate check. A temporary acceptance store is not production KB adoption.
- Messaging needs actual responsible-human/context/native-team inputs. If the
  intended delivery is session-based, select `settings: {delivery: session}` in
  the complete supported `operator.policy.messaging` capability/source selection;
  do not rely on its channel default. Keep host, session-ifInstalled and authoring
  requirements. The setting supplies no human delegation or private grants.
- Capture an intended helper selection in
  `helperLaunches["oats.okf:memory-harvest"]`, not legacy `souls.memory-harvest`.
  Preserve its actual resource/knowledge/messaging closure and the SOURCE edge.

Native HOME/profile/auth and deliberately selected local models remain native.
Do not copy credentials, empty profiles, enroll/trust automatically or borrow
another instance's identity. A new source editor does not become a native admin.

## 5. Use the existing explicit stages

D/R/H and ARTIFACT_SET below are returned or deliberately selected values, never
inferred from cwd. Review the exact artifacts and obtain approval before trust:

```sh
oats prepare --request /absolute/operator-preparation.json --json
# Only if required, and after operator review/authorization:
oats trust <capability-id> --deployment "$D" --artifact-set "$ARTIFACT_SET" --json
oats prepare --request /absolute/operator-preparation.json --json
oats inspect --deployment "$D" --resolution "$R" --composition --json
oats spawn <captured-subject> --deployment "$D" --resolution "$R" \
  --home "$H" --no-launch --json
oats session start --deployment "$D" --resolution "$R" --home "$H" \
  --request /absolute/approved-native-request.json --json
```

The native request carries only the supported version1 backend/task/stopGraceMs
fields. Runtime/model/permission choices come from the retained launch, not a
replacement model/env/auth field in this request. For a helper use SOURCE
selectors plus `--helper <exact-source-map-key>`. Consult **oats-operate** for
native start/custody details, **oats-packages** for exact approvals, and
**oats-config** only for deliberately classic compatibility settings.

There is no `oats workspace init` or `oats workspace adopt` in this baseline.
The read-only inspector above is a separate, version-scoped observation route;
its result and its `workTarget` / catalog wrapper are not valid substitutes for
the original complete typed preparation request. Missing inputs are not filled
from ambient config, old captured selectors or metadata-only output.

## 6. Report limits, not a false ready state

Released **oats-aweb capability 1.10.3** lacks the portable binding interface;
correct metadata alone cannot make a messaging-required pilot operational.
A codec-only candidate with an unconditional readiness refusal is not a completed
native adapter. Published **OKF 2.1.1** additionally accepts retained ordinary
Claude/Codex helper choices, including native-default model intent, with the
complete approved capability closure. Pi still requires an explicit model and
the sole-OKF helper profile; this release does not qualify enriched Pi messaging.
Never remove a required provider or silently change the runtime/model to fit a
simpler fixture.

A scaffold materializes resources and may run approved required hooks. It is not
a model session, message exchange or worker completion. Session registration or
submission is not proof the intended agent consumed a wake. Captured input/wake
and public captured retirement remain unsupported in the 0.24 captured router;
ordinary home-only endpoint observation is not captured custody qualification.
A strict-Pi print turn is not an interactive continuation. Preserve partial or
uncertain homes/receipts; no legacy fallback, replacement instance or raw repair.

Metadata/schema checks, retained preparation, native readiness, delivery, worker
judgment and accepted knowledge publication are distinct. Runtime Git knowledge
publication remains PR-only: capture/staging/a receipt is not acceptance of a PR.
A real operator-qualified primary AND SOURCE-helper path with the intended closure
is needed before reporting the deployment usable. Any corpus/roster migration or
UI rollout is a separate explicit decision, not silently part of initial setup.
