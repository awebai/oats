---
type: Playbook
title: Publish an official capability payload and move its catalog pin in the right order
description: The bundled copy, the mirror repository tag, and the catalog pin must agree, and the tests enforce it from two sides.
timestamp: 2026-09-05
---

An official capability lives twice: bundled under capabilities/<name> in the
kernel repository, and as `oats-package/capabilities/<name>` in its mirror
repository (awebai/oats-aweb, awebai/oats-okf), where a tag vX.Y.Z is the
published payload. package-catalog.json pins the tag the kernel installs.

Order. First get the bundled change reviewed and ACKed by the payload's
owning reviewer. Stage the mirror: replace the capability directory with the
reviewed commit's tree (`git archive <sha> capabilities/<name>`), prove every
file byte-identical (`git show <sha>:<path> | cmp`), bump
oats-package/oats-package.json (version, compatibility floor), refresh the
mirror's manifest schema from docs/capability-manifest.schema.json when the
manifest uses newer keys, and run the mirror's validator. Tag and push the
mirror. Only then move the catalog pin in the kernel tree, and do it in the
same tree as the manifest version bump: the test "bundled capabilities carry
the versions package-catalog.json pins" requires the two to agree, and the
install test fetches the pinned tag, so the pin cannot move before the tag
exists. Run test/capabilities.test.mjs in full on the pin commit.

Deployments follow separately: a scope's lock can pin an explicit selector
(catalog:<name>@vX.Y.Z), and `oats update` keeps a pinned selector by design
while `oats install` refuses to advance a lock; until the CLI grows a way to
move a pin, use the library's `updatePackage(dir, id, { spec: "<name>@vX.Y.Z" })`,
then `oats trust <name>` and `oats doctor`.
