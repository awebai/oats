/** The repositories that moved to the oats-project organisation: the old and the new spelling of each key
 *  are one repository (docs/workspaces.md "Moved repositories"). A leaf: no I/O, no imports.
 *
 *  It compares and never rewrites. A key stays as it was declared or recorded, in every answer, cache
 *  path and lock; parseRepoRef never passes through here, and neither does a URL that goes to Git. */

/** old key → new key. Exactly these seven, kept for good: old oats-local.yaml, locks and homes name them. */
const MOVED = Object.assign(Object.create(null), {
  "github.com/awebai/oats": "github.com/oats-project/oats",
  "github.com/awebai/oats-okf": "github.com/oats-project/oats-okf",
  "github.com/awebai/oats-engineering": "github.com/oats-project/oats-engineering",
  "github.com/awebai/oats-cloning": "github.com/oats-project/oats-cloning",
  "github.com/awebai/oats-authoring": "github.com/oats-project/oats-authoring",
  "github.com/awebai/oats-omarchy": "github.com/oats-project/oats-omarchy",
  "github.com/awebai/oats-knowledge": "github.com/oats-project/oats-knowledge",
});

/** The key a repository has now: the new key of a moved one, any other value as it came. */
export const currentRepoKey = (key) => MOVED[key] ?? key;
/** Whether two keys name one repository: they are the same, or one is the other's move. */
export const sameRepo = (a, b) => a === b || currentRepoKey(a) === currentRepoKey(b);
