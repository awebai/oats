## Added

- **One list of this computer's deployments, `~/.oats/config/deployments.json`,
  and `oats deployments`** to read and change it
  ([#1390](https://github.com/awebai/oats/issues/1390);
  [This computer's deployments](../workspaces.md#this-computers-deployments)).
  The clients read it to offer the deployments that are not open. It holds
  this computer's deployments only; other machines stay in the server
  registry.
  - **`oats deployments [list] [--json]`** shows each deployment's path, its
    state (`ok`, `missing`, `not-a-deployment` or `unreadable`, from
    existence checks only) and how it was listed. `add [<dir>]` lists the
    deployment at or above `<dir>`; `remove <path>` takes a row off the list
    and touches nothing on disk; `import --from desktop <path>...` is the
    Desktop's one-time import of its own lists. The JSON is in the
    [Desktop CLI API](../desktop-cli-api.md#this-computers-deployments-oats-deployments),
    under the feature `deployments-list`.
  - **The list fills itself.** `oats onboard` lists what it creates (`listed`
    in its result; a failed add never fails the onboard). Any kernel command
    run in a deployment that is not listed yet (`status`, `spawn`, `sync`,
    `doctor` and the others that read a deployment) lists it, silently; once
    listed, a command reads the list without a lock and writes nothing. A
    command routed with `--server` lists nothing.
  - **A removed deployment stays removed.** Nothing automatic lists a path
    `oats deployments remove` took out; `oats deployments add` or
    `oats onboard` brings it back.
  - **`~/Agents` is imported once.** The first command that touches the list
    lists the deployments directly inside `~/Agents` (at most 200 entries, no
    link followed) and records that it did. Nothing reads `~/Agents` again.
  - **Four new codes:** `E_DEPLOYMENTS_INVALID`, `E_DEPLOYMENTS_VERSION`,
    `E_DEPLOYMENTS_BUSY` and `E_DEPLOYMENTS_WRITE`, each saying what to do.
