## Upgrade

- **`oats server connect` needs `--dir`, inside a deployment too**
  ([#1390](https://github.com/awebai/oats/issues/1390);
  [Connect a machine](../servers.md#connect-a-machine)). The folder on the
  host no longer defaults to `~/Agents/<this deployment's directory name>`:
  only you know where the deployment goes there. A script that ran `connect`
  without it now gets `E_BAD_ARGS` "--dir <path on the host> is required:
  the folder on `<host>` for this deployment (absolute, or ~/… resolved
  there)" before anything runs; add `--dir`. `--workspace-ref` still
  defaults from the deployment, and existing registrations are unchanged.

## Changed

- **`oats deployments add` walks up to a regular `oats-local.yaml` only**
  ([#1397](https://github.com/awebai/oats/issues/1397);
  [This computer's deployments](../workspaces.md#this-computers-deployments)).
  A directory or a link of that name is passed over, as a client passes it
  over when it admits a deployment, instead of being listed and then shown
  as `not-a-deployment`.
