---
name: oats-portable
description: >-
  Use when operating a newly prepared captured OATS instance, invoking an exact
  retained command or provider operation, inspecting its immutable composition,
  creating an explicit fresh scaffold, or starting its captured native session.
  Triggers: "captured OATS",
  "portable soul", "resolution ID", "exact retained command", "fresh captured
  spawn". Do not use for legacy config-chain deployments.
---

# Operating a captured OATS instance

A captured instance executes one immutable managed composition identified by an
explicit deployment and resolution. Its source soul, adopter alias, capability
artifacts, settings, provider bindings, curriculum, helpers, and executable
resources come from that record—not from the current checkout or config chain.
Credentials, provider readiness, memberships, knowledge contents, the work target,
and host tools remain separately checked mutable inputs.

## Authority checklist

1. Read `instance.json.executionBinding` for the exact deployment and resolution.
2. Pass both selectors together. Never infer either from cwd, a source path, a
   package lock, an OS user, or another instance.
3. If the record, retained resource, approval, binding, or host requirement is
   missing or invalid, stop. Do not retry through an unqualified legacy command.
4. Treat `responsibleHuman: null` only as explicit messaging-disabled state. It
   is not an anonymous human or a private-team identity.

## Implemented commands

```bash
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --json
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --composition --json
oats <namespace> <command> --deployment <absolute-deployment> --resolution <sha256-id> -- [provider-args]
oats operation run <knowledge|messaging|tasks>:<name> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  [--home <absolute-instance-home>] [--arg name=value ...] --json
```

For capability helpers, inspect the source's captured helper map and resolve one
exact key before selecting a helper record:

```bash
oats inspect --deployment <source-deployment> --resolution <source-id> \
  --helper <exact-map-key> --composition --json
```

Keep `sourceExecutionBinding` for provider completion commands and the returned
`executionBinding` for the helper. Do not complete through a worker's inherited
selector or use legacy helper-name discovery. Helper inspection is not worker
launch; use the staged public start below and retain its actual dispatch result.

A fresh captured directory scaffold is available only with explicit placement
and no launch:

```bash
oats spawn <captured-subject> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  --home <absolute-new-home> --no-launch --json
```

The subject must match the retained soul alias or helper name. The home must be
new and its parent physical. This command materializes retained instructions and
skills, creates owned directory work, and runs captured spawn hooks. It does not
select a work repository, launch a model, or infer a team.

## Start the owned captured home

After the explicit scaffold/hooks stage, start using the same retained authority:

```bash
oats session start --deployment <absolute-deployment> --resolution <sha256-id> \
  --home <owned-home> --request <absolute-native-request-json> --json
```

The native request is a closed object, for example:

```json
{"schemaVersion":1,"backend":{"backend":"tmux","binary":"/absolute/tmux","socket":"/absolute/socket","session":"captured"},"task":"Explicit task"}
```

For Herdr, replace only `backend` with
`{"backend":"herdr","binary":"/absolute/herdr","socket":"/absolute/herdr.sock","protocol":20}`.
Use an explicit existing operator-managed socket; this route never starts a
Herdr daemon or falls back to tmux. Actual workspace/pane/terminal IDs arrive in
the receipt after allocation, never from caller naming. API discovery advertises
`oats.captured-session@2` with both backends and `readiness:not-checked`.

Runtime/model/yolo come from the capture, never this request. Optional
`stopGraceMs` is bounded 1–300000. No env/io/credential/provider/config fields.
For an already scaffolded helper, pass the SOURCE selectors and add
`--helper <exact-map-key>`; the home must match the returned dedicated helper
binding. This revalidates the edge, not just a helper name.

Use `session restart` for a distinct restart request in the same incarnation.
Once stored, task/backend can be omitted to use owned values. Use
`--retry-intent <saved-executionId>` only for an explicit replay/retry of that
same logical request. An unknown Herdr allocation must remain held under its
saved intent; never repeat workspace creation or guess its IDs from a label.
Preserve `error.details.nativeCustody` and the indexed
pending identity on uncertainty; never allocate another home/ID to disguise it.
`dispatchAccepted` means native dispatch, not task completion/model health or
privacy. A completed receipt replay may return `replayed:true` instead.

## Current refusal boundary

Captured wake/retire, unqualified managed runtime packages/contributions, extra
native arguments, non-directory work targets and backends other than tmux/Herdr
still refuse. Do not strip selectors or call legacy forms as a workaround. A scaffold marked `spawn-failed-cleanup-required`
may contain external hook effects; preserve it and escalate rather than deleting
it. A scaffold marked `spawned-launch-pending` is not a running instance.

Use **oats-soul-setup** for preparation and context choices. Use
**oats-portable-artifacts** for exact approval and retained A/B diagnostics.
