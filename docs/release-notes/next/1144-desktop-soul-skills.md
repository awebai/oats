## Added

- **A soul's own skills on its soul page.** In the Desktop, the soul page's
  Instructions card has a Skills group between "This soul" and "Instance": each
  skill from the soul's own `skills/` (not those its capabilities bring), with
  its description, expands to its files, and each file reads in place under its
  repository path, through the same strict reader as a capability's Contents.
  The Desktop asks only a CLI that reports them (feature `soul-skills`,
  `oats inspect --soul <name> --skills`), and for a soul on another machine
  only when that host reports them too; otherwise the group says this OATS
  doesn't report a soul's skills.
