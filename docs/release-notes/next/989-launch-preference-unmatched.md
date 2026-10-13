## Upgrade

- **After upgrading, run `oats doctor`: it lists each key of `souls.launch`
  that matches no soul, with the command that fixes it.** Until then a spawn
  that would fall through is refused and says the same
  (`E_LAUNCH_PREFERENCE_UNMATCHED`, under **Changed** below). This reaches
  scheduled jobs, triggers and agents' own spawns: before 0.53.0 such a key
  was never read.

  To check before upgrading: every key of `souls.launch` other than `"*"` is
  the name of a soul that `oats souls` lists, bare for a member's soul and
  `<package>/<soul>` for a package's. For a script, on 0.51.0 or 0.52.0:

  ```
  oats souls --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")).result;const p="oats-local.yaml#/souls/launch/";console.log([...new Set(r.souls.map(s=>s.launch&&s.launch.at).filter(a=>a&&a.startsWith(p)).map(a=>a.slice(p.length).replace(/~1/g,"/").replace(/~0/g,"~")))].sort().join("\n"))'
  ```

  It prints the keys of `souls.launch` that decide some soul's launch. A key
  in the file that it does not print, other than `"*"`, names no soul.

## Changed

- **A `souls.launch` key that names no soul refuses the launches it might
  have pinned** ([#989](https://github.com/awebai/oats/issues/989)). A key
  of `oats-local.yaml` `souls.launch` that is the key of no soul the
  workspace offers (a soul that moved to another package, a misspelled name,
  `<member>/<soul>`) was never read: the soul it was written for ran on
  `souls.launch."*"`, the soul's own `launch:` or the host default, with no
  word. While the file holds such a key, a new launch that names none, of a
  soul with no entry of its own, is now refused with
  `E_LAUNCH_PREFERENCE_UNMATCHED` (`details: {soul, from, at, keys, fix}`,
  `keys` each with the nearest soul keys). The kernel cannot tell which soul
  the key was meant to pin, so it cannot say that this launch is not the one.
  - **Refused:** `oats spawn`, preview and apply, and `oats session
    start|restart --reselect-launch`, before anything is created, stopped or
    started. `--model` alone names no launch.
  - **Unchanged:** a spawn of a soul with its own entry; a launch named with
    `--launch-config` or `--harness`; a plain start or restart of an
    existing home.
  - **The remedy, in this order:** `oats soul launch set <soul>
    --launch-config <name>` (or `--harness <h>`) for the soul the key was
    meant for, then `oats soul launch remove <key>`. Removing first ends the
    refusal and leaves that soul on the fall-through.
  - **Every reader says it.** `oats souls` and `oats inspect --soul` carry it
    as `launch.problem` on each soul a spawn would refuse, and `oats souls`
    lists one `problems` row per key. `oats doctor` lists each key with its
    remedy, from this machine's last read of the souls; a spawn reads the
    workspace itself and is the authority.
  - **A key the kernel could not check refuses nothing**: its member is not
    confirmed, a soul failed to read, or its package is declared and not
    locked. `oats doctor` says so in an information line
    (`launch-preference-unchecked`), which changes no exit status. The key
    of a soul in `souls.disabled` matches. `"*"` is never reported, and no
    configuration key changes.
