---
type: Decision
title: Deployment config over package forks (evolved)
description: Deployment targeting and settings belong in scoped oats-config.yaml; reusable behavior belongs in capability packages rather than deployment-specific forks.
tags: [architecture, workspaces, capabilities]
timestamp: 2026-07-11
---

The original unpublished decision placed workspace customization in
`.agents/workspace.yaml` rather than forked packages. The first
capability-package contract preserves the boundary while replacing that file:

- reusable skills, instructions, commands, and hooks belong in a capability
  package;
- deployment-specific acquisition, target groups, bindings, settings,
  exclusions, and unconditional instructions belong in scoped
  `oats-config.yaml`; and
- neither package manifests nor portable souls record deployment names.

Consequently a package remains reusable across many workspaces, while each
workspace is self-describing without forking framework or package code. See
[oats-config](/architecture/oats-config.md) and [capability
packages](/decisions/capability-packages.md).
