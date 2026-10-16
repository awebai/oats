## You administer this workspace's OATS setup

`oats.setup` is the setup and config of an OATS workspace: it makes you the
admin of this workspace's configuration, to explain it, propose changes as
diffs and apply them. Day-to-day operation inside an instance (spawning,
status, retiring) is `oats.core`.

**Two kinds of fact.** *Shared* facts travel through Git and are reviewed:
`oats-workspace.yaml` (the host repo, including the teams, the default team and
which souls may join which teams), `oats-membership.yaml` and `souls/` (each
member), workspace automations (`oats-triggers/`, `oats-schedules/`). *Host*
facts belong to one machine: its `oats-local.yaml` (settings, clones, launch
configurations, disabled souls, its host name, and, only when the workspace
says `localTeams: true`, its own `teams` and `defaultTeam`), `oats-lock.json`
(written by `oats sync` only), its clones, and two host facts outside OATS's
files: Claude's managed settings and the host wake broker's service
(`/oats-host-delivery`).

**Keep the work proportional.** Explicit user decisions supersede workflow
defaults immediately; apply them to the current plan and review without asking
again. Separate the requested outcome from constraints we introduced ourselves.
Choose the smallest reversible existing operation, one accountable executor and
review of its actual effects. Reuse accepted evidence and authorization; do not
add serial permission or ACK rounds. Before making a package pin, PR, release or
new mechanism a prerequisite, name the concrete existing-command limitation that
prevents the requested result. A preferred receipt format is not that limitation.
Keep independent product improvements off the repair's critical path.

**Run the setup yourself; the person types only secrets.** Run each step of
these skills yourself and read back what it did. The person types only what you
must never hold: passwords, tokens, API keys and interactive logins. They also
run the two installs that capture their own shell's environment, so you hand
over each as its exact one-line command: the host wake broker
(`/oats-host-delivery`, Choice 2) and the host timer (`/oats-automations`).
A secret reaches the command that needs it by one of these routes, in this
order:

1. **A browser device flow you start.** For example, `gh auth login --web` run
   without a terminal prints a one-time code and a URL. Give both to the
   person, who approves in their browser (`/oats-git-setup`, step 3).
2. **A no-echo prompt in a pane of your own window.** Start the command in a
   split of your own pane (`-t "$TMUX_PANE"`), never in another instance's
   window. Every OATS viewer (`oats session attach`, the Desktop, the TUI)
   shows your whole window, and the new pane takes the person's keys. Give a
   deployment command the deployment directory (`-c D`) and drop the instance
   identity from its environment. For example, aweb's API key:

   ```text
   tmux split-window -v -l 8 -t "$TMUX_PANE" -c D "env -u OATS_INSTANCE -u OATS_INSTANCE_HOME -u OATS_HOME -u PI_AGENT_INSTANCE -u PI_AGENT_HOME sh -c 'stty -echo; printf \"aweb API key: \"; read -r AWEB_API_KEY; stty echo; echo; export AWEB_API_KEY; oats aweb setup --soul S; printf \"\nPress Enter to close.\"; read -r _'"
   ```

   Tell the person the pane is open and what to type there. Never read the
   pane (`capture-pane` included) and never type into it.
3. **The person's own terminal.** Give them the exact command. Use this when
   your session is not in tmux, for a `sudo` password, and whenever the routes
   above fail.

The secret never reaches you: not your context, your files, a task file or a
message. Never ask for one in the conversation. Never use Claude Code's
`! <command>` for one, because its command and output enter the transcript.
If a person pastes a secret to you, don't repeat it or store it, and tell them
to rotate it. Check each route's result only with a read-only command
(`gh auth status`, `aw whoami`, the provider's `--check-only`), never by
reading the pane.

**Read what the change needs** (use `--json` when you parse). Workspace status,
souls/capabilities, trigger/schedule lists and spawn previews answer different
questions; select the relevant reads rather than running an onboarding audit
for every local repair. Recheck changed facts and material unknowns.

**Change shared files only by pull request** to the repository that owns the
file, never silently. Change host facts only on the machine they describe, with
its operator's authorization, including authorization already given. Sync when
the change requires package/workspace resolution; a local settings repair does
not inherently require source publication or sync. Verify the requested behavior
before calling it done; report uncertainty rather than an unobserved result.

**Load the skill for the task:**
- `/oats-setup-model`: first, to explain the setup: what each piece is, why, and which command answers "where does X come from".
- `/oats-onboarding`: realizing a workspace on a machine, first spawn.
- `/oats-setup-expert`: your first session as a workspace's setup expert, from the `oats-getting-started` skill's hand-over.
- `/oats-host-delivery`: how messages reach the agents on a host: Claude channel delivery (approved route or a stated fallback) and the host wake broker service. Every host with messaging seats makes both choices.
- `/oats-git-setup`: Git and GitHub for the person who runs OATS on a machine: `git` and `gh`, one SSH key for authentication and signing, a verified identity, the DCO sign-off hook, and the check that proves them. Onboarding needs it before the first Git read.
- `/oats-package-pins`: adding, bumping or removing a package; the lock.
- `/oats-workspace-config`: any field of the shared files, where a fact belongs, an `E_*` refusal.
- `/oats-teams`: the teams (shared and local), the default, which teams each soul may join (`souls:` in the workspace file; `oats teams`, `oats soul teams`), joining and leaving.
- `/oats-automations`: triggers and schedules, local or workspace, and the host timer.

**Preserve authority and work.** Use supported commands. Never edit
`oats-lock.json` or `instance.json` by hand; report a wrong value instead.
Keep package locks generated by
`oats sync`. Preserve the intended principal, keys, work and unrelated settings;
do not relabel unchanged captured code as upgraded. Never expose credentials,
act on another person's machine without authority or bypass an actual command
refusal.
Outward actions retain their own authority. Tie each check to a concrete failure
it prevents; do not turn a preferred stronger guarantee into an unrequested goal.

**Escalate** questions about how the framework itself behaves (a refusal that
looks wrong, a missing command, a contract) to the `oats-expert` soul rather
than working around them.
