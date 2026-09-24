---
type: Reference
title: aweb grants are bound to the custody identity's active team
description: aw id grant mint has no team flag; the server binds the grant to the minting identity's alias on its currently selected team, so a serving hook must verify the returned team_id against the intended team and revoke on mismatch.
tags: [aweb, identity, grants, messaging]
timestamp: 2026-09-23
---

Verified in the aweb source (server `routes/identity_grants.py`, CLI `cmd/aw/id_grant.go`, `awconfig/grant_home.go`):

- Mint: `aw --identity-home <custody>/.aw id grant mint --scope <list> --ttl <60s..720h> --label <text> --out <dir> --json`; JSON fields `grant_id, expires_at, team_id, alias?, address?, out`. Scopes are exactly `mail.read mail.send chat.read chat.send`.
- The grant is bound to the identity's alias on the team selected in the custody home. There is no team flag. A hook that serves a resident identity for a given team must compare `team_id` with the intended team and revoke plus fail on mismatch.
- A grant home is `grant.yaml` plus the grant signing key, no `identity.yaml`; the client resolves it through `AWEB_IDENTITY_HOME`; grant subcommands refuse to run from a grant home (root authority required).
- Two live grants for one subject are allowed; grants carry no fencing.
