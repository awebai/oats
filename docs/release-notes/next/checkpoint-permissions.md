## Changed

- **`/oats-agent-permissions` treats a checkpoint as an instance's own act.** A wake job on an instance's own home is no longer listed as an operator act. `oats schedule show` and `oats schedule host status` join the allow list as reads, and the `autoMode` entry tells the classifier that adding or removing such a job is normal. Installing the host's timer stays the operator's, and `--wake-*` on a spawn stays `ask`.
