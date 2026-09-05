---
type: Lesson
title: A remote roster merged into the panel snapshot silently widens the local file guard
description: Desktop's /api/file allowlist is built from every instance home in snapshot.byWs, so merging host-supplied remote panels into that snapshot turned remote path strings into readable local roots.
tags: [desktop, security, remote, path-guard, review]
timestamp: 2026-09-05
---

`fileRoots()` in `packages/desktop/server/oats-web.mjs` builds the allowlist
for `/api/file` from two sources: every workspace's agents roots, and every
instance home in `snapshot.byWs` (`admit(i.home)`, `admit(join(i.home,
"work"))`, `admit(i.repo)`). The second source was safe only because of an
unstated invariant: those homes were enumerated by the server itself from
directories it had walked.

The Desktop remote projection (941a23d, b73918f) broke that invariant without
touching `fileRoots()`. `mergeRemotePanels()` put remote panels, whose
`instances[].home` are strings the execution host's `oats server roster
--json` supplied over SSH, into the same `snapshot.byWs`. Every such string
was handed to `realpathSync`, and any that resolved on the local machine
became an allowed read root.

Two consequences, in increasing severity:

- Benign collision. A laptop and a build box with the same user and repo
  layout (the normal OATS deployment) have colliding instance home paths. A
  local tree outside every registered workspace becomes readable because a
  different machine has an instance homing at that path.
- Host-controlled read. A roster entry claiming `home: "/"` admits `/`, and
  `underRoot` then matches every path on the machine. The remote host, or
  anything that can shape its roster output, chooses what the local Desktop
  serves.

The trap is that neither half looks wrong on its own. `remote-roster.mjs`
opens with "Never reads remote paths locally" and is telling the truth about
itself. The guard is equally careful about TOCTOU and pre-canonicalized
roots. The defect lives in the seam, where a data structure grew a second
producer with a different trust level. When a shared snapshot gains a new
producer, audit its consumers, not only its shape: the reviewer checklist
asked "is any remote path used as a local one", and the answer was no at
every site the diff touched.

Demonstrated at tip b73918f: a fake CLI whose roster advertises a local
directory outside every workspace as a home makes `GET /api/file` answer 200
with a file from it. Fix direction (unreviewed): skip `i.server` entries in
the `fileRoots()` instance loop, so only locally enumerated homes are admitted.
