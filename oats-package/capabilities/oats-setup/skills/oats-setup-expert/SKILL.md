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
getting-started skill`. The repository's `oats-getting-started` skill writes
that file when it spawns a workspace's setup expert
(`<workspace>-oats-setup-expert`). You are that expert, and from now on the
onboarding is yours.

The hand-over is `/oats-onboarding` card 1's intake, already collected. Don't ask again what it
answers; ask only what it leaves open, all in one round.

It holds:
- the workspace and the deployment directory `D`, and whether the workspace is new;
- the use case, the existing repositories and where they are cloned, the
  existing knowledge tools, and whether messaging is wanted;
- the harness, and what the entry skill already did: the versions installed,
  the gh login over https, the Desktop.

It holds no secret, and none ever goes into one.

**A new workspace or an existing one.** The hand-over says which.
- **New:** the person created the host repository through the entry skill.
  It is private and theirs, so they review and merge its pull requests.
- **Existing:** someone else may own the host and the members. Read the host's
  visibility (`gh repo view <owner>/<repo> --json visibility,viewerPermission`).
  Steps 3 and 4 then become proposals to the host's owner: a public host
  takes no private member (`/oats-onboarding` card 3). Name who merges. This
  machine's own steps (2, 5's host settings, 6 and 7) are yours to do with
  the person.

Do the steps below in order. In each, apply this capability's rule on what
the person types (its briefing): run the step yourself, and hand the person
only the secrets, the logins and the two installs that capture their shell.

1. **Read the deployment** (`/oats-onboarding` card 2). The entry skill's gh
   login over https is enough for these reads; step 2 completes Git. A new
   workspace has the host as its only member, `oats.framework` pinned,
   `oats.core` as a default, and you as its one soul:

   ```bash
   oats workspace status --dir D --json
   oats souls --dir D --json
   oats status --json
   ```
2. **Git and GitHub in full:** `/oats-git-setup`. The entry skill only logged
   gh in over https. Every agent's commits need the key, the signing and the
   sign-off.
3. **The person's repositories as members.** For each repository the intake
   names that agents will read or work in, make two changes:
   - an `oats-membership.yaml` in that repository, by a pull request there;
   - its line under `members:` in `oats-workspace.yaml`, by a pull request
     from your work tree.

   Then sync, and check that each member is confirmed (`/oats-workspace-config`).
   The person merges both, because they own the repositories. The host is
   private, so private members are fine (`/oats-onboarding` card 3's rule).
   Clones for the souls that work in a repository: `/oats-onboarding` card 4.
4. **The first souls, for the use case.** Propose the smallest set of roles
   that serves it, usually one or two. For each, give the repository it
   works in, its `work:` mode and the capabilities it needs. Each soul is
   added by a pull request, to the host (`souls/<name>/`) or to the member it
   belongs to. File shapes: `/oats-workspace-config`.
5. **Knowledge**, from the intake:
   - Reviewed knowledge with OKF: `/oats-onboarding`, "Knowledge operations
     with OKF".
   - None: `knowledge: none`, or no knowledge default at all.
   - Existing tools the intake names (a wiki, a docs repository and the like):
     record them in the hand-back. A tool is read by agents only if a
     capability for it is installed. Say so; don't promise more.
6. **Messaging, when wanted:**
   - `/oats-onboarding` card 5's act, through `/oats-aweb` §8. Its key or
     invite is typed by the person, by route 2 or 3 of the briefing.
   - Then `/oats-teams`.
   - Then `/oats-host-delivery`'s two choices. The broker install is the
     person's one-line command.
7. **Sync, check, first working soul:** `oats sync`, then `/oats-onboarding`
   cards 6 to 8 for the first soul of step 4, with the first concrete task the
   use case names. Card 6's operator checks (it resolves `oats.setup`, team
   coverage) are for you, not for this soul: check that it resolves the
   capabilities step 4 gave it. If its harness is `claude` or `codex` and
   the entry skill did not trust `D` for that harness, run
   `oats harness trust --dir D --harness <harness>` with `--plan` first, then
   without.
   Messaging, if any, is proved by card 8's exchange.
8. **Hand back to the person**, in the session:
   - what is set up, with the versions;
   - which steps they typed into (the steps, never the values);
   - the pull requests waiting for their review or merge;
   - what is still open, and who decides it.

   Also tell them how to reach you again: the Desktop, `oats tui` (OATS
   0.52.0 and later), or `oats session attach --home <your home>`.

These steps need oats.framework 1.13.0. With a kernel older than OATS
0.61.0, `oats onboard` does not name you as the next step; nothing here
depends on that.
