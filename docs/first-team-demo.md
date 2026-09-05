# First-team example: OATS working on OATS

On 2026-09-05 we installed the published OATS artifacts and used Pi and
Claude Code workers to fix issues found during a fresh review. The first
team's work was release preparation in this repository.

## The setup

| Component | Qualified value |
| --- | --- |
| Kernel and Pi adapter | 0.22.0, installed from npm |
| Workspace config | `oats.dev` 1.0.0 default, adopted at the common workspace root |
| Knowledge | `oats.okf` 1.4.1 |
| Messaging | `oats.aweb` 1.8.0, bound to our existing team |
| Authoring | `oats.authoring` 1.0.0 |
| Worker scope | The child OATS Git repository, selected explicitly |
| Harvester runtime/model | Pi, `openai-codex/gpt-5.5`, configured for this machine |

Package acquisition used the published kernel's catalog and exact locks.
The executable OKF and aweb capabilities were explicitly trusted.
`oats doctor` passed. A separate published-authoring probe confirmed that
`integration-authoring`, `skill-craft`, and `soul-craft` materialized for an
authoring soul.

## Two useful tasks

The **Pi documentation worker**, `docs-expert-readme-claims`, corrected a
claim that all captured conversations were signed. Native transcript turns
have content hashes; signed aweb messages preserve their original
signatures. Its code-review handoff led to the
[documentation correction](https://github.com/awebai/oats/commit/ef4a1a6599da88e213b2a6a8f3918099aa5ba984).

The **Claude Code worker**, `cli-dev-lock-fix`, fixed a stream-lock race.
A late contender could classify a live holder's lock as stale and enter the
same critical section. The fix uses holder liveness and an ownership token;
review also caught an acquisition loop that could retry filesystem errors
forever. See the [initial fix](https://github.com/awebai/oats/commit/1036381)
and [review correction](https://github.com/awebai/oats/commit/81735f6e936d1b6aa0a3ad62d12953d494851cc8).

Both workers used isolated worktrees, committed changes, and reported
through aw. Review happened before integration. Claude needed its initial
folder-trust and development-channels confirmations; Pi started directly.

## What carried forward

Each worker invoked OKF harvest. Its temporary harvester promoted a lesson
into the source soul and committed it on the worker's branch:

- [Content-addressed turn IDs do not authenticate native capture](https://github.com/awebai/oats/commit/91993a0b85db132c59c32d43ee2c90ec5569bd50).
- [Lock ownership and the limits of comparing timeout thresholds](https://github.com/awebai/oats/commit/120e3474b93efc0d37f94c426327f802e27893ea).

These are reviewed, inspectable knowledge changes. They demonstrate a
working promotion path; they do not by themselves measure a productivity
improvement.

## What the run exposed

The run found first-use problems that unit tests alone had not resolved:

- A fresh scope needed `mkdir -p agents` before `oats create`; the fix is in
  the 0.22.1 changes.
- The default harvester model assumed a provider absent on this machine.
  The workspace now selects an authenticated model explicitly.
- Retiring an aweb identity could leave a remote alias behind. Temporary
  harvesters are excluded from messaging in this deployment; remote cleanup
  is tracked separately from local retirement.
- A combined workspace roster did not make the workspace a spawn scope for
  every child repository. Commands select the owning repository explicitly.

The [first-team guide](first-team.md) includes these setup details. The
package owners are responsible for improving their defaults; the kernel
continues to resolve capabilities through the same replaceable contracts.
