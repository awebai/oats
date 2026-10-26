## Added

- **`oats.machine` is an official package** at `v0.1.1`
  ([official catalog](../official-catalog.md)). It brings a steward for one
  computer, `oats.machine/steward`, and a technician that handles one machine
  problem at a time; both use the `oats.machine-care` capability, which the
  catalog aliases to the package. A workspace pins it as
  `oats.machine: v0.1.1`.

## Changed

- **`oats-getting-started` sets up a machine's steward with a global
  address** when its prompt hands it a machine found-list (a found-list with
  `machine.platform` set, as oats-omarchy's installer writes):
  - Step 1 asks, once and with defaults, for the namespace (the machine's
    hostname, normalised) and the steward's name (`steward`). Enter accepts
    both. No question comes after that round.
  - The new workspace is the machine's own. It pins `oats.machine`, and its
    setup soul is `oats.machine/steward`; no `<workspace>-oats-setup-expert`
    soul is written.
  - Once messaging is set up, the agent creates the steward's resident with
    `oats aweb resident create <name> --team-label <label>`: first with
    `--plan`, then for real. It runs with no `AWEB_API_KEY`, using the team
    root that signup made. The agent then spawns the steward with the grant-seat
    options the provider prints. The steward's address is contacts-only:
    `<namespace>/<name>`.
  - With oats.aweb below 1.33.0, aw below 1.36.48, a machine that joined an
    existing workspace by invite, or a plan that does not take the root route,
    the steward gets a local team identity instead. The person is told so in
    one line, with no question asked.
