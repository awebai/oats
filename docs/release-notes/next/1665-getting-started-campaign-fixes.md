## Changed

- **Getting started: fixes from a second round of newcomer runs on fresh machines.** In `oats-getting-started`:
  - **The whole file:** its description and its first line tell the agent to download it whole with `curl -fsSL` and follow it as written; a summary of it, from a web fetch that summarises, is not the procedure.
  - **One change per command:** each change step 1's yes named runs as its own command, never batched with others, so a permission check that reads the conversation sees it by name. A refused command is never split into pieces or re-run in parts, `sudo` included: the agent asks the person once, naming the change, and retries once on their yes.
  - **The time budget:** the setup takes a few minutes and seconds of the person's time. The agent waits about a minute for the Desktop's background download once the CLI is installed; when it hasn't verified by then, it goes on without the Desktop, which the setup expert installs later, and says so in the hand-over.
  - **A terminal window on Linux** that `systemd-run --user` can't open (no user session bus) is started directly with `setsid xdg-terminal-exec` or `setsid x-terminal-emulator` before the person is given a command to type.
  - **GitHub:** when the skill installed `gh`, it checks the login again before starting a device login.
  - **A monorepo host:** step 1's one yes names the two setup files committed to it, and step 7 commits them without asking again. A refused or protected push still takes a pull request, and the hand-over records the skeleton as pushed or merged.
  - **The hand-off** names no versions, package sources or internal flags or codes, and the setup expert only as the Desktop shows it; anything the person may want later goes in the hand-over file.
  - **pi's skills filter** matches `npm:@awebai/pi` alone or with a version, never another `@awebai/pi-…` package. The skill now says that Claude's aweb channel plugin still carries one skill of its own until aweb ships it without one, a known gap ([awebai/oats#1665](https://github.com/awebai/oats/issues/1665)).
