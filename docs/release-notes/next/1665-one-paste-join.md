## Changed

- **Joining an existing workspace takes one paste.** With oats.aweb 1.36.0 or later and aw 1.36.53 or later, the getting-started skill has the joiner paste only the invite token: `oats aweb setup --soul S --invite-stdin --name A` reads the team and the service from the invite and refuses one that doesn't fit before redeeming it. The teammate no longer passes a service URL. Older versions keep the labelled form with `--join` and `--service` ([awebai/oats-aweb#56](https://github.com/awebai/oats-aweb/issues/56)).
