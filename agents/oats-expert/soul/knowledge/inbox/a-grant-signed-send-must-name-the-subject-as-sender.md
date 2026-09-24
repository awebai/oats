---
type: Lesson
title: A grant-signed send must name the subject as sender
description: aw 1.36.1 grant clients derive their DID from the grant session key and put it in from_did, while the server resolves a grant to its subject identity and accepts only the subject's DIDs, so every mail or chat send through a grant is rejected with 422 until the client sends the subject's DID.
tags: [aweb, identity, grants, messaging, bug]
timestamp: 2026-09-24
---

Observed in a live rehearsal: a freshly minted grant home answers `aw whoami` and reads its inbox, but `aw mail send` and `aw chat send-and-leave` fail with HTTP 422 "from_did must match the authenticated sender".

Cause, from source: `cli/go/awid/client.go` `NewWithGrant` sets the client DID to the grant session key's did:key; `cli/go/awid/mail.go` sends that as `from_did`. Server side, `identity_grant_auth.py` resolves the grant to the subject identity and `routes/messages.py` requires `from_did` to be one of the subject's DIDs. The grant home already records the subject's did:key and did:aw, so the fix belongs in the client: present the subject as sender while signing with the session key. Attribution to the resident identity is the design intent, so mapping the grant key to the subject server-side would be the weaker fix.

Coverage gap that let it ship: the server's grant tests stub the message routes and the CLI's grant test checks only the mint wire body; no test sends a message under a grant.

Verification order for a grant-serving messaging hook: mint, whoami, inbox, then a send and a reply from another identity, then revoke. Reads passing say nothing about sends.
