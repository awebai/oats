## Added

- **A retire plan says as a fact whether `work/` is the instance's own tree
  (#988).** `facts.ownWorktree` in `oats retire --plan --json`, and in the
  fresh plan of an `E_PLAN_STALE` and an `E_CHILDREN_RUNNING` refusal, is a
  boolean: `true` exactly when `work/` is the instance's own work tree, the
  one the retire retains or removes. It is the answer of the reading the
  retire acts on. `facts.workMode` is the record's value, which the
  instance can write, and `facts.work` is an observation through any link,
  so neither says it: a link or a directory of the home under a record that
  says `worktree`, and an attached instance over a tree on another branch,
  have `false`. `defaults.retainWorktree` is unchanged and follows the fact
  today; it is the default of an option, not the place to learn what
  `work/` is. Feature word `retire-plan-own-worktree`: without it the key
  is absent and says nothing. A stop plan does not carry it. The plan's
  revision, notes and text, and the receipt, are unchanged. See [the retire
  plan](../desktop-cli-api.md#retire).
