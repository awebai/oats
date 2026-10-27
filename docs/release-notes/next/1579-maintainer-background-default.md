## Changed

- **New `oats-maintainer` instances are background by default**
  ([#1579](https://github.com/awebai/oats/issues/1579)). The soul says
  `background: true`, so the Desktop and the TUI list a new maintainer under
  their Background section. `oats spawn oats-maintainer --no-background` keeps
  one in the main list. A maintainer that is already running stays where it
  is; move it with `oats instance background <instance> on`, or with **Move to
  background** in the Desktop row menu
  ([Background instances](../desktop-cli-api.md#background-instances-oats-instance-background)).
