## Fixed

- `oats harness trust` names the right reason when a launch configuration that
  sets only `HOME` points at a path that is not a usable directory (a file, or
  a path under one): it says the `HOME` does not select a usable configuration
  directory, where it used to say the path is not absolute (#1171).
