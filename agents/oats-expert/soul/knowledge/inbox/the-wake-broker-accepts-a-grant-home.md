---
type: Reference
title: The wake broker accepts a grant home
description: aw wake register --identity-home pointing at a grant home (grant.yaml plus grant signing key, no identity.yaml) registers and goes active once the instance is launched, so session delivery works for grant-served instances.
tags: [aweb, wake-broker, grants, messaging]
timestamp: 2026-09-24
---

Verified live on aw 1.36.1 with a launched pi instance: the spawn hook registered the home with `--identity-home <home>/.aweb-identity --delivery session`; `aw wake status` showed the home first as `phase=pending` (before the runtime existed) and `phase=active` after the first inspect, with the grant home as its identity home. `aw wake deregister` at retire removed the row.

The registration is durable even when the broker daemon is down, so a hook never fails because the broker is restarting; a non-zero exit means refused (missing delivery flag, relative path, unreadable identity home).
