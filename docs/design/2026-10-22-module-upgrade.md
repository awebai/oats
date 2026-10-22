# Upgrading an existing home's package modules (#1450)

Status: decided 2026-10-22 (Pepe, option (b) on #1450, with the five conditions of the lane:release view). This supersedes workspace model v2 items 10–11 **for package modules only**: "a package pin being bumped affects only new spawns" and "the refresh is a new spawn, never an in-place recompose". The soul body still stays at its spawn commit. Member modules still change only through a respawn.

## Why

A home keeps the modules it was spawned with, and `oats session restart` starts that copy again. So a provider fix never reaches a live seat short of a respawn.

On 2026-10-22 a seat spawned on oats.aweb 1.17.1 was restarted. Its renewal revoked the old grant without re-registering the wake broker, a bug fixed in 1.17.3. Mail stopped arriving, and readiness, which also ran from the frozen 1.17.1 copy, stayed green. Respawning a long-lived coordinator to pick up a fix is not an acceptable remedy.

## The act

```
oats instance upgrade <instance> --plan [--json]
oats instance upgrade <instance> --plan-revision <rev> --idempotency-key <key> [--json]
oats instance upgrade <instance> --undo --plan [--json]
oats instance upgrade <instance> --undo --plan-revision <rev> --idempotency-key <key> [--json]
```

It runs from the deployment, or from a parent's home, with the same instance resolution as `oats retire`.

**What moves.** Every recorded module whose `from.kind` is `package` and whose recorded commit differs from the deployment lock's commit for that package moves to the locked package version. That is exactly the set that `driftOf` reports as "package moved since".
- Modules move whole: copy, skills, inject and hooks together (condition 1).
- A module of a package the lock no longer holds is not moved. The plan lists it as `kept: package no longer locked`.
- Member modules and the soul body are never moved. The plan lists member drift as information.

**Preconditions (all checked at plan and again at apply, under the instance's lifecycle claim):**
- **The session is stopped.** If it is running, or its state can't be read, the act refuses with `E_SESSION_RUNNING` and the remedy `oats instance stop <instance>`, then upgrade, then `oats session start`. Nothing changes under a running harness.
- **No retire or other lifecycle act is in flight.** Use the existing claim.
- **The lock's package commit and integrity verify,** just as at spawn (`moduleSource`).

## Plan (condition 3)

The plan is read-only. It returns:
- a revision, sha256 over the facts, the same `planRevision` pattern as stop and retire;
- per moving module: `{capability, from:{version,commit,digest}, to:{version,commit,integrity}, skills:{added,removed,changed}, inject:changed?, hooks:changed?, provider:{decision, reason}}`;
- kept modules, with the reason;
- member drift, for information.

The plan writes nothing into the home, because the retire baseline compares home bytes. Like stop and retire plans, it touches nothing there. It stages the new copies in a temporary directory outside the home (`mkdtemp` under the OS temp dir) and removes that directory when it finishes.

**Provider adoption (condition 2).** For each moving module, the kernel needs to know whether the *new* version can take over the state the old version laid out. The kernel never guesses.
- **New lifecycle event `upgrade`.** It is approved in `lib/capability-contract.mjs` and `docs/capability-manifest.schema.json`. It must not be `required`. The kernel runs it from the **staged new copy**, with the usual `lifecycleHookEnv` plus:
  - `OATS_UPGRADE_PHASE=plan|apply`;
  - `OATS_META` (the recorded `capabilityMeta[cap]`, i.e. the old version's state);
  - `OATS_UPGRADE_FROM` (JSON: the recorded `from`, commit, digest);
  - `OATS_UPGRADE_TO` (JSON: the locked entry).
- **In `plan`** the hook is read-only and prints one of:
  - `{"adopt": true}`;
  - `{"adopt": false, "reason": "...", "remedy": "..."}`, for example naming the respawn.
- **In `apply`** it may change only provider state inside the home or provider-owned host registrations. One example is oats.aweb re-registering the wake broker against the recorded `grant.home`. It prints `{meta, warning?}` and exits 0, or exits non-zero to refuse.
- **Rules:**
  - A moving module with recorded `capabilityMeta`, or one declaring `spawn` or `launch` hooks, must declare `upgrade`. Otherwise its plan decision is `refuse: <cap> does not declare an upgrade hook; respawn the instance to change it`.
  - A module with neither (skills/inject only) is adopted without a hook.
  - One refusing module refuses the whole upgrade. There are no partial upgrades.
- **Older kernels.** An older kernel already treats an unknown non-required event as a warning (`capability-contract.mjs:52`), so a provider can declare `upgrade` before every host has the new kernel.

## Apply

Apply runs under the claim, with the plan revision re-checked. A stale plan refuses with `E_PLAN_STALE` and attaches a fresh plan. Apply is idempotent per `--idempotency-key`, with a receipt like retire's, and does the following in order:

1. **Stage.** Stage the new module copies in `<home>/.oats/.staging-upgrade-<receipt>`, on the same filesystem so the renames are atomic, and recompose the derived files there. Use the **same code as spawn**: refactor `materialize()` so that composing a home from a resolution can target an existing home. Do not write a second composer. The derived files are:
   - `.agents/skills`;
   - `AGENTS.md`: the soul body at the **recorded soul commit**, the kernel blocks, then each module's inject. If the soul body at that commit can't be read, refuse;
   - in `instance.json`: `modules`, `capabilities[]`, `capabilityRuntime[]` (the absolute hook commands that retire runs), `skills[]`, `instructions[]`, `composition`, `launch.hooks.contributions`, `resolutionRevision`.
2. **Keep the previous state.** This happens before anything outside staging changes. Copy `.oats/modules/<cap>` for each moving module, and the current `instance.json` and `AGENTS.md`, to `<home>/.oats/previous/<receipt>/` with `copyTreeSafe`, then verify the copy. This is not the retirement recovery root, so it is not mistaken for a retained retire.
3. **Provider hooks.** Run each moving module's `upgrade` hook (`apply`) from the staged copy, in the plan's module order. Hooks must be idempotent in `apply`, because a retry runs them again.
4. **Swap.** Swap in place using materialize's rollback journal. Each moved module gets `modules.<cap>.previous = {from, commit, digest, materializedAt, receipt}` (one level, the latest move). `capabilityMeta[cap]` becomes the hook's `meta`.
5. **Baseline.** Re-take the retire baseline through `writeRetirementBaseline`, so a later retire sees no "changed instance-home bytes" because of the move.
6. **Event.** Append the instance event `modules-upgraded` with `{receipt, modules:[{capability, from, to}]}`. The new kind goes in `instance-events.mjs`, in `docs/desktop-cli-api.md`, and as a Desktop label in `packages/desktop/renderer/instance-events-data.mjs` (the Desktop owner ACKs that line).

**When a step fails.** The rule is set by whether any provider hook's `apply` has succeeded yet. A hook can change host state (oats.aweb's wake re-register, for example), and restoring old modules under host state the new version adopted is the same mismatch #1450 is about.
- **No hook has succeeded yet** (failure in steps 1–2, or in the first hook): roll back fully. Discard the staging and `<home>/.oats/previous/<receipt>`, change nothing in the home, and record a refusal event that names the step or module.
- **A hook has succeeded:** the act only finishes forward. The receipt records `partial` with the steps and modules already done. The error names what is pending, and says to retry with the same `--idempotency-key`. That retry re-runs only what is pending and finishes the swap, baseline and event. A partial act never restores the old modules. If the act can't be finished, the remedy named is a respawn. The home is never put back by hand under adopted host state.
- **The session start** refuses while a `partial` receipt for the home exists (`E_UPGRADE_PARTIAL`, naming the retry).

**`--undo`** plans and applies the reverse move to `modules.<cap>.previous`, with the same steps and hooks; it is the `upgrade` hook of the version being restored. It works only for the latest move, and only while `<home>/.oats/previous/<receipt>` exists and verifies. The same adoption rule applies, so undo works only toward a version that declares `upgrade`. A move from a version without the hook, such as the motivating oats.aweb 1.17.1, cannot be undone through the act: its `.oats/previous/<receipt>` stays for inspection by hand, and the remedy for a bad move is a respawn.

**Lifetime of `.oats/previous/`.** Each home keeps one previous state, which the next move replaces. Retire carries it in its recovery copy like any other home content.

## Restart and start (condition 4)

- `oats session start` and `oats session restart` never move modules.
- When a home has package drift, both print one line after the start, and the JSON gets `drift:[{capability, recorded, locked}]`: `<n> package module(s) behind the lock (<cap> <recorded> → <locked>); to move them: oats instance stop <i>; oats instance upgrade <i> --plan`.
- No flag on restart runs the upgrade.

## Kernel stays runtime-neutral (condition 5)

The kernel knows modules, hooks, plans and receipts only. Anything aweb-specific lives in the provider's `upgrade` hook, such as grant-home adoption, the wake re-register, or refusing a 1.17.x meta shape it cannot adopt.

## Surfaces

- **CLI:** `oats instance upgrade` with help text, in `bin/oats.mjs`.
- **Docs:**
  - `docs/souls-and-instances.md:200` and `docs/first-team.md:166`: the invariant now reads "a running instance never changes under itself; a stopped one can be moved to the locked package versions with `oats instance upgrade`".
  - `docs/desktop-cli-api.md`: the command, the event, `modules.<cap>.previous`, the start/restart `drift`.
  - `docs/upgrading.md`: the deploy step after a package bump.
  - The oats-operate skill.
  - A release note.
- **`oats status`:** no change. Drift clears by itself after a move.
- **Desktop:** `modules.<cap>.previous` is a new field in JSON the Desktop reads. The implementation PR names lane:lfx as that reader and includes a test that the Desktop tolerates the field.

## Out of scope

- Member modules and the soul body (still a respawn).
- Remote homes (`--server`).
- Moving several homes in one call (a deploy loops over instances).
- Desktop UI beyond the event label.
- Automatic upgrades.
- oats.aweb's `upgrade` hook, which is a separate provider spec and PR and ships after this kernel release with a kernel floor.

## Acceptance

- Real-fixture tests:
  - a stopped home on an older package version moves to the locked one. Afterwards its skills, AGENTS.md inject, hook commands, `modules` and `previous` match a fresh spawn on the locked version, apart from identity and timestamps;
  - a running home refuses;
  - a provider refusal changes nothing;
  - a stale plan refuses;
  - an idempotency replay works;
  - `--undo` restores the previous bytes;
  - retire after a move sees no unexplained home change.
- A live check on a scratch seat, after the provider's hook ships: a global-grant session seat spawned on an old oats.aweb is upgraded and restarted, then a signed mail is presented in the resumed session.
