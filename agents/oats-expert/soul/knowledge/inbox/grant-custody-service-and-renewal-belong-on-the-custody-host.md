---
type: Decision
title: Grant custody service and renewal belong on the host that holds custody
description: For grant-served resident identities, a per-host custody service co-located with the custody directory (same class as the wake broker) should mint, renew, revoke and unwrap encrypted mail, and the kernel's launch lifecycle hook is the renewal point on restart; one custody host per resident, team chosen per spawn payload.
tags: [oats, aweb, identity, grants, custody, lifecycle]
timestamp: 2026-09-24
---

Position sent to the aweb side on 2026-09-24 as OATS runtime input to the grant contract. Deployment names below are placeholders for the pattern.

Agreed on the model: self-custodial resident homes with root keys outside every worker; hosting on aweb.ai is routing, not custody. Three answers, source-anchored where it matters.

## 1. Local resident custody service for E2EE receive: feasible, and it fits a shape OATS already runs

- Placement. In OATS the custody directory is a HOST fact: `oats-local.yaml settings.oats.aweb.residents.<name> = /abs/custody` on the machine where instances of that resident spawn, and the spawn hook runs on that host. So a custody service is per host, co-located with the custody directory, exactly like the wake broker today (`aw wake run`, durable state dir under the user's config, socket for live calls, registrations written straight to the state dir when the daemon is down so a hook never fails on a restarting broker). Same lifecycle, same user, same operational class; the messaging capability can declare it as a host requirement the kernel checks before spawn, and the spawn hook can probe it before minting the way it probes `aw wake`.
- Authentication and binding. The service should accept only (grant id, session-key signature over the request, message id) from a grant home whose grant it can validate: subject = this resident, scope includes mail.read, not expired, not revoked. Validation needs the server or a cached revocation view with an explicit freshness bound; if neither is available it must fail closed with a distinct error, never serve stale. Unwrap only content addressed to the resident; return per-message plaintext or a rewrapped per-message key to the session key; audit every unwrap keyed by grant id (the grant-keyed provenance the design wants).
- Plaintext boundary. Plaintext reaching the instance is today's boundary for local identities too; on a single-UID host the accepted threat model already says a same-UID process can read the grant credential. The gain is that the long-lived signing and encryption keys never leave custody and the server never decrypts.
- Renewal through the same service. Today the spawn hook runs `aw id grant mint` with cwd = custody, so the hook PROCESS reads the root signing key file. With a custody service, minting and renewing become requests to the service and the hook never touches root material; that is the cleaner separation and I would make mint/renew/revoke the service's first API, decrypt the second.
- Limits to state in the contract. One custody host per resident (instances on another machine cannot be served; each machine holds the residents it serves). Old inbox history and offline delivery are served because the resident's stable encryption key stays in custody; per-session recipient keys alone would not give that, as you say. Availability: custody down = encrypted receive unavailable, reported as such; plaintext paths unaffected.

## 2. Renewal on restart: the kernel already has the hook point

- OATS runs `launch` lifecycle hooks on every start and restart of an instance on the host, with the provider's prior meta supplied (`runLifecycleHooks("launch", { priorMeta: meta.capabilityMeta })`, lib/core.mjs ~8214), and honours `env` contributions from launch hooks (`launchEffectiveEnv`, core.mjs ~6062). So the oats.aweb launch hook can read `identity.grant.expiresAt`, re-mint when the remaining validity is below a threshold (or always on restart), revoke the superseded grant, write the new grant home, and re-emit `AWEB_IDENTITY_HOME`. Needs on the aw side: a renew or re-mint that can replace an existing grant home path (today `--out` refuses a non-empty directory) and an explicit `--team`.
- Mid-session expiry: an instance cannot renew itself (grant subcommands refuse a grant home, correctly). The contract should give a distinct, machine-readable expiry error on every surface (request, stream, channel, broker) so the instance reports and stops, and the host restarts it (OATS restart runs the launch hook, which renews). Mint TTL sized to the expected session (up to 720h) keeps this rare. Revocation during an open stream must end the stream with the same distinct error.
- One caveat to settle in the contract: meta persistence from launch hooks (the refreshed grant id must land in `instance.json.capabilityMeta` so retire revokes the CURRENT grant). I will verify the kernel path and, if it does not persist launch meta, that is a kernel ask to Pepe's lead alongside K2.

## 3. Explicit selected team: the hook already carries it; aw lacks the flag

- Kernel side (decision 23): the workspace file's `messaging.byTeam.<label>.team` is merged into the provider payload, and oats.aweb 1.12 reads `settings.team`, passes it where it can, and verifies the minted `team_id` equals it (revoke and fail on mismatch; verified live). What is missing is `aw id grant mint --team <id>`: today the custody home's active team decides, so a resident that is a member of several teams (a deployment with two team labels) can only serve one without mutating custody state, which the hook must never do. With the flag, the hook passes `--team settings.team` and keeps the verification.
- One custody per resident, several teams: `residents.<name>` stays one directory; the team comes from the spawn's payload. Two instances of one resident on two teams are two grants with different team bounds; fine under item 5 of your constraints.

## Acceptance additions I will run (rig, test resident, reviewed binary via PATH prefix)
Renewal: 60s-TTL grant, restart, new grant id in meta and old grant revoked; expiry mid-session: distinct error on send, inbox, chat wait and broker stream; multi-team: same resident minted for two team ids with `--team`, meta team verified; custody service: encrypted mail to the resident read from an instance, refused for a revoked grant, refused for a grant without mail.read, and unavailable (not stale) with the service stopped.
