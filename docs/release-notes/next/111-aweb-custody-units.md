## Upgrade

- **Existing resident custody units: after updating to oats.aweb 1.27.1, run
  `oats aweb resident create <name>` again from the deployment**, with the same
  `--root` if one was used. An existing unit changes only on that rerun; an
  OATS upgrade or seat restart alone does not refresh it. OATS 0.53.0 supplies
  the kernel-selected Node path; supported older kernels retain the previous
  fallback. If the recorded `aw` path lives inside a Node version that will
  be removed, install aw in the new version and rerun before removing the old
  one. See [the provider's upgrade steps](https://github.com/awebai/oats-aweb/blob/v1.27.1/docs/resident-create.md#after-changing-node-or-aw).

## Provider updates

- **oats.aweb 1.27.1** fixes resident custody-unit conflicts and Node paths
  ([#111](https://github.com/awebai/oats-aweb/issues/111),
  [#112](https://github.com/awebai/oats-aweb/issues/112)). `resident create`
  refuses recognised same-root units under another label before writing and
  names the unit and platform retirement steps. Running-custody errors name a
  recognised foreign unit when found, or tell the operator to stop the outside
  supervisor. Discovery remains `ai.aweb.custody.<namespace>.<resident-name>`;
  the command never adopts or removes a foreign unit.
  The unit PATH uses the kernel's absolute `OATS_NODE_BIN` (available from
  OATS 0.53.0), keeping the previous fallback on older supported kernels.
  After updating the provider, rerun `oats aweb resident create <name>` from
  the deployment, with the original `--root` if used, to refresh an existing
  unit. The selected absolute `aw` path still needs reinstalling and refreshing
  if it lives inside a Node version that will be removed.
  OATS >=0.52.0 and aw >=1.36.33 remain the floors. The catalog, reference
  workspace and generated mirror take the same published tag.
