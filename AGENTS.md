# Working in the OATS repository

This repository is the OATS kernel and CLI (`lib/`, `bin/oats.mjs`), the pi
adapter and the Desktop (`packages/`), the `oats.framework` package
(`oats-package/`), and the reference docs (`docs/`). The map is in
[docs/implementation.md](docs/implementation.md).

## Rules

- **The kernel stays runtime-neutral and dependency-free.** Nothing in `lib/`
  depends on a harness or a provider; provider behaviour belongs in a
  capability.
- **Contracts are breaking for every deployment.** A change to a config key,
  a manifest field, the hook environment, a JSON answer the Desktop reads or
  the lock format needs a maintainer decision first. Grep for consumers
  (`packages/pi`, `packages/desktop`, the capabilities) before changing an
  export or a JSON shape.
- **Never weaken trust or integrity checks** (package integrity, the lock,
  path containment) without an explicit decision.
- **Behaviour and docs change together.** An operator-visible change updates
  the reference page in `docs/` that owns the rule, and the release notes.
- **Tests pin behaviour.** A behaviour change changes its test in the same
  commit. Never weaken an assertion to make a change pass.
- The package mirrors in `mirrors/` (`mirrors/oats-okf*` and the other
  official packages' capabilities) are generated from their own repositories;
  never edit them by hand. They stay out of `capabilities/`: member discovery
  would list them as this repository's own capabilities, beside their packages.
  `capabilities/` holds only this repository's own capabilities.

## Gates

Locally, run the suites your change affects plus `npm run validate` and
`npm run check`; run `npm run smoke:tarball` when you change the smoke script
or packaging. Pull-request CI runs the full suite (sharded), `pack:check` and
the smoke test, and is the gate.
