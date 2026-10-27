## Upgrade

- An instance last started before this version has no record of its launch
  environment. Its first resume after the upgrade goes ahead with one warning:
  "`<instance>`'s launch environment could not be verified this once (it was
  last started before OATS recorded it); its next start records it". From
  then on it is checked (#1559).

## Added

- A resume starts only under the `{fromEnv: SRC}` values its instance's last
  start ran with. A value that changed since refuses the resume before
  anything is launched: `E_LAUNCH_ENV_CHANGED`, naming the variables, never
  their values. `oats session resume` reports it as a refused start
  (`refused`, `start-refused`), and `--plan` predicts it. Start the instance
  yourself to use the new values: an ordinary start never compares. Every
  start records its launch environment as a keyed one-way digest per variable,
  in two kernel-private files in the home. A value, which may be a credential,
  is never written (#1559). See
  [The launch environment a resume runs under](../execution-targets.md#the-launch-environment-a-resume-runs-under).

## Changed

- OATS Desktop runs with the desktop session's environment, not your shell's.
  A `fromEnv` variable exported only in a shell profile is not set there, so
  the Desktop's sweep refuses that instance (`E_LAUNCH_ENV_MISSING`) while
  `oats tui` run from that shell resumes it. Put the variable in the session's
  environment, or use a literal in the launch configuration (#1559).
- A command you typed into an instance's window is not resumed. A resume runs
  the instance's OATS launch, with the launch configuration, model and yolo its
  last start chose. Put a custom command in a launch configuration (#1559).
