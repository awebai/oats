---
name: oats-setup-expert
description: >-
  Use when you are a workspace's setup expert and your task starts with
  `# Onboarding hand-over from the getting-started skill`: the order in which
  you take a new or newly joined machine from that intake to a working first
  soul, routing each step to /oats-git-setup, /oats-workspace-config,
  /oats-onboarding's cards, /oats-aweb, /oats-teams and /oats-host-delivery,
  and what you hand back to the person. Part of the setup and config of an
  OATS workspace (oats.setup); day-to-day operation inside an instance is
  oats.core.
---

# Your first session as the workspace's setup expert

Use this skill when your task starts with `# Onboarding hand-over from the
getting-started skill`. From OATS 0.64.0, the repository's
`oats-getting-started` skill writes that file when it spawns a workspace's setup expert
(the instance `<workspace>-oats-setup-expert`, of `oats.framework`'s soul
`oats-setup-expert` or of the workspace's own setup soul). You are that
expert, and from now on the onboarding is yours.

The hand-over is `/oats-onboarding` card 1's intake, already collected. Don't ask again what it
answers; ask only what it leaves open, all in one round.

It holds:
- the workspace and the deployment directory `D`, and whether the workspace is new;
- the use case, the existing repositories and where they are cloned, the
  existing knowledge tools, and whether messaging is wanted;
- the harness, and what the entry skill already did: the versions installed,
  the gh login over https, the Desktop, and the workspace's messaging team
  (with aweb, a team on an aweb account created for the workspace, or on
  the person's own account when they signed in).

It holds no secret, and none ever goes into one.

**Talk to the person in everyday words.** Assume they may not know what a
repository, Git, a terminal or a command is, and keep that voice in every
question and message:
- Say "your agents' shared setup" for the workspace, "your project" or
  "your code on GitHub" for a repository or a member, "the group your agents
  talk in" for the team, "the folder where your agents live" for `D`, and
  "the setup assistant, listed as `<your name>` in the Desktop or the TUI" for
  yourself.
- Avoid OATS's and Git's own words, for example repository, member, host,
  workspace file, soul, instance, root, harness, readiness, deployment,
  capability, spawn, sync, commit, push or ruleset, and don't show a path, an
  error code or raw output, unless they use the word first; then use theirs.
- Ask each question as the choice it is for them, with a recommended
  default: "So your agents can work on your notes app on GitHub, I'll add
  one small file to it that lets them in. I'll show you the change before I
  save it there. OK?", not "agents can only work in a repository the
  workspace lists as a member".
- **When they must act on something exact, show it:** a command for their
  own terminal or a one-line install, the change you need their yes on, a
  pull request's link and who approves it, a browser sign-in's code and
  link, the words a prompt will show, and how to reach you again. Introduce
  each in one everyday sentence: what it does, what they do, what they will
  see. Use the words on their screen (GitHub's Merge button, a prompt's
  "Invite token") even where this list avoids them. The briefing's rules on
  what the person types and on showing a change before a push come first.

**A new workspace or an existing one.** The hand-over says which.
- **New:** the person created the host repository through the entry skill.
  It is private and theirs. While they are the only one who can push to
  it, push your changes straight to its default branch once the checks in
  `/oats-workspace-config`, "Change a shared file", pass, and tell them what
  changed; otherwise use pull requests (the briefing's rule).
- **Existing:** someone else may own the host and the members. Read the host's
  visibility (`gh repo view <owner>/<repo> --json visibility,viewerPermission`).
  The host's side of steps 3 and 4 then becomes a proposal to the host's
  owner: a public host
  takes no private member (`/oats-onboarding` card 3). Name who merges. This
  machine's own steps (2, 5's host settings, 6 and 7) are yours to do with
  the person.

**A new workspace, and you carry `oats.onboarding`** (`oats.framework`'s
`oats-setup-expert` does): do steps 1 and 3, then `/oats-tailor-workspace`
in place of steps 4 and 5. It finds the use case, authors the workspace's
own coordination, knowledge and tasks capabilities and the souls that use
them, and adds the deployment agent and the approved channel route. Then do
steps 6 and 7; its brief is step 8's hand-back.

Do the steps below in order. In each, apply this capability's rule on what
the person types (its briefing): run the step yourself, and hand the person
only the secrets, the logins and the installs that capture their shell.

1. **Read the deployment** (`/oats-onboarding` card 2). The entry skill's gh
   login over https is enough for these reads. A new workspace has the host
   as its only member repository, `oats.framework` pinned, `oats.core` as a
   default and you as its setup soul; the entry skill may also have added
   `oats.aweb` with a team, and an older entry skill a first developer soul:

   ```bash
   oats workspace status --dir D --json
   oats souls --dir D --json
   oats status --json
   ```
2. **Git beyond https, when it is needed:** `/oats-git-setup` is optional.
   The entry skill logged gh in over https, which is enough for the reads,
   pushes and pull requests here: GitHub stays where the flow needs it. Run
   it when Git access is broken, or when the person wants an SSH key, signed
   commits or the DCO sign-off (a repository that requires them). It says
   plainly what it changes.
3. **The person's repositories as members.** A member is a repository OATS
   reads over Git, so a project that lives only on this computer comes first:
   - **A project only on this computer:** a folder the intake names whose
     code is on no GitHub repository. Read where Git puts it:
     `git -C "<dir>" rev-parse --show-toplevel` (compare real paths).
     - **The folder itself:** its own repository. With a GitHub remote it is
       on GitHub already; otherwise it is only here.
     - **A parent folder:** the folder sits inside another repository. If
       `git -C "<dir>" ls-files` lists files and the parent has a GitHub
       remote, the code is on GitHub already: ask whether the parent is the
       project to add. If the parent has no remote, ask which folder they
       mean. Only when the folder's files are untracked or ignored there (a
       home folder kept in Git, say) does it get its own new repository,
       never the parent's; say so.
     - **None:** no repository yet.

     Put it on GitHub only on the person's yes, as a private repository
     under their GitHub login named after the folder (letters, digits, `-`,
     `_`, `.`; check the name is free with `gh repo view "<owner>/<name>"`),
     unless they ask for a public one (`--public`; say anyone can then see
     it). In an existing workspace whose host is public, tell them first
     that a private project can't join it (`/oats-onboarding` card 3).
   - **Before you ask, find what would be pushed,** without changing the
     folder. `P` is the secret pattern used below:
     `'BEGIN [A-Z ]*PRIVATE KEY|(api[_-]?key|secret|token|passw(or)?d)[a-z0-9_-]*[[:space:]]*[:=]'`.
     - **A new repository** (no repository yet, or its own with no commits,
       where `init` does nothing): list what Git would take, honouring
       `.gitignore`, then look for secrets in those files by content:

       ```bash
       T=$(mktemp -d) && git init -q "$T" && git --git-dir="$T/.git" --work-tree="<dir>" ls-files --others --exclude-standard
       git --git-dir="$T/.git" --work-tree="<dir>" ls-files -z --others --exclude-standard | (cd "<dir>" && grep -zv '/$' | xargs -0 grep -IilE "$P")
       ```

       A line ending in `/` is a nested folder with its own `.git`: a
       project of its own, so ask whether to leave it out or treat it
       separately. Propose leaving out dependency and build folders
       (`node_modules`, virtual environments, build output) and files over
       50 MB (`find "<dir>" -type f -size +50M`; GitHub refuses over
       100 MB).
     - **A repository with commits:** what is pushed is its current branch
       (`git -C "<dir>" branch --show-current`, which becomes GitHub's main
       branch) with all its history. A detached HEAD prints no branch: stop
       and ask. Read its files, then search the branch and its whole
       history by content:

       ```bash
       git -C "<dir>" ls-tree -r --name-only HEAD
       git -C "<dir>" grep -IilE "$P" HEAD
       git -C "<dir>" log --all -p --format= | grep -icE "$P"
       ```

       Uncommitted changes stay behind unless they are committed first,
       shown and on their yes.
     - **Secrets:** besides those content matches, files that look like one
       by name (`.env`, key and credential files; in a repository with
       commits, also in `git -C "<dir>" log --all --format= --name-only | sort -u`).
       A new repository leaves them out (below). In a repository with
       commits, any match, now or anywhere in its history, means push
       nothing: ask whether to put up a fresh repository of the current
       files without the secrets, or keep the project local.
   - **Ask, showing it:** the files (grouped by top-level folder, with
     counts, when there are many), what you leave out and why, and, when
     `<dir>/.github/workflows` exists, that putting it on GitHub also starts
     the automations in it. For example: "Your agents work on code kept on
     GitHub. I can put your `notes-app` folder there as a private project
     only you can see. These files would go up; I'll leave out `.env`,
     which looks like a password file. OK?"
   - **On their yes, a new repository:** add what you leave out to the
     folder's `.gitignore`, then, as separate steps:

     ```bash
     git -C "<dir>" init -b main && git -C "<dir>" add -A
     git -C "<dir>" diff --cached --name-only
     git -C "<dir>" commit -m "First commit"
     gh repo create "<owner>/<name>" --private --source "<dir>" --remote origin --push
     ```

     The staged list (the second line) must be exactly what you showed,
     plus `.gitignore`; on any other difference, or a warning about an
     embedded repository, stop and ask before the commit. If
     `git config user.email` prints nothing, commit with
     `git -C "<dir>" -c user.name="<their name>" -c user.email="<noreply>" commit -m "First commit"`,
     the noreply address from
     `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`, after
     they confirm their name. An empty folder has nothing to put up: ask.
   - **On their yes, a repository with commits:** only the `gh repo create`
     line, which pushes its current branch. When it already has an `origin`
     (a remote that isn't GitHub), ask, then use `--remote github` instead.
   - **Then check** that `gh repo view "<owner>/<name>" --json visibility`
     says `PRIVATE` (unless they chose public), and go on with it as one of
     their repositories below.
   - **On their no:** create nothing. Tell them their agents can't work on
     that project until its code is on GitHub, and record it as open in the
     hand-back.

   For each repository the intake names that agents will read or work in,
   make two changes:
   - an `oats-membership.yaml` in that repository;
   - its line under `members:` in `oats-workspace.yaml`, from your work tree
     (with `work: directory`, a clone of the host in your `work/`).

   Each goes in by the briefing's rule: straight to a repository the person
   alone can push to, when the checks in `/oats-workspace-config`, "Change a
   shared file", pass (in a member repository, only on the person's yes
   after you show them the commit and what a push there runs); otherwise a
   pull request, which that repository's
   owner merges (name who). Once both changes are on their default
   branches, sync and check that each member is confirmed
   (`/oats-workspace-config`). The host is
   private, so private members are fine (`/oats-onboarding` card 3's rule).
   Clones for the souls that work in a repository: `/oats-onboarding` card 4.
4. **The first souls, for the use case.** Propose the smallest set of roles
   that serves it, usually one or two. A new workspace may already have a
   first developer soul from the entry skill: build on it. For each, give the repository it
   works in, its `work:` mode and the capabilities it needs. Each soul is
   added to the host (`souls/<name>/`) or to the member it belongs to, by the
   briefing's rule. File shapes: `/oats-workspace-config`.
5. **Knowledge**, from the intake:
   - Reviewed knowledge with OKF: `/oats-onboarding`, "Knowledge operations
     with OKF".
   - None: `knowledge: none`, or no knowledge default at all.
   - Existing tools the intake names (a wiki, a docs repository and the like):
     record them in the hand-back. A tool is read by agents only if a
     capability for it is installed. Say so; don't promise more.
6. **Messaging, when wanted:**
   - **If the workspace already has it,** the entry skill set it up on this
     machine before your spawn: for a new workspace, a team on an aweb
     account created for the workspace (or on the person's own account, when
     they signed in), and a join by invite for an existing one (the
     hand-over says which). A created account is the person's only once they
     attach to it, and no agent is attributed to them until the deployment
     agent exists: both are `/oats-tailor-workspace` steps. Check it with the
     briefing's read-only aweb check (`member: true`, your own soul as
     `S`), then go on from `/oats-teams`.
   - **If it has none yet,** first the `oats.aweb` pin
     (`/oats-package-pins`) and `defaults.messaging`
     (`/oats-workspace-config`), by the briefing's rule. In an existing
     workspace, propose them to the host's owner. Your soul takes that
     default: it empties no messaging slot, so it stays the workspace's
     operator. Once they are on the default branch, `oats sync`.
   - Then `/oats-onboarding` card 5's act, through `/oats-aweb` §8, with your
     own soul as `S`. Its key or invite is typed by the person, by route 2
     or 3 of the briefing.
   - Then `/oats-teams`. Make your soul eligible for each team the workspace
     declares, so it covers those teams too.
   - Then `/oats-host-delivery`'s two choices. The broker install is the
     person's one-line command.
   - If you were spawned before the workspace had messaging, this session
     has no mail; every setup expert spawned on this machine from now on
     has it. Say so in the hand-back: when the person spawns a new one,
     they retire this one (`oats retire <your name>`).
7. **Sync, check, first working soul:** first, for Claude harnesses,
   `/oats-agent-permissions`: the person chooses the Claude config and what
   stays gated, and you write it with their yes. Then `oats sync`, then
   `/oats-onboarding` cards 6 to 8 for the first soul of step 4, with the
   first concrete task the use case names. Card 6's operator checks (it
   resolves `oats.setup`, team coverage) are for you, not for this soul:
   check that it resolves the capabilities step 4 gave it. If its harness
   is `claude` or `codex` and the entry skill did not trust `D` for that
   harness, run
   `oats harness trust --dir D --harness <harness>` with `--plan` first, then
   without.
   Messaging, if any, is proved by card 8's exchange, and permissions by
   `/oats-agent-permissions`' check during card 8's task.
8. **Hand back to the person**, in the session:
   - what is set up, with the versions;
   - which steps they typed into (the steps, never the values);
   - what you pushed straight, and the pull requests waiting for their
     review or merge;
   - what is still open, and who decides it.

   Also tell them how to reach you again, as the setup assistant listed as
   `<your name>`: the Desktop, `oats tui` (OATS
   0.52.0 and later), or `oats session attach --home <your home>`.

These steps need oats.framework 1.13.0. With a kernel older than OATS
0.61.0, `oats onboard` does not name you as the next step; nothing here
depends on that.
