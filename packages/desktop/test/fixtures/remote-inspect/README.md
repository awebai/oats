Real `oats session inspect --server <id> --home <h> --json` answers, captured from
the kernel at 546ca4cb, with the exit code the CLI gave:

- `unreachable.json`: exit 1. A registration with `--ssh nohost.invalid`; the local CLI wraps ssh's failure as an `E_SSH` envelope.
- `unknown-server.json`: exit 1. An id with no registration.
- `not-present.json`: exit 0. A home with no live session on a reachable server.
- `no-ssh.json`: exit 1. Captured from the kernel at 1964166e (#359), with `ssh` absent from PATH; `E_SSH` with `details.sshStarted: false`.
