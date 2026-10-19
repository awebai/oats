## Provider updates

- **oats.framework 1.13.4: oats.setup 2.8.3.** Text only: its floor
  (`compatibility.oats`) does not change.
  - **Straight pushes to a repository only the person can push to.** The
    briefing's rule for shared files was "only by pull request".
    `/oats-workspace-config`'s "Change a shared file" now has two routes. A
    commit goes straight to a repository's default branch, the workspace's
    host or a member repository alike, only when checks right before the
    push show that the person alone can push to it and nothing guards the
    branch:
    - they are its admin and its only collaborator with push access; for an
      organization's repository, an active member and its only owner;
    - no deploy key can write;
    - no branch protection or ruleset guards the default branch (a plan
      without rulesets counts as unguarded).

    For the host, the setup expert then pushes and tells them what changed.
    For a member repository, it first shows them the commit and says that
    the push runs that repository's push-triggered CI and deploys, and it
    pushes only on their yes. Otherwise the change is a pull request, and a
    refused push never takes another route. The briefing,
    `/oats-setup-expert`, `/oats-package-pins`, `/oats-teams`,
    `/oats-automations` and `/oats-setup-model` follow it. It matches the
    setup soul that the `oats-getting-started` skill writes for a new
    workspace ([#1314](https://github.com/awebai/oats/issues/1314)).
  - **`/oats-setup-model` on a capture setup that failed after
    publication.** When the setup summary says that publication may have
    occurred but durability was not established, inspect the named target
    and stage before rerunning, and keep that evidence. A sync or close
    failure after the rename does not mean that the old file was restored
    ([#1340](https://github.com/awebai/oats/issues/1340)).
