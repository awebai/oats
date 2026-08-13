#!/usr/bin/env node
/** OATS spawn briefing for the Linear tasks integration. Makes no API calls. */
const output = (value) => {
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exit(0);
};

const event = process.env.OATS_EVENT || process.argv[2];
if (event !== "spawn") output({ warning: `oats-linear: unknown event "${event}" (expected spawn)` });

let settings = {};
try { settings = JSON.parse(process.env.OATS_SETTINGS || "{}"); }
catch { output({ warning: "oats-linear: integrations.linear.settings is not valid JSON" }); }

const instance = process.env.OATS_INSTANCE || "unknown-instance";
const team = settings.team;
const project = settings.project;
const label = `agent-${instance}`;
const target = team
  ? `team ${team}${project ? `, default project ${project}` : ""}`
  : "team unset — ask your human, or set integrations.linear.settings.team in oats-config.yaml";
const warnings = [];
if (!team) warnings.push("settings.team is unset");
if (!process.env.LINEAR_API_KEY) warnings.push("LINEAR_API_KEY is not in the spawn environment");

output({
  meta: { label, ...(team ? { team } : {}), ...(project ? { project } : {}) },
  brief: `Tasks: Linear — ${target}. Your agent identity is label "${label}"; keep the human assignee unchanged. Load the linear-tasks skill before touching issues.`,
  ...(warnings.length ? {
    warning: `oats-linear: ${warnings.join("; ")} — see capabilities/oats-linear/README.md`,
  } : {}),
});
