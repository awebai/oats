---
type: Lesson
title: aw grant commands resolve the identity from cwd only
description: In aw 1.36.1 every `aw id grant` command refuses an external identity home (root --identity-home flag or AWEB_IDENTITY_HOME), so a hook that mints or revokes grants must run from the custody directory with that variable stripped from the child environment.
tags: [aweb, identity, grants, hooks, testing]
timestamp: 2026-09-24
---

`cli/go/cmd/aw/identity_home_policy.go` keeps a positive allowlist of commands that may run against an external identity home. `aw mail`, `aw chat`, `aw whoami`, `aw wake *`, `aw workspace delete` and a few `aw id team` verbs are on it; `aw id grant mint|revoke|list|show` are not. Both the root flag and the environment variable count as external, so a spawn hook that passes either fails with "not yet identity-home-aware" before anything is minted.

Consequences for a grant-serving messaging hook:

- Run mint and revoke with cwd set to the custody directory and no identity-home flag.
- Remove `AWEB_IDENTITY_HOME` from the child environment explicitly; the hook may itself be running inside an instance whose launch environment set it.
- The instance's own messaging still works from the grant home through the environment variable, because those commands are allowlisted.

A fake `aw` that accepts the flag hides this; the live rehearsal against the released CLI is what found it. Model the refusal in the fake once it is known.
