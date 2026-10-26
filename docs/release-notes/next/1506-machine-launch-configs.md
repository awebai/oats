## Added

- This machine's launch configurations: `~/.oats/config/launch-configs.yaml`
  (`$OATS_HOME_DIR/config/` when set) declares launch configurations for every
  deployment on the machine. Its one key is `launch-configs:`, with the
  deployment block's schema. A deployment entry with the same name replaces
  the machine's whole and lists the machine file in `shadows`. A deployment's
  `default: true` for a harness wins over the machine's. With no deployment
  in reach, the machine's entries alone apply. A relative `executable`
  resolves against `~/.oats/config`. The person or an installer writes the
  file; `oats launch-config set|remove` keep writing only `oats-local.yaml`.
  See [This machine's launch configurations](../configuration.md#this-machines-launch-configurations).
- `oats launch-config list` gives each entry's `source` and `shadows`, and its
  text marks machine entries. `oats spawn --preview` names the machine file
  when it supplied the configuration. `oats doctor` reports the file, and its
  `--json` carries `machineLaunchConfigs` (`file`, `present`, `ok`,
  `configurations`, `error`).

## Upgrade

- A broken machine file (unreadable, not YAML, empty, another top-level key,
  an invalid entry) refuses every launch that reads launch configurations,
  with `E_LAUNCH_CONFIG_INVALID` naming the file. A missing file changes
  nothing.
