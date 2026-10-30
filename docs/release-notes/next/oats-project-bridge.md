## Upgrade

- **Nobody uninstalls `@awebai/oats`.** OATS is moving to the `oats-project` organisation in stages, and this release is the bridge. Nothing asks you to change a string, and a deployment that changes none behaves as before. Homes and the host's schedule unit record the kernel's real path, so `npm rm -g @awebai/oats` strands them all ([The move to the oats-project organisation](../upgrading.md#the-move-to-the-oats-project-organisation)).

## Added

- **The old and the new spelling of a moved repository are one repository.** Seven repositories moved, and wherever the kernel compares two keys it now treats both spellings as the same repository: the backlink, `clones:`, a clone's remotes, a home's recorded soul and modules, `from:`, a `git:` package source and a server's `workspaceKey`. It compares and never rewrites: every key stays as declared or recorded, in each JSON answer, cache directory and lock ([Moved repositories](../workspaces.md#moved-repositories)).
- **`oats version --json` has a `package` field**, the npm name this kernel was installed under. `name` stays `@awebai/oats` under either name, because released readers refuse any other value.
- **The kernel knows its own npm name.** `oats update`, `oats server connect` and the pi bridge use the name the kernel was installed under, so an update never crosses from one name to the other. Clients and the pi bridge accept `@awebai/oats` and `@oats-project/oats`.

## Changed

- **`E_SOUL_UNKNOWN` names the members it could not confirm:** how many, each key with its reason and detail, and what to do. `details` gains `unconfirmed`, only when there are any.
- **`E_CLONE_MISMATCH` gives the fix** for a Git repository with the wrong remotes: the `git remote` command to run, and that a second remote passes too.
