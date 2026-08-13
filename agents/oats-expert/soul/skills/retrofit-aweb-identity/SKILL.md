---
name: retrofit-aweb-identity
description: >-
  Use when a live OATS instance was spawned without an aweb identity, when aweb
  setup or the spawn hook was skipped, when an instance has a broken `undefined`
  aw workspace, or when aweb awakenings require replaying the oats-aweb spawn
  hook and updating instance metadata.
---

# Retrofitting aweb identity onto a live instance

Use the capability spawn hook, not plain `aw init`, when an already-spawned
OATS instance needs aweb identity added after the fact. The hook runs the
invite/join flow expected by the OATS aweb integration.

## Procedure

From the target instance home, replay the hook with the kernel env contract:

```bash
OATS_EVENT=spawn OATS_INSTANCE=<instance-name> OATS_HOME="$PWD" \
OATS_WORKSPACE=<workspace-root> OATS_TEAM_SCOPE=<workspace-root> \
OATS_TEAM_ID='<team>:<namespace>' \
node <oats-pkg>/capabilities/oats-aweb/bin/oats-aweb.mjs spawn
```

Then persist the identity metadata in the target instance's `instance.json`:

```json
{
  "capabilityMeta": {
    "oats.aweb": {
      "team": "<team>:<namespace>",
      "alias": "<instance-name>"
    }
  }
}
```

Restart the pi session or run `/reload` before expecting aweb channel
awakenings to fire.

## Gotchas

- Running the hook without the env contract can still appear to succeed while
  minting an identity with alias `undefined`. Clean that with
  `aw workspace delete undefined` from the instance home, remove `.aw/`, then
  rerun the hook with the env set.
- Plain `aw init` is the wrong recovery path when `.aw/` is absent: it asks
  for hosted onboarding (`--username`) instead of doing the OATS invite/join
  flow.
- If `capabilityMeta["oats.aweb"]` is not written to `instance.json`, the
  retire hook cannot self-delete the identity cleanly.
