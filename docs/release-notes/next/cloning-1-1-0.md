## Provider updates

- **oats.cloning 1.1.0: cloners are background instances.** The catalog and
  this workspace pin oats.cloning `v1.1.0`, from 1.0.1. The `cloner` soul says
  `background: true`, so the Desktop and `oats tui` list a new cloner under
  their Background section (oats-cloning#6, awebai/oats#1579). The clone
  itself is placed as its own soul says.
- **Upgrade:** 1.1.0 requires **OATS >=0.69.2** (was >=0.34.0): an older
  kernel drops the soul, so `oats cloning request` refuses with
  `E_SOUL_UNKNOWN`. Upgrade OATS first, then `oats sync`.
