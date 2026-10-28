## Changed

- **Every session start and restart now holds the home's lifecycle claim, so it can no longer race a retire.** `oats session start`, `oats session restart` and a scheduled start take the claim that a retire, a stop, an upgrade and a resume already hold, for the whole start. A restart holds one claim from before its stop to after its launch, so no retire runs between the two. Before this, a start could begin beside a retire and leave a session running in a home being removed. New answers, each given before anything is stopped or started:
  - A start or restart beside a retire answers `E_INSTANCE_RETIRING`. Beside a stop or an upgrade it answers `E_LIFECYCLE_BUSY`, with `details.holder` and `details.action`.
  - A retire, a stop apply or an upgrade apply that arrives while a start runs answers `E_LIFECYCLE_BUSY` with a new value, `details.action: "start"`.
  - A scheduled start refused this way is recorded as a skip. It holds no launch slot and is retried at the job's next due minute.

  Two starts of one home still answer `E_SESSION_START_BUSY`, and a resume beside a resume still answers `E_LIFECYCLE_BUSY`. A client gates on the new feature probe, `lifecycle-claim-start`. A kernel without it reads a `start` holder as a retire, so its stop or upgrade beside a new start answers `E_INSTANCE_RETIRING`, still before any effect ([awebai/oats#1602](https://github.com/awebai/oats/issues/1602); [Commands that meet on one home](../desktop-cli-api.md#lifecycle-pairs)).
