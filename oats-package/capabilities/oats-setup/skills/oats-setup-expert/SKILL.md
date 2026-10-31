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
3. **The person's repositories as members.** For each repository the intake
   names that agents will read or work in, make two changes:
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

   Also tell them how to reach you again: the Desktop, `oats tui` (OATS
   0.52.0 and later), or `oats session attach --home <your home>`.

These steps need oats.framework 1.13.0. With a kernel older than OATS
0.61.0, `oats onboard` does not name you as the next step; nothing here
depends on that.
