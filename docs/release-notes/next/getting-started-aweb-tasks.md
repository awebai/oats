## Getting started

- **New workspaces get aweb tasks.** The getting-started skill's workspace
  file pins `oats.aweb` at v1.31.0 or later and sets
  `defaults.tasks: { oats.aweb-tasks: { from: package } }` when the
  workspace has messaging, so agents assign, claim and hand off work as aweb
  tasks. A workspace on Jira or Linear writes that provider instead. An
  existing workspace opts in as [integrations.md](../integrations.md#official-providers)
  describes.
