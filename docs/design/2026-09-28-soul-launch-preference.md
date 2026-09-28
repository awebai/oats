# Soul launch preferences: a harness and model per soul, overridable per machine

Status: **DECIDED 2026-09-28 by the human (Pepe)**: "per soul preference, but also allow the local
overrides". Target: OATS 0.30.

## Context
Workspace-model v2 (0.25.0) removed `runtime`/`model` from `soul.yaml`, and 0.26.0 made a launch
configuration "a spawn-time host choice, never a soul field", for portability (not every machine has
every harness or model). The cost: there is no way to say "this role runs on Claude Code with Opus
5.5" without passing `--launch-config` on every spawn, and the Desktop's soul pages show "No default
harness" for every soul.

## Decision
1. **A soul may declare a launch preference** in `soul.yaml`:
   ```yaml
   launch: { harness: claude, model: claude-opus-5-5 }   # harness: pi|claude|codex; model optional
   ```
   It says only *what the role should run on*: no args, env, yolo or executable (those stay host
   facts, in launch configurations). A package soul may declare one too (oats.engineering's
   `code-reviewer`: Codex with Astra).
2. **A machine may override it** in `oats-local.yaml`:
   ```yaml
   souls:
     launch:
       "*": <launch-config name>                  # every soul on this machine (optional)
       oats-expert: opus                          # a launch configuration's name, or
       oats.engineering/code-reviewer: { harness: codex, model: <model> }   # an inline preference
   ```
3. **Precedence at spawn / start / restart:** explicit flags (`--launch-config`, `--harness`,
   `--model`) → the machine's `souls.launch.<soul>` → its `souls.launch."*"` → the soul's `launch:` →
   today's host default. A launch configuration named by an override supplies its full recipe; an
   inline or soul preference supplies harness and model on top of the host's baseline for that harness.
4. **Unavailable harness:** if the chosen harness isn't installed on the machine, the spawn refuses
   with a clear error naming the source (soul / local / flag) and the fix (install it, or override in
   `oats-local.yaml`). No silent fallback to another harness.
5. **Reported everywhere a launch is shown:** `spawn --preview`, `inspect --soul` and `oats souls`
   carry the soul's declared `launch` and the effective one with its `from` (`flag` | `local` |
   `local-default` | `soul` | `host`); `instance.json` records the effective one.

## Migration (binding): the same hazard as the team model
0.29.4's `soul.yaml` schema refuses unknown keys, and members are read at their latest commit.
- The kernel accepts `launch:` and `souls.launch` in 0.30.
- **Committed souls gain `launch:` only on the flag day** (every deployment of the workspace runs
  0.30), and `oats.engineering` ships its reviewer's `launch:` in a release with `compatibility:
  oats >=0.30.0`.
- Until then, each machine sets its preferences with the local override (0.30), or with
  `--launch-config` at spawn.

## Consumers
- The **Desktop** already renders a soul's default harness and model on the soul page and the side
  panel, but it reads fields v2 souls no longer have, so it shows "No default harness". It reads the new
  `launch` (declared + effective + `from`) consumer-first, before the kernel emits it; the spawn dialog
  shows the effective choice and where it came from.
- **`oats.developer`'s** `/run-the-review-loop` compares the developer's effective model with the
  reviewer's effective one (from `spawn --preview`) and picks another model when they're the same.

## The first preferences (at the flag day)
- All expert souls in the oats repo: Claude Code, Opus 5.5.
- `oats.engineering/code-reviewer`: Codex, Astra.
(Model ids are verified against each harness when they're written, not guessed.)
