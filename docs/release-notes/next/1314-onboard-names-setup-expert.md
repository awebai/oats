## Upgrade

- **OATS 0.61.0: `oats onboard`'s `next.spawn` can name a soul other than
  `oats-operator-expert`** ([#1314](https://github.com/awebai/oats/issues/1314)).
  Before OATS 0.61.0 it named `oats-operator-expert` whenever a soul had that
  name, and only then; from OATS 0.61.0 it names the soul that holds
  `oats.setup`, the workspace's setup expert, so a workspace without this
  project's soul is pointed at its own. The JSON shape is unchanged
  (`onboardApi` 2, text or `null`). A script that matched the old exact name
  sees a different answer: a soul named `oats-operator-expert` that does not
  declare `oats.setup` now gives `null`.

## Changed

- **OATS 0.61.0: `oats onboard` names the workspace's OATS setup expert**
  ([#1314](https://github.com/awebai/oats/issues/1314)). Its last next step,
  and `next.spawn` in `--json`, name the soul called
  `<workspace name>-oats-setup-expert`, else the first soul by name whose own
  `soul.yaml` declares `oats.setup` (from any source; `off` does not count),
  else none, when the text suggests adding that conventional soul. Only the
  soul's own declaration is read: `oats.setup` given only through workspace
  defaults is not seen. A standalone view has no workspace name, so only
  the declaration counts there. `oats help` describes the step the same way
  ([the rule](../desktop-cli-api.md#oats-onboard-onboardapi-2)).
