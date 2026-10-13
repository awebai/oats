## Provider updates

- **oats.framework 1.9.4: oats.core 2.5.3, oats.setup 2.5.2.** One change to
  oats.core's hook script and instruction text in three oats.setup skills; no
  schema or provider contract changes, and the capability floors are
  unchanged (oats.core `>=0.40.0`, oats.setup `>=0.30.0`).
  - oats.core's hook writes into a Claude Code home's waiting hooks the node
    the kernel hands it (`OATS_NODE_BIN`, from OATS 0.53.0), a path that
    survives a Node upgrade. Under an older kernel, which does not set the
    variable, it writes its own process's node as before
    ([#997](https://github.com/awebai/oats/issues/997)).
  - `oats-automations` and `oats-onboarding` (oats.setup): installing the host
    timer is the operator's step, as the entry above says
    ([#967](https://github.com/awebai/oats/issues/967)); `oats-onboarding`
    names oats.okf 5.0.3.
  - `oats-workspace-config` (oats.setup) says that from OATS 0.53.0
    `souls.launch` is written by `oats soul launch set` and
    `oats soul launch remove`
    ([#990](https://github.com/awebai/oats/issues/990)), and lists
    `E_LAUNCH_PREFERENCE_UNKNOWN`, `E_LAUNCH_PREFERENCE_UNMATCHED`
    ([#989](https://github.com/awebai/oats/issues/989),
    [#1049](https://github.com/awebai/oats/issues/1049)) and `E_LOCAL_BUSY`
    with `E_LOCAL_CHANGED`
    ([#998](https://github.com/awebai/oats/issues/998)), each with its remedy.
    The remedies of `E_HARNESS_UNAVAILABLE` and `E_LAUNCH_CONFIG_UNKNOWN` now
    name `oats soul launch set`, from OATS 0.53.0; on an older kernel the
    remedy is still to edit `souls.launch` in `oats-local.yaml`.
