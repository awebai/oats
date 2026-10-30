---
name: oats-tailor-workspace
description: >-
  Use when you are a workspace's setup expert, the workspace is new, and the
  getting-started skill has handed it over: turn OATS's defaults into this
  workspace's own coordination, knowledge and tasks capabilities for its use
  case, take the person through the deployment-agent step, offer the
  approved channel route, and brief the person. Procedure only; the setup
  and config procedures it points to are oats.setup's. Part of
  oats.onboarding.
---

# Tailor a new workspace to its use case

OATS's defaults are a starting template, not the answer. This skill turns
them into the workspace's own capabilities, shaped by how this team already
works. Do the steps in order. Apply `oats.setup`'s briefing throughout: you
run each step, and the person types only secrets, logins and the installs
that capture their shell.

## 1. Discover the use case

This is discovery, not configuration. Change nothing yet. Read:

- the hand-over, and the project itself (its repositories, their README and
  contributing docs);
- the tools already in use: the tracker, the knowledge system (a wiki, a docs
  repository, OKF), CI;
- how review and merge work on GitHub: who reviews, who merges, required
  checks, branch protection and rulesets (the reads in
  `/oats-workspace-config`, "Change a shared file");
- the size of the organization, and how many people will run agents;
- one repository or several;
- Slack, if it is connected and the person allows you to read it.

Then ask the person only what that leaves open, in one round.

## 2. Author the three core capabilities

Author coordination, knowledge and tasks as plain capabilities of this
workspace: `capabilities/<name>/` in a member repository, committed by the
briefing's rule for shared files. They are the workspace's own files, not
package pins, and they need no packaging. The manifest's shape is in the
installed kernel's `docs/capabilities.md`.

Copy each from OATS's default and adapt it to what step 1 found. Run **one
sub-agent per capability**, on the strongest model available, each with
step 1's findings and its starting point:

- **Coordination**, from the engineering package `oats.engineering`
  (`oats.maintainer`, `oats.engineering-expert`, `oats.developer`,
  `oats.code-review`). It must cover:
  - the roles (maintainer, expert, developer, reviewer), adapted to their
    review and merge rules and to their size;
  - the Desktop's grouping (from OATS 0.69.2): a top-level agent is spawned
    without `--same-work`, a feature's agents with it, and each group has one
    colour (`oats instance color`);
  - coordination across humans: taught to the agents, and explained to the
    people.
- **Knowledge**, from the knowledge theory (`oats.knowledge-theory`'s
  `/knowledge-capability-authoring`). If they use OKF, start from `oats.okf`;
  otherwise write a capability over what they already have. It must cover
  what is worth keeping (decisions, rejected alternatives, discoveries,
  lessons; never descriptions of the code), and that agents consult it before
  they act.
- **Tasks**, from the tracker they use: the official tasks providers in the
  catalog (with aweb, the default, `oats.aweb-tasks`; `oats.jira`,
  `oats.linear`). It must expose what agents can operate, and say what stays
  with humans.

Check each draft against step 1 before you commit it: our default's
assumptions that this team does not share come out.

Then the souls that use them: file shapes in `/oats-workspace-config`,
`soul.yaml` (v2). Name each capability with `{ from: <repo key> }` of the
member that holds it. After the change is on the default branch, sync and
check each soul by `/oats-onboarding` cards 6 to 8:

```bash
oats sync
oats souls --json
oats spawn <soul> --preview --json
```

## 3. The deployment's agent, for human attribution

This is a normal step, not an option. The deployment's agent ties the
instances spawned from here on to the person who runs them.

- The person issues it at a terminal. It asks for their passphrase, so it
  runs in their own terminal (the briefing's rule on what the person types,
  route 3). You give them the exact command.
- The act comes from the messaging capability's own skill. With aweb, the
  default, it is `/oats-aweb`'s deployment-agent step, from the `oats.aweb`
  release that ships it.
- Instances spawned **after** it carry a chain to that person. Instances
  spawned **before** it, you included, stay `unknown` until they are
  respawned. Respawning is the person's choice; it costs each one a new
  session.
- If the messaging capability's skill names no such step, the deployment has
  no bound human. Say so in step 5, as information, never as a failure.

Until an agent actually carries a chain, never say the team or the agents
are bound or attributed. Say that the team is owned by the person's account
(with aweb: "your aweb account").

## 4. The approved channel route

This is also a normal step. The getting-started skill left the harness's
development channel mode, which the kernel confirms at each start. Offer the
approved route: for Claude Code with aweb, `/oats-host-delivery`, "Claude
channel delivery (approved route)". Writing the managed-settings file needs
`sudo`, so the person runs it in their own terminal. Homes started before the
change keep development mode until they are respawned.

Never steer anyone to `delivery: session`.

## 5. Brief the person

In the session, plainly:

- which capabilities now exist, and where to read them (repository and path);
- how to work with the agents: who to talk to first, and how the roles hand
  work to each other;
- how coordination across humans will run;
- what is still `unknown` (step 3), and what respawning would change;
- what is open, and who decides it.
