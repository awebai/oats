# #916 sleep/wake leg (macOS): a scratch launchd job, `ai.oats.schedule-tick-916sw-*`, runs #916's tick on a scratch deployment in `/private/tmp/oats-916-*`.
1. `./prepare.sh` (needs npm's registry) builds OATS at 81b6e536 there, loads the scratch job, waits for two on-schedule ticks and prints `ready; sleep the Mac for at least 5 minutes now`.
2. Sleep the Mac for at least 5 minutes, then wake it.
3. `./check.sh` waits up to 4 min for runs after the wake, prints PASS or FAIL with its evidence (kept in `/private/tmp/oats916-evidence-*.json`) and runs `./cleanup.sh`.
If a step stops halfway: `./cleanup.sh /private/tmp/oats-916-XXXXXX`. Nothing touches `~/.oats` or the real `ai.oats.schedule-tick`.
