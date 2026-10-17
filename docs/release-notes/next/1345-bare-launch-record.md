## Fixed

- A `session start|restart` that selects the bare harness from a home
  recorded with a named configuration (for example `--launch-config none
  --harness codex` on a home started with a claude configuration) now records
  `launchConfig: null` everywhere. The launch itself, `instance.json` and the
  command's answer already said so. But the session's `launched` event and the
  restart receipt (`.oats-restart.json` `next.launchConfig`) named the earlier
  configuration. So did the `launched` event an adoption records for a start
  whose metadata write failed. Each now takes the name from the recipe the
  start launched, its pending receipt's for an adoption. Only a receipt
  without a recipe still falls back to the recorded one. Selection is
  unchanged: `--launch-config none` is the bare harness, as
  [launch configurations](../configuration.md#launch-configurations) say.
  This is the kernel half of #1345. The provider's delivery for the selected
  harness is tracked separately.
