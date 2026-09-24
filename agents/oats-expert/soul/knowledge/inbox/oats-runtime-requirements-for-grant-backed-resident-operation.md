---
type: Reference
title: OATS runtime requirements for grant-backed resident operation
description: The sixteen things a grant-served OATS instance must be able to do, with the live 2026-09-24 rehearsal status of each, sent to the aweb side as input to the full grant contract after Juan required that global identities on grants operate as normal agents.
tags: [oats, aweb, identity, grants, requirements]
timestamp: 2026-09-24
---

For the grant-fixes worker's gap matrix (Juan's directive: global identities run through grants must operate as normal agents). Everything below is what an OATS instance does today with a LOCAL identity, plus what the recorded design (bookshelf 2026-08-12, OATS definition 2026-08-15 consequences 3 and 10) promises. Items marked LIVE were observed in the 2026-09-24 rehearsal on aw 1.36.1.

## Lifecycle (spawn hook on the host, custody outside every instance)
1. Mint from an explicitly named custody home (flag or env), not cwd only. LIVE gap: aweb-abiz.
2. Mint for a chosen TEAM of a multi-team resident (`--team <id>`); today the custody home's active team decides silently. OATS deployments serve one resident on several teams (oss/cloud labels), and the hook must verify the returned team_id. No flag exists.
3. Several live grants for one subject (one per instance; OATS runs several instances per principal, consequence 10). Server allows it today; keep it and make it explicit; grant-keyed ephemeral state (presence, heartbeats, wake registrations) must not collide across grants of one subject.
4. Revoke idempotent and verifiable (`show`), timeouts distinguishable from failures. LIVE ok.
5. Renewal without root keys in the home: standing instances run for days; 720h max TTL is fine for the mint, but there must be a sanctioned re-mint/rotation path on restart (OATS has a `launch` lifecycle event on the host where the hook can re-mint) and a defined behaviour for expiry during a session: the instance must be told (whoami shows grant_expires_at: LIVE ok) and open streams must end with a clear error, not silence.

## Operating as the resident (everything through AWEB_IDENTITY_HOME = grant home)
6. Mail: send, reply, inbox, show, ack; same team, cross-team address (`ns/alias`), and federated recipients. LIVE: inbox ok; send fixed for same service by 41574333; federated unsupported (aweb-abjc).
7. Chat: send, send-and-wait, send-and-leave, pending, open, history, extend-wait. send-and-wait and events need grant-authenticated streams (aweb-abjb).
8. Wake and channels: the wake broker stream, the pi extension and the Claude channel plugin all open the identity's event stream; all must authenticate with the grant. LIVE: `aw wake register` accepts a grant home and goes active; stream auth is aweb-abjb.
9. Presence and liveness: whoami, check --online, heartbeat; keyed by grant per the design so a retired instance's presence expires with its grant.
10. Coordination surfaces the aweb-coordination skill uses today from an instance: aw work ready/active/blocked, aw task create/claim/update/close/comment, aw claim-human, session leases, role-name, workspace status. Either the scope vocabulary covers them (the design names `tasks.claim`) or a "normal agent" scope bundle exists; the OATS hook needs a documented default set that equals what a local member can do, minus custody administration.
11. Roster and addressing: aw id team members / team list as the resident (roster discovery), contacts, address resolution for did:aw and ns/alias.
12. Encryption: an instance must READ E2E mail addressed to the resident and SEND E2E without holding the resident's root encryption key in the home. LIVE: a grant home has no encryption state (warning "E2E decryption unavailable"). This is a key-custody design question (delegated or derived encryption key bound to the grant, or custody-side unwrap); "fails closed" is the correct interim, not the target.

## Verification and attribution
13. Recipients must verify a grant-sent message as the resident, as they verify any global identity (the design's explicit promise). Today plaintext grant mail is subject-attributed but UNSIGNED, so every recipient's verification posture (the aweb-messaging skill's "unverified sender: caution" rule) downgrades grant-served agents to second class. Needed: a delegation proof recipients can check without the home server: root-signed (session pubkey, scope, expiry) plus session signature over the message; that is the design's federation stage, and it is what makes 6 and 13 hold across servers too.
14. Server-side provenance: messages, claims and presence record subject AND grant_id (which instance served) as private provenance; aweb-abjd.

## Boundaries that must stay
15. From a grant home: no mint, no revoke of other grants, no team join/leave/switch, no key rotation, no invite creation, no identity deletion, no redelegation. LIVE ok (grant subcommands refuse a grant home).
16. Scope is per grant and enforced per request (LIVE ok); a narrower grant (read-only reviewer) must remain possible.

## Acceptance I will run on the rig (0.25.x kernel, oats.aweb 1.12, test resident, reviewed binary via PATH prefix only)
Same-team send + reply + inbox + ack; cross-team send to oats.aweb.ai; chat send-and-leave and send-and-wait; wake broker delivering an inbound mail into a launched pi session; whoami/check/heartbeat; a task claim attributed to the resident if scopes allow; E2E receive if 12 is done; expiry handling with a 60s TTL grant; two concurrent instances on one resident; retire = revoke, deprovision at the end.
