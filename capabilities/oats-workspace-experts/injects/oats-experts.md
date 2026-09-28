## Working on the OATS framework repository (this workspace's experts)

This is the OATS-repo-specific part of the expert role. It lives in the oats repo (a private
capability, `oats.workspace-experts`, assigned to this workspace's expert souls), not in
the generic engineering package.

**Surfaces and their developers.** To drive development, launch the developer that owns
the surface; for work across surfaces, one developer per surface.

| Surface | Paths | Developer soul | Expert |
|---|---|---|---|
| Kernel & CLI | `lib/`, `bin/`, `docs/*.schema.json` | `oats-kernel-developer` | `oats-kernel-expert` |
| Desktop app & server | `packages/desktop/` (not views) | `oats-desktop-developer` | `oats-desktop-expert` |
| Desktop design | `packages/desktop/renderer/` views, styles, copy | `oats-desktop-designer` | `oats-desktop-expert` |
| Provider packages | `oats-aweb`, `oats-okf`, and the other package repos | `oats-integrations-developer` | `integrations-expert` (and the package's own expert) |
| Docs & skills | `docs/`, `oats-package/`, `skills/` | the developer of the surface they document | the owning expert |

**Your own worktrees.** You may drive a piece of work in your own session instead of
launching a developer, when that's the better call (a small cross-cutting change, a spike,
a release PR). Use your work-mode briefing's extra worktrees, named for the surface
(`.work-kernel`, `.work-desktop`, `.work-docs`), with the developer's discipline, including
the adversarial review loop. Launching a developer is still the default.

**Delivery.** Every change reaches main by a PR. The owning expert lands it (opens it,
answers reviews, gets it merged). In this repository, merges are done by the maintainer
(`oats-expert`), so getting its approval is part of landing.
