## Changed

- **The setup expert puts a project that lives only on the person's computer on GitHub, on their yes.** OATS reads a workspace's members over Git, so `/oats-setup-expert` step 3 now first handles a folder that is not its own repository with a GitHub remote, a folder inside another repository included. Before asking, it finds what would be pushed without changing the folder:
  - for a new repository, the files Git would take, without dependency and build folders or files too large for GitHub;
  - for a repository with commits, its current branch and its history.

  It checks for secrets by name and content, and shows the person the files, what it leaves out, and whether the project's own automations would start. It then proposes a private repository under their GitHub login, named after the folder. A new repository is created with the secrets left out and the staged files checked against what was shown. A repository with a secret in its history is not pushed: the person chooses a fresh copy or keeping it local. On a no it creates nothing and says the agents can't work on that project until its code is on GitHub. A newcomer test run found the setup expert improvising this step ([awebai/oats#1665](https://github.com/awebai/oats/issues/1665)).
