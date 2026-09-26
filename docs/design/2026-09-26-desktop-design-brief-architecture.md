# OATS for designers: the architecture, and the why, behind the Desktop

**Audience:** a product designer redesigning the OATS Desktop. You don't need to read code. After this you should be able to answer the questions a user will ask the Desktop: *what is OATS, what is my setup, where does each thing come from, and why is it that way?*

**Status:** the model described here is what ships in OATS 0.27.x. Things that are planned but not shipped are marked **(planned)**.

---

## 1. What OATS is, in one paragraph

OATS lets a person or a company run a **team of AI agents** (Claude, Codex or Pi sessions) that each have a durable role, their own tools and knowledge, and a place to work. The unit you design and keep is a **soul** (a role, like "release manager"). The unit that actually runs is an **instance** (a working session of that soul, with its own folder and task). Everything a soul needs (tools, instructions, knowledge, messaging) comes from **Git repositories** the organisation already has, gathered into one **workspace**. OATS never "installs" anything globally: when an instance starts, OATS copies exactly what that soul needs into the instance's own folder, and records where each piece came from.

**The design promise to users:** *you can always see what an agent is made of, where every part came from, and why it's there.*

---

## 2. The five things a user must be able to picture

Think of these as the nouns of the product. The Desktop's job is to make each one visible and to show how they connect.

| Concept | Plain meaning | Analogy |
|---|---|---|
| **Workspace** | The organisation's agent setup: which repositories take part, which shared tools and versions everyone uses, and the teams. One per organisation. | The company's org chart + approved-tools list. |
| **Repository (member)** | A Git repo that has **joined** the workspace. It can contribute **souls** and **capabilities**. | A department that brings its people and its tools. |
| **Soul** | A durable agent role: instructions, skills, and which capabilities it uses. Lives as a folder in a member repo. | A job description. |
| **Instance** | A running (or stopped) incarnation of a soul: its own folder, task, work branch, and session. You spawn, attach to and retire instances. | A person currently doing that job. |
| **Capability** | A reusable bundle of skills, instructions, commands and hooks (e.g. "house style", "deploy tooling", "knowledge", "messaging"). | A tool or training the person gets. |

Plus two supporting nouns:

- **Package**: a *versioned* bundle of capabilities published by a repo (e.g. `oats.okf v2.1.5`). The workspace pins its version.
- **Deployment**: one machine's realisation of the workspace. It's a folder on the user's computer that holds the per-machine settings, the lock, the instance folders and any repo clones they work in.

---

## 3. How a workspace is set up

### 3.1 Files, and who owns them

A workspace is **declared in Git**, not configured in an app. The Desktop *reads* these and helps edit them; it doesn't hold hidden state.

| File | Lives in | Shared? | Says |
|---|---|---|---|
| `oats-workspace.yaml` | the **host** repo (any member; often a dedicated `agents` repo) | yes, via Git | the members, the pinned packages, the teams, the defaults, the knowledge stores |
| `oats-membership.yaml` | **every** member repo | yes, via Git | "I belong to workspace X" (+ an optional default team) |
| `souls/<name>/soul.yaml` | a member repo | yes, via Git | this role's work mode, team(s), capabilities, and where each comes from |
| `capabilities/<name>/oats.json` | a member repo | yes, via Git | the capability's manifest (what it provides, optional core-capability "layer", optional repo-owned flag) |
| `oats-local.yaml` | the user's **deployment folder** | **no, per machine** | which workspace this machine runs, where clones live, host-only settings (paths, keys), souls disabled here |
| `oats-lock.json` | the deployment folder | per machine (but identical wherever the same workspace commit was synced) | the exact commit + content fingerprint of every pinned package |

**Design implication:** show clearly **what is shared** (Git, the same for everyone in the org) versus **what is this machine** (local settings, clones, running instances). Users get confused when the two blur.

### 3.2 Membership is a two-way handshake (and it IS the trust)

A repo is a member only when **both**:

1. the workspace lists it, **and**
2. the repo's `oats-membership.yaml` points back to that workspace.

One side alone isn't enough (a copied file in a fork doesn't count). OATS checks both sides over Git, with the user's own access.

**Why:** whoever can push to a member repo decides what its souls and capabilities are, the same trust model as the code itself. There's no separate "approve this tool" step for members.

Each member shows one of these states, and the Desktop must surface them plainly:

| State | What the user should understand |
|---|---|
| **confirmed** | It's in. Its souls and capabilities are available. |
| **not listed** | The repo points at the workspace, but the workspace doesn't list it. |
| **no backlink** | The workspace lists it, but the repo hasn't joined (no membership file). |
| **points elsewhere** | The repo says it belongs to a different workspace. |
| **can't read** | This user can't read the repo (access, network). Nothing from it is available *for this user*. |

An unconfirmed member contributes **nothing**: its souls and capabilities are invisible. This is often the answer to "why can't I see soul X?"

### 3.3 Packages: the only versioned things

- **Member** capabilities and souls are always the repo's **latest** default-branch state. They're not versioned.
- **Packages** are **pinned**: the workspace lists `package: version`; the lock records the exact commit + fingerprint.
- **Declaring a package is the trust decision.** There's no second approval.
- Official packages (`oats.framework`, `oats.okf`, `oats.aweb`, `oats.jira`, `oats.linear`, `oats.authoring`, `oats.dev`) come from a reviewed **official catalog**. Others are referenced by Git URL + tag.

**Why two tiers:** your own repos move fast and you trust them (latest state), while third-party or shared tooling must not change under you (pinned + fingerprinted). A repo can be **both** a member *and* publish a package. They never merge: "from this repo" means its latest `capabilities/`; "from the package" means the pinned version.

**Design implication:** every capability shown should say **where it comes from**: a member repo (latest), a package (with its pinned version), or "this soul's own repo". This is the single most important fact for a user to understand their setup.

### 3.4 Teams: labels that organise, never walls

- The workspace declares team labels once (e.g. `global`, `engineering`, `marketing`).
- A soul has one team or several (the first is its **primary**). A repo can set a default team for its souls.
- A team label can **add default capabilities** for its souls (e.g. every `engineering` soul gets the release tooling).
- A team label **never** restricts, gates or changes trust. It's organisation, plus optional defaults.
- For **messaging**, each label a soul carries is a team it's *eligible* to join. By default an instance is only in the workspace's **default team**, and joining others is an explicit choice, at spawn or later.

---

## 4. How a soul gets its capabilities (composition)

When you spawn an instance, OATS assembles the soul's capability list from layers, later layers winning:

```
workspace defaults  →  team defaults (per label)  →  the soul's own list
```

- A soul can **add** capabilities, **turn off** a default (`off`), or empty a core-capability slot (`none`).
- If two of a soul's teams disagree about a capability, that's a **team conflict**, and the soul can't be spawned until the workspace fixes it. The Desktop shows the two labels.
- The result is an exact, fingerprinted **resolution**. Preview shows it before anything is created; if something changed between preview and spawn, OATS refuses and asks you to preview again.

**Design implication:** for any soul, the Desktop can show a **composition view**: each capability, and **why it's there** (a workspace default, a team default via label X, or the soul's own choice). The kernel reports this per core capability as `from: soul | workspace | team:<label>`.

---

## 5. The core capabilities: knowledge, messaging, tasks

Most capabilities are unlimited and additive (a soul can have any number). Three are special, the **core capabilities**, and each has exactly **one slot** per soul:

| Core capability | What it gives an agent | Official provider | Can be `none` |
|---|---|---|---|
| **Knowledge** | durable, shared memory: what the organisation has learned, decisions, lessons; the agent reads it and proposes additions | `oats.okf` | yes |
| **Messaging** | an identity, a team, mail/chat with other agents and humans, being woken by messages | `oats.aweb` | yes |
| **Tasks** | a tracker for assignment, status, blockers (Jira, Linear) | `oats.jira`, `oats.linear` | yes |

**Why slots:** an agent should have exactly one memory, one address book and one task list, not two competing ones. Everything else is additive.

Plus one **default capability** almost every soul has: **`oats.core`**, which teaches the agent how to operate inside OATS (see its teammates, spawn helpers, retire). It's a workspace default and can be turned off per soul.

**Vocabulary:** say **"core capabilities"** in the UI (not "layers" or "slots"; those are internal words).

### 5.1 Knowledge, specifically

- Knowledge lives in **knowledge bases**: Markdown "concepts" organised in **nodes**, usually in a Git repo like `org/knowledge`.
- A soul **owns** some nodes (its responsibility) and **reads** others (its starting context).
- Agents propose knowledge through **pull requests**. Nothing is accepted until merged. Agents never write accepted knowledge directly.
- **(planned, oats.okf 3.0.0, in progress)** Agents consult knowledge **remotely** through commands (`index`, `cat`, `search`, `links`), with **no copy inside each agent's folder**. They're told to consult it at the start of every task and regularly while working. For the Desktop this means a soul's knowledge can be browsed live, at its accepted state, from one shared place.

### 5.2 Messaging, specifically

- Each instance gets a messaging **identity** (its address).
- By default it's in the workspace's **default team**. It can **join** other eligible teams (from its labels) at spawn or later, and **leave** them. The default team can't be left.
- Joined teams currently **check mail between tasks**; live delivery for joined teams is **(planned)**.
- A stopped agent can be **woken** by a message.

---

## 6. Instances: lifecycle and work

### 6.1 Lifecycle

```
preview → spawn → (start / restart / attach) → … → retire
```

- **Spawn** creates the instance folder, copies the capabilities in, records provenance, and optionally starts a session.
- **Start / restart** runs the session (in tmux or Herdr), with a **harness** (Claude, Codex or Pi) and a model.
- **Attach** opens the live terminal.
- **Retire** preserves any unfinished work, runs each capability's cleanup (e.g. revokes the messaging identity), and removes the folder.

### 6.2 Work modes (where the agent works)

| Mode | Meaning |
|---|---|
| **worktree** | its own branch in a clone of the soul's repo (isolated) |
| **checkout** | the shared current branch (for coordinators) |
| **attached** | another instance's work tree (a helper inside a parent's work) |
| **directory** | an independent folder, no Git |
| **workspace** | a read view across all member repos (cross-repo coordination) |

### 6.3 Relationships between instances

Instances form a **hierarchy**: a **child** works for its parent, a **sibling** is a peer, a **parent** oversees. The Desktop's roster is this tree.

### 6.4 Provenance and drift: the "what is this agent made of?" answer

Each instance records **exactly** what it was built from: every capability's source (repo or package), commit and fingerprint, plus the soul's own commit. A running instance **never changes under itself**.

When the workspace moves on (a member pushes, a package version is bumped), existing instances show **drift**: `current`, `moved` (a newer version exists) or `missing` (no longer available). New spawns get the new state.

**Design implication:** drift is **information, not an error.** Show it gently ("built from an older version of X; new spawns use the new one") with a clear path to re-spawn.

### 6.5 Terminology the UI should use

- **Harness**, not "runtime" (Claude, Codex, Pi).
- **Core capabilities**, not "layers".
- **Soul / instance**, not "agent type / agent" (though "agent" is fine in casual copy).
- **Repo-owned** capability: usable only by souls of its own repo.

---

## 7. What the Desktop is for (the principle)

**The kernel is the model; the Desktop renders it and drives it.** Everything the Desktop shows comes from the `oats` CLI's JSON (status, workspace status, inspect, capabilities, spawn preview). The Desktop never keeps its own copy of the setup, never guesses, and gates features on what the installed CLI *declares*, not on version numbers.

**So the design should answer, at a glance:**

1. **What is my workspace?** Its members (and their handshake state), its packages (and versions), its teams.
2. **Who are my agents?** Souls (what roles exist, grouped by team/repo) and instances (what's running, their hierarchy, their state).
3. **What is this agent made of, and why?** Its composition, with each capability's source and reason (workspace/team/soul), its core capabilities, harness and work mode.
4. **Where does it work?** Its work mode, branch, and repo; its Git state and pull requests.
5. **Who can it talk to?** Its messaging identity, the workspace's default team, eligible teams, joined teams.
6. **What does it know?** Its knowledge nodes (owned/read). **(planned)** A live browser of them.
7. **Is anything wrong?** Unconfirmed members, missing clones, team conflicts, drift, readiness problems, each with the plain cause and the fix.

**The Desktop today already has** (0.27.x): a Workspace area (souls, capabilities with *workspace-owned / packages / repo-owned* sections, a **Setup** graph of *this computer → workspace → repos/packages*), soul pages and capability pages, a spawn dialog (with a Teams row), instance side panels (*Instance · Soul · Git & GitHub*), a live Teams panel, and terminals. The redesign is about making this **legible and professional**, not inventing new concepts.

---

## 8. Why the architecture is like this (the reasoning to carry into the design)

- **Git is the source of truth.** Organisations already review, permission and history their repos. OATS reuses that instead of inventing an admin console. → *The Desktop shows and edits declarations; it doesn't hide settings in the app.*
- **No installs, only copies with receipts.** Every agent's folder is self-contained and records its sources. → *"Where did this come from?" always has an exact answer. Surface it.*
- **Members are live; packages are pinned.** Your own work moves fast; shared tooling doesn't shift under you. → *Always show a capability's source tier and version.*
- **Membership is trust.** Joining a workspace is a two-sided, reviewable act in Git. → *Membership state is a first-class, visible status, not a hidden error.*
- **Exactly one memory, one address book, one task list per agent.** → *The core capabilities are a distinct, fixed-shape section of every soul.*
- **Teams organise; they don't restrict.** → *Don't design teams as permissions or walls.*
- **Nothing changes under a running agent.** → *Drift is calm information with a re-spawn path.*
- **Per-machine vs shared is explicit.** → *Clearly separate "this computer" from "the organisation's setup".*

---

## 9. Glossary

- **Workspace**: the organisation's shared agent setup (one `oats-workspace.yaml`).
- **Host repo**: the member repo that holds `oats-workspace.yaml`.
- **Member**: a repo that completed the two-way handshake.
- **Deployment**: one machine's folder that runs the workspace (`oats-local.yaml` + lock + instances).
- **Soul**: a durable agent role (a folder with `soul.yaml`, `AGENTS.md`, skills).
- **Instance**: a working incarnation of a soul (folder + task + session).
- **Capability**: a reusable bundle (skills, instructions, commands, hooks).
- **Core capability**: knowledge, messaging or tasks: one slot each per soul.
- **Package**: a versioned, pinned bundle of capabilities.
- **Official catalog**: the reviewed list of official packages and versions.
- **Lock**: the exact commit + fingerprint of each package, per deployment.
- **Team (label)**: an organising label; supplies defaults and eligible messaging teams.
- **Default team**: the workspace's messaging team, which every instance is in by default.
- **Harness**: what runs the agent session (Claude, Codex, Pi).
- **Work mode**: where an instance works (worktree, checkout, attached, directory, workspace).
- **Drift**: an instance built from an older state than the workspace's current one.
- **Repo-owned capability**: usable only by souls of its own repo.
- **Accepted knowledge**: knowledge merged into its base's accepted branch.

**Further reading (technical):** `docs/workspaces.md`, `docs/souls-and-instances.md`, `docs/capabilities.md`, `docs/desktop-cli-api.md`, and the Desktop Phase F boundary `docs/design/2026-09-24-desktop-phase-f-boundary.md`.
