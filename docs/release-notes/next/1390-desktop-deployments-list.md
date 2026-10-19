## Changed

- **The Desktop's switcher lists this computer's deployments from the
  kernel's list,** `oats deployments`
  ([#1390](https://github.com/awebai/oats/issues/1390)), and no longer looks
  inside `~/Agents`.
  - **Under "On this computer"** a window with no workspace shows the
    deployments on that list that are not open, beside the saved ones.
  - **A row that can't be opened says why:** missing (the folder is gone, or
    its volume isn't mounted), not a deployment any more, or can't be checked.
  - **Remove** beside a row takes it off the list, and off the Desktop's saved
    workspaces when it is one. Nothing on disk changes. From the keyboard:
    Right Arrow, then Enter.
  - **Every deployment the Desktop opens is listed:** an add, an onboarding,
    and the deployment it was launched on. A failure is a notification, and
    the deployment stays open.
  - **Once, at the first launch,** the Desktop moves its own list of recently
    added workspaces and its saved workspaces onto the list, then renames
    `workspace-recents.json` to `workspace-recents.imported.json`. It reads
    recents for nothing else.
  - **With an older oats,** which has no such list, the switcher shows the
    saved workspaces and says "This oats can't list this computer's
    deployments. Update oats." See [OATS Desktop](../desktop.md#opening-a-workspace).
