---
type: Lesson
title: Fake aw tests must model real refusal paths
description: A fake CLI that accepts flags or environment the real aw refuses can hide broken lifecycle hooks until live rehearsal.
tags:
  - oats-aweb
  - testing
  - fake-cli
timestamp: 2026-09-23
---

# Fake aw tests must model real refusal paths

When testing oats.aweb hooks with a fake `aw`, the fake must model the real CLI's refusal paths, not just successful answers. In the 1.12 grant work, the fake initially accepted `aw --identity-home <custody>/.aw id grant ...` and `AWEB_IDENTITY_HOME=<custody>/.aw`, but aw 1.36.1 refuses external identity-home selection for `aw id grant` commands. Unit tests passed while the live rehearsal failed.

For lifecycle hooks, fake commands should enforce the same policy boundary as the real binary version they model, including rejected flags/env and output shape. Otherwise the tests verify an impossible integration path.
