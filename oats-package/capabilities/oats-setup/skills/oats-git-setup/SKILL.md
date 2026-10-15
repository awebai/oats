---
name: oats-git-setup
description: >-
  Use when a person who runs OATS has no working Git and GitHub setup yet, or
  when it looks wrong: installing `git` and `gh` on macOS or Linux, creating
  one SSH key and registering it on GitHub as an authentication key and as a
  signing key, the Git identity with a verified email, SSH commit signing, a
  DCO sign-off on every commit through a global hook that still runs each
  repository's own hooks, and the check that proves it (`ssh -T
  git@github.com`, a signed and signed-off commit GitHub shows as Verified,
  `gh auth status`). Also for keychain popups on macOS (the system
  `credential.helper osxkeychain` line), `Permission denied (publickey)`,
  `failed to write commit object`, and commits GitHub shows as Unverified.
  `/oats-onboarding` sends a host here before its first Git read. Part of the
  setup and config of an OATS workspace (oats.setup); day-to-day operation
  inside an instance is oats.core.
---

# Git and GitHub setup

OATS reads its workspace, members and packages with Git, and agents commit
and open pull requests with Git and `gh`. They all use the setup of the
person who runs OATS on this machine. Following this skill, that person ends
with:

- `git` and `gh` installed;
- one SSH key, registered on GitHub as an **authentication** key and as a
  **signing** key;
- a Git identity whose email is verified on GitHub, and every commit signed
  with that key;
- a `Signed-off-by` line (the DCO sign-off) on every commit, added by a
  global hook that still runs each repository's own hooks;
- a check that proves all of it.

**Who runs it.** The person runs every step in their own terminal, on the
machine being set up: the login opens their browser, and the key, identity
and sign-off are theirs. An agent helping them hands over one step at a
time, reads back what the person saw, and runs only the read-only commands
(step 0 and the check's read commands). It never runs the login, creates the
key or writes the person's Git configuration itself.

**How to read a step.** Each step says what to run, what you should see, and
what to do when you see something else. Replace the placeholders:
`<Your Name>` is the name you sign your work with, `<email>` an email address
verified on your GitHub account, `<login>` your GitHub user name, and
`<this computer>` a label you will recognise for this machine.

Why OATS needs each part:

- **The kernel never prompts.** It runs Git with prompts turned off and ssh
  in batch mode. A `git:` reference in the workspace is read over `https://`,
  so Git must get your GitHub token from `gh` (step 3). A `git@github.com:`
  reference is read over SSH, so the key must work without a passphrase
  prompt (step 2), and GitHub must already be a known host (step 4).
- **Agents commit as you.** Every commit an agent makes on this machine uses
  this identity, is signed with this key and carries your sign-off. Set it
  up knowing that.

## 0. Read what is there

Run these first. They change nothing.

```bash
git --version
gh --version
git config --global --list --show-origin
ls -l ~/.ssh
gh auth status
```

| What you see | What it means |
|---|---|
| `command not found` for `git` or `gh` | install it: step 1 |
| `git version` below 2.34 | too old for SSH signing: step 1 |
| `~/.ssh/id_ed25519.pub` exists | you already have a key. Use it: skip the `ssh-keygen` line in step 2 |
| `user.name`, `user.email` or `gpg.format` already set | someone set up Git here before. Step 5 replaces these values: confirm with the person that it should |
| `core.hookspath` already set | a global hooks setup exists. **Stop before step 6** (see step 6) |
| `Logged in to github.com account <login>` | gh is logged in: step 3 uses `gh auth refresh` instead of `gh auth login` |

## 1. Install git and gh

### macOS

If `brew --version` prints a version, Homebrew is installed:

```bash
brew install git gh
```

If it is not, install Homebrew first: open <https://brew.sh>, paste the
command shown under “Install Homebrew” into Terminal, and run the “Next
steps” lines it prints at the end (they put `brew` on your PATH). Then run
`brew install git gh`.

Homebrew's Git sets a system credential helper that matters later: see
[The macOS credential helper](#the-macos-credential-helper).

### Linux

Use your distribution's packages:

```bash
sudo apt update && sudo apt install git gh openssh-client   # Debian, Ubuntu
sudo dnf install git gh openssh-clients                     # Fedora
sudo pacman -S git github-cli openssh                       # Arch
```

If your distribution has no `gh` package, or the check below fails, install
`gh` from GitHub's own package repository, following
<https://github.com/cli/cli/blob/trunk/docs/install_linux.md>. If its Git is
below 2.34, upgrade the distribution or install a newer Git
(<https://git-scm.com/downloads/linux>).

### Check

```bash
git --version                                          # 2.34 or later
gh --version
gh auth login --help | grep -e --skip-ssh-key          # prints one line
gh ssh-key add --help | grep -e '--type'               # prints one line
```

**If a `grep` prints nothing,** that `gh` is too old for the steps below.
Install a current one (on Linux, from GitHub's package repository above).

## 2. Create the SSH key

Skip the `ssh-keygen` line if step 0 found `~/.ssh/id_ed25519.pub`.

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "<email>" -f ~/.ssh/id_ed25519
```

You should see `Generating public/private ed25519 key pair.`, then two
questions about a passphrase.

**The passphrase.** On a machine whose agents run without you at the
keyboard, press Enter twice, for no passphrase. Agents sign commits and the
kernel reads over SSH without a terminal, so nothing could type it. With a
passphrase, their commits fail with `incorrect passphrase supplied to decrypt
private key` and `fatal: failed to write commit object`, unless the key is
loaded in an ssh-agent that every agent session reaches; that setup is
outside this skill. Without a passphrase, the key file is protected only by
its file permissions and the disk's encryption: turn on FileVault (macOS) or disk
encryption (Linux). If the machine is ever lost, delete the key on GitHub
(<https://github.com/settings/keys>). This is the person's choice;
`docs/servers.md`, “Git on a macOS host”, covers a Mac another machine
drives.

You should then see `Your public key has been saved in`, followed by the
path of `.ssh/id_ed25519.pub` in your home folder, and a fingerprint starting
`SHA256:`.

**Reusing a key that already exists?** Check whether it has a passphrase:

```bash
ssh-keygen -y -P "" -f ~/.ssh/id_ed25519 >/dev/null 2>&1 && echo "no passphrase" || echo "has a passphrase"
```

If it has one, the passphrase paragraph above applies to it.

| What you see instead | What to do |
|---|---|
| `~/.ssh/id_ed25519 already exists. Overwrite (y/n)?` | answer `n`. Use the existing key and go on |

## 3. Log in to GitHub with gh

If step 0 showed gh already logged in, run the `gh auth refresh` and
`gh config set` lines instead of `gh auth login`:

```bash
gh auth login --hostname github.com --git-protocol ssh --web --skip-ssh-key \
  --scopes admin:public_key,admin:ssh_signing_key,user:email
# already logged in:
gh auth refresh --hostname github.com --scopes admin:public_key,admin:ssh_signing_key,user:email
gh config set --host github.com git_protocol ssh
```

gh prints a one-time code and opens your browser. Enter the code, approve,
and come back. You should see `✓ Authentication complete.` and `✓ Logged in
as <login>`. The extra scopes let the next step add your key; step 4 removes
the two `admin` ones again.

On a Mac that another machine drives (`oats server add`) or that runs Git
from background jobs, add `--insecure-storage` to `gh auth login`: such a
session cannot open the keychain where gh keeps its token. The trade-off is
in `docs/servers.md`, “Git on a macOS host”.

Then let Git take its GitHub credentials from gh:

```bash
gh auth setup-git
git config --global --get-all credential.https://github.com.helper
```

The second command prints an empty line, then a line ending in
`gh auth git-credential`. The empty line clears any helper configured before
it, so Git asks gh, and nothing else, for `https://github.com`.

## 4. Register the key on GitHub, twice

The same public key goes on the account once as an authentication key (to
push and pull over SSH) and once as a signing key (so GitHub can verify your
commits):

```bash
gh ssh-key add ~/.ssh/id_ed25519.pub --type authentication --title "<this computer>"
gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title "<this computer>"
gh ssh-key list
```

Each `add` prints `✓ Public key added to your account`. The list shows the
key twice, once with `authentication` and once with `signing` in its last
column.

| What you see instead | What to do |
|---|---|
| `needs the "admin:public_key" scope` or `"admin:ssh_signing_key"` | step 3's scopes are missing: run step 3's `gh auth refresh` line, then this step again |
| `key is already in use` | the key is already registered (perhaps on another account). Check `gh ssh-key list` shows it with both types on **this** account |

Now connect to GitHub over SSH once, from your terminal:

```bash
ssh -T git@github.com
```

The first time, ssh asks `Are you sure you want to continue connecting
(yes/no/[fingerprint])?` and shows GitHub's key fingerprint. Compare it with
GitHub's published fingerprints
(<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints>;
the ED25519 one is `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`).
If they match, type `yes`. If they differ, stop: do not connect, and get
help. This saves GitHub as a known host; the kernel's batch-mode ssh cannot
answer that question itself.

You should see `Hi <login>! You've successfully authenticated, but GitHub
does not provide shell access.` The command exits with status 1: that is
normal.

| What you see instead | What to do |
|---|---|
| `Permission denied (publickey)` | the key is not registered as an authentication key on this account, or ssh offered another key: check `gh ssh-key list`; with several keys, see the failure table |
| `Hi <another login>!` | this key belongs to another GitHub account. Use a key of this account |

Finally, remove the two admin scopes. Every agent on this machine uses this
gh login, and none of them needs to add keys to your account:

```bash
gh auth refresh --hostname github.com --remove-scopes admin:public_key,admin:ssh_signing_key
```

The browser opens again: enter the new code and approve.

## 5. Identity and commit signing

Choose the email. It must be verified on your GitHub account:

```bash
gh api user/emails --jq '.[] | select(.verified) | .email'
```

Use one of the addresses it prints. To keep your address private, use
GitHub's no-reply address instead: it is shown on
<https://github.com/settings/emails> under “Keep my email addresses private”,
and it counts as verified. If that page has “Block command line pushes that
expose my email” turned on, you must use the no-reply address.

```bash
git config --global user.name "<Your Name>"
git config --global user.email "<email>"
git config --global gpg.format ssh
git config --global user.signingkey "$HOME/.ssh/id_ed25519.pub"
git config --global commit.gpgsign true
echo "$(git config --global user.email) namespaces=\"git\" $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
git config --global gpg.ssh.allowedSignersFile "$HOME/.ssh/allowed_signers"
```

The first five lines set who you are and sign every commit with your SSH key.
The last two let Git on this machine check those signatures itself (the
check uses it). These commands print nothing when they succeed.

## 6. DCO sign-off on every commit

A `Signed-off-by: <Your Name> <email>` line in a commit message certifies the
Developer Certificate of Origin (<https://developercertificate.org>): that
you have the right to submit the change. Many projects require it on every
commit. A global hook adds it to every commit made on this machine, by you
or by an agent.

**First, look for an existing global hooks setup:**

```bash
git config --global --get core.hooksPath
ls -A ~/.config/git/hooks
```

Both must print nothing (the `ls` may say `No such file or directory`). If
either prints something, **stop**: this machine already has global hooks,
and replacing them would silently turn them off. Merging them with this one
is a task for a developer.

A global hooks directory replaces each repository's own hooks directory, so
the hook below does two things: it adds the sign-off, then it runs the
repository's own hook of the same name, if there is one. Create it:

```bash
mkdir -p ~/.config/git/hooks
cat > ~/.config/git/hooks/run-hook <<'EOF'
#!/bin/sh
# Global Git hook from oats.setup /oats-git-setup.
# Adds a DCO sign-off to every commit message, then runs the
# repository's own hook of the same name, if it has one.
hook=$(basename "$0")
if [ "$hook" = prepare-commit-msg ]; then
  ident=$(git var GIT_COMMITTER_IDENT) || exit 1
  git interpret-trailers --in-place --if-exists addIfDifferent \
    --trailer "Signed-off-by: ${ident%>*}>" "$1" || exit 1
fi
common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
own="$common/hooks/$hook"
if [ -x "$own" ]; then exec "$own" "$@"; fi
exit 0
EOF
chmod +x ~/.config/git/hooks/run-hook
cd ~/.config/git/hooks
for h in applypatch-msg pre-applypatch post-applypatch pre-commit \
  pre-merge-commit prepare-commit-msg commit-msg post-commit pre-rebase \
  post-checkout post-merge pre-push pre-receive update post-receive \
  post-update reference-transaction pre-auto-gc post-rewrite \
  sendemail-validate post-index-change p4-changelist p4-prepare-changelist \
  p4-post-changelist p4-pre-submit; do ln -s run-hook "$h"; done
cd
git config --global core.hooksPath "$HOME/.config/git/hooks"
```

`ls ~/.config/git/hooks` now shows `run-hook` and one link per hook name.

What it does, and why:

- **The sign-off is added in `prepare-commit-msg`,** which Git runs for every
  commit, including `git commit --no-verify`, merges and amends. It is added
  only when that exact line is not already there, so `git commit -s` and
  `--amend` do not repeat it. A commit with an otherwise empty message is
  still aborted.
- **The repository's own hooks** are found in the repository's hooks folder
  (shared by all its worktrees) and run with the same arguments and input.
- **Two hook names are left out on purpose:** `push-to-checkout` and
  `proc-receive`. Git changes what it does when they merely exist.
- **A repository that sets its own `core.hooksPath`** (some JavaScript
  projects do, through Husky) uses its own hooks instead, and this hook does
  not run there. `git config --show-origin --get core.hooksPath` inside that
  repository shows `file:.git/config`. Commit there with `git commit -s`.

## 7. Check

Run this in a scratch folder. It makes one private test repository on your
account, which you delete at the end.

```bash
cd "$(mktemp -d)"
git init -b main
printf '#!/bin/sh\necho "repository hook ran"\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
git commit --allow-empty -m "Check Git setup"
git log -1 --show-signature --format=%B
```

You should see:

1. `repository hook ran`: the global hook still runs the repository's own
   hooks.
2. `Good "git" signature for <email> with ED25519 key SHA256:…`: the commit
   is signed with your key.
3. The message `Check Git setup`, then an empty line, then
   `Signed-off-by: <Your Name> <email>`.

Now push it to GitHub:

```bash
login=$(gh api user --jq .login)
gh repo create oats-git-check --private
git remote add origin "git@github.com:$login/oats-git-check.git"
git push -u origin main
gh api "repos/$login/oats-git-check/commits/main" --jq '.commit.verification | {verified, reason}'
ssh -T git@github.com
gh auth status
```

You should see:

4. The push succeeds, then `{"reason":"valid","verified":true}`. The commit
   page, `https://github.com/<login>/oats-git-check/commits/main`, shows the
   commit as **Verified**.
5. `Hi <login>! You've successfully authenticated…` from ssh.
6. From `gh auth status`: `Logged in to github.com account <login>`,
   `Git operations protocol: ssh`, and token scopes without
   `admin:public_key` or `admin:ssh_signing_key`.

Then check which credential helper Git would use if it ran without your
home folder (see the next section for why):

```bash
env -u HOME -u XDG_CONFIG_HOME git config --show-origin --get-all credential.helper
```

7. On Linux this usually prints nothing. On macOS it usually prints a line
   ending in `osxkeychain`, with the system file it comes from. Read the next
   section, and record the line in the hand-back.

**Clean up:** delete the test repository on its settings page,
`https://github.com/<login>/oats-git-check/settings` (“Delete this
repository”, at the bottom). Do not add the `delete_repo` scope to gh to do
it from the terminal: every agent on this machine would then be able to
delete your repositories.

**Record** in the onboarding hand-back: the GitHub login, the result of
checks 4 to 6, and check 7's line or “none”.

## The macOS credential helper

Git reads its settings from three places: the system file, then yours in
your home folder (`~/.gitconfig`), then the repository's. On macOS, the system
file of Homebrew's Git (and of Apple's) sets `credential.helper osxkeychain`:
Git then keeps tokens in the macOS keychain.

With your home folder present, step 3's empty `helper` line clears that
helper for `https://github.com`, and Git asks gh. **A Git process that runs
without `HOME` skips `~/.gitconfig` altogether.** It then uses only the
system file, so it asks the keychain. That is what raised repeated keychain
popups on one host, after an agent relaunched an app with an emptied
environment: every Git run in that app went to the keychain.

So:

- **Leave credentials to gh or SSH.** `gh auth setup-git` (step 3) serves
  `https://` remotes; your SSH key serves `git@github.com:` remotes, which use
  no credential helper at all.
- **Check 7 shows whether a HOME-less Git would fall back to the keychain.**
  If it prints `osxkeychain`, Git is fine as long as every process that runs
  it has `HOME` set, which is the normal case.
- **Keychain popups mean some process runs Git without `HOME`.** Fix that
  process's environment: restart the app or service from a normal login, or
  set `HOME` in its launch configuration. Never answer the popups or store a
  token in the keychain to make them go away.
- Removing the line from the system file is possible
  (`git config --file <the file check 7 named> --unset credential.helper`),
  but it changes Git for every user of that installation, and upgrading Git
  may bring it back. It is the person's choice; fixing the environment is
  the real remedy.

## Failure → cause → remedy

| What you see | Cause | Remedy |
|---|---|---|
| `Permission denied (publickey)` on `ssh -T` or a push | the key is not an authentication key on this account, or ssh offered a different key | `gh ssh-key list` must show it with `authentication`; with several keys, add to `~/.ssh/config`: `Host github.com` then, indented, `IdentityFile ~/.ssh/id_ed25519` and `IdentitiesOnly yes` |
| `Host key verification failed` (often from OATS, not from your terminal) | GitHub is not yet a known host, and batch-mode ssh cannot ask | run `ssh -T git@github.com` once in your terminal (step 4) |
| `incorrect passphrase supplied to decrypt private key` and `failed to write commit object` | the key has a passphrase and no ssh-agent holds it (an agent's session has no terminal to ask) | load the key in an ssh-agent the sessions reach, or use a key without a passphrase (step 2) |
| `Couldn't load public key …` and `failed to write commit object` | `user.signingkey` points at a file that is not there | step 5's `user.signingkey` line, with the key's real path |
| `*** Please tell me who you are.` | `user.name` or `user.email` is not set | step 5 |
| the verification `reason` is `unknown_key` | the key is not registered as a **signing** key | step 4's `--type signing` line |
| `unverified_email` or `no_user` | the commit's email is not verified on the account, or belongs to no account | verify it on <https://github.com/settings/emails>, or use a verified address in step 5; then make a new commit |
| `unsigned` | `commit.gpgsign` is off, or a repository turns it off | `git config --show-origin --get commit.gpgsign` shows which file; step 5 |
| `GH007: Your push would publish a private email address` | the account blocks pushes with your private address | use the no-reply address (step 5), then `git commit --amend --reset-author --no-edit` and push again |
| no `Signed-off-by` line | `core.hooksPath` is not the global hooks folder here (a repository sets its own), or `run-hook` is not executable | `git config --show-origin --get core.hooksPath` in that repository; `chmod +x ~/.config/git/hooks/run-hook` |
| a repository's own hook stopped running | it is not executable, or it sits outside the repository's hooks folder | `ls -l "$(git rev-parse --git-common-dir)/hooks"` shows what the global hook will run |
| `gh: … needs the "<scope>" scope` | gh's token lacks that scope | `gh auth refresh --hostname github.com --scopes <scope>`; remove admin scopes afterwards |
| repeated macOS keychain popups | a process runs Git without `HOME` and falls back to the system `osxkeychain` helper | [The macOS credential helper](#the-macos-credential-helper) |
| OATS reports `E_REMOTE_UNREADABLE` with the hint `keychain-non-interactive` | a session without a terminal on a Mac cannot open the keychain | `docs/servers.md`, “Git on a macOS host” |

## Never

- Run `gh auth login`, create the key or write the person's Git
  configuration from an agent's shell. Hand over the step; read back the
  result.
- Overwrite an existing key, global hooks folder or `core.hooksPath`.
- Put a name, email, login or key in a shared OATS file: these belong to the
  person and this machine.
- Copy a private key between machines or into a message. Each machine gets
  its own key.
- Leave the `admin:public_key` or `admin:ssh_signing_key` scope on gh's
  token, or add `delete_repo`.
- Answer keychain popups or store tokens in the keychain to silence them.
