// Northwind test fixture — workspace-model v2 (module contracts §7).
//
// Builds the imaginary company from docs/design/2026-09-23-simplified-workspace-model.md
// as real bare Git repositories under <baseDir>/remotes/, so every v2 kernel module
// (remote, workspace, resolve, packages, materialize) can be tested against actual
// remotes without ever touching a network or invoking bare `oats setup`.
//
//   remotes/agents.git       workspace host: oats-workspace.yaml + membership (team global)
//   remotes/platform.git     member, team engineering: platform-engineer, platform-reviewer
//   remotes/data.git         member, team engineering: data-analyst + nw-warehouse-access (executable)
//   remotes/marketing.git    member, team marketing: campaign-writer, positioning-analyst + 2 capabilities
//   remotes/nw-tools.git     member, team engineering: tools-expert + nw-tools-dev — AND publishes package
//                            nw.tools v0.4.0 under oats-package/ (nw-lint, nw-deploy with bin/), tag v0.4.0;
//                            the workspace pins it as `nw.tools: git:<nw-tools ref>@v0.4.0` (non-collapse rule)
//   remotes/knowledge.git    a store (not a member): README only
//   remotes/experts.git      external (pinned by full OID in `external:`): security-reviewer
//   remotes/pkg-okf.git      package oats.okf v2.1.3 → capability oats.okf (layer knowledge, commands, binding)
//   remotes/pkg-framework.git package oats.framework v1.1.3 → capability oats.core (skill + inject)
//
// Deliberate divergences from the worked example (contract §7 mandates exactly two
// catalog package repos): `defaults.messaging`/`defaults.tasks` are `none` and
// `packages:` carries no oats.aweb/oats.jira, so support-triager has no `tasks:`
// line; `from:` values are `local//abs/…` keys (local remotes), not `northwind/<repo>`;
// `external.source` pins a full 40-hex OID (the contract requires it; the example is loose).
//
// Determinism: fixed author/committer identity and dates, hermetic git config
// (no global/system config, no default excludes/attributes file, no signing, no
// prompts). Repos whose content embeds
// no baseDir path (packages, experts, knowledge, members without a workspace
// reference) hash identically wherever they are built; the workspace host and
// the members' oats-membership.yaml embed `file://<baseDir>/…` repo refs, so
// their OIDs are identical for identical baseDir (the contract forbids absolute
// *paths* in the workspace file; a file:// URL is the URL form of a local remote
// and is how tests build remotes — see §1 of the module contract).

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { oatsError } from "../../../lib/errors.mjs";

const execFile = promisify(execFileCb);

export const AUTHOR = { name: "Northwind Fixture", email: "fixture@northwind.test" };
export const BASE_DATE = "2026-09-23T09:00:00Z";
/** Every scenario commit (moveMember/dropBacklink) advances from here by one minute per call. */
const MOVE_DATE_EPOCH = Date.parse("2026-09-24T09:00:00Z") / 1000;

const MEMBER_NAMES = ["agents", "platform", "data", "marketing", "nw-tools"];
const STORE_NAMES = ["knowledge"];
const EXTERNAL_NAMES = ["experts"];
const PACKAGE_NAMES = ["pkg-okf", "pkg-framework"];
export const REPO_NAMES = [...MEMBER_NAMES, ...STORE_NAMES, ...EXTERNAL_NAMES, ...PACKAGE_NAMES];

export const PACKAGE_TAGS = { "pkg-okf": "v2.1.3", "pkg-framework": "v1.1.3", "nw-tools": "v0.4.0" };

/* ───────────────────────────── git plumbing ───────────────────────────── */

function gitEnv(date) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: os.devNull,
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

async function git(cwd, args, { date = BASE_DATE } = {}) {
  try {
    const { stdout } = await execFile(
      "git",
      [
        "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.symlinks=true", "-c", "init.defaultBranch=main",
        // No detached background writers: an auto-gc or auto-maintenance child can outlive the command
        // and race the fixture's temp-dir removal (ENOTEMPTY on .git/info, CI 2026-09-24).
        "-c", "gc.auto=0", "-c", "maintenance.auto=false",
        // GIT_CONFIG_GLOBAL=/dev/null does NOT disable the DEFAULT excludes/attributes files
        // (~/.config/git/ignore, ~/.config/git/attributes); an operator's `bin/` or `*.json` ignore
        // would silently drop fixture files from the trees.
        "-c", `core.excludesFile=${os.devNull}`, "-c", `core.attributesFile=${os.devNull}`,
        ...args,
      ],
      { cwd, env: gitEnv(date), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (e) {
    throw oatsErrorWithDetails("E_FIXTURE_GIT", `git ${args[0]} failed in ${cwd}: ${(e.stderr || e.message || "").trim()}`, {
      cwd,
      args,
      stderr: e.stderr,
      exitCode: e.code,
    });
  }
}

function oatsErrorWithDetails(code, message, details) {
  const e = oatsError(code, message, details);
  e.details = details;
  return e;
}

/* ───────────────────────────── file tree writer ───────────────────────── */

/**
 * spec: { "<relpath>": string | Buffer | { json } | { yaml } | { text, mode } | { symlink } }
 * Text files are written verbatim; `mode: 0o755` marks executables; `symlink`
 * creates a relative symbolic link (the CLAUDE.md → AGENTS.md alias).
 */
async function writeTree(root, spec) {
  for (const rel of Object.keys(spec).sort()) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const entry = spec[rel];
    if (typeof entry === "string" || Buffer.isBuffer(entry)) {
      await fs.writeFile(abs, entry);
    } else if (entry.symlink !== undefined) {
      await fs.symlink(entry.symlink, abs);
    } else if (entry.json !== undefined) {
      await fs.writeFile(abs, JSON.stringify(entry.json, null, 2) + "\n");
    } else if (entry.yaml !== undefined) {
      await fs.writeFile(abs, YAML.stringify(entry.yaml, { lineWidth: 0 }));
    } else {
      await fs.writeFile(abs, entry.text);
      if (entry.mode) await fs.chmod(abs, entry.mode);
    }
  }
}

/* ───────────────────────────── repo refs ──────────────────────────────── */

/** The repo ref other modules receive: an absolute bare-repo path (contract §1 accepts these). */
export function bareRepoPath(baseDir, name) {
  return path.resolve(baseDir, "remotes", `${name}.git`);
}

/** The `file://` URL form of the same remote — the form embedded in the fixture's YAML files. */
export function repoRef(barePath) {
  return pathToFileURL(barePath).href;
}

/** Canonical key of a local remote per contract §1: `local/<abs-path>`. */
export function repoKey(barePath) {
  return `local/${path.resolve(barePath)}`;
}

/* ───────────────────────────── content ────────────────────────────────── */

function soulDir(prefix, { soul, agents, skills }) {
  const spec = {
    [`${prefix}/soul.yaml`]: { yaml: soul },
    [`${prefix}/AGENTS.md`]: agents,
    [`${prefix}/CLAUDE.md`]: { symlink: "AGENTS.md" },
  };
  for (const [name, body] of Object.entries(skills)) {
    spec[`${prefix}/skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: ${body.description}\n---\n\n${body.text}\n`;
  }
  return spec;
}

function skill(name, description, text) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${text}\n`;
}

function tinyScript(label, extra = "") {
  return {
    mode: 0o755,
    text: `#!/usr/bin/env node
// ${label} — a tiny real executable for fixture tests. Prints what it was asked.
const [cmd = "help", ...rest] = process.argv.slice(2);
${extra}process.stdout.write(JSON.stringify({ tool: ${JSON.stringify(label)}, cmd, args: rest }) + "\\n");
`,
  };
}

function membership(workspaceRef, team) {
  return { yaml: { schemaVersion: 2, workspace: workspaceRef, team } };
}

function agentsRepo({ refs, keys, expertsCommit }) {
  const workspaceRef = refs.agents;
  return {
    "oats-workspace.yaml": {
      yaml: {
        schemaVersion: 2,
        name: "northwind",
        members: [refs.agents, refs.platform, refs.data, refs.marketing, refs["nw-tools"]],
        // Two forms, no third: bare versions resolve through the catalog; nw.tools is a direct git ref
        // (its repo is ALSO a member — membership does not turn the package into a latest-state capability).
        packages: { "oats.framework": "v1.1.3", "oats.okf": "v2.1.3", "nw.tools": `git:${refs["nw-tools"]}@${PACKAGE_TAGS["nw-tools"]}` },
        teams: {
          global: { description: "Org-wide souls and house capabilities" },
          engineering: { description: "Platform, data and release automation" },
          marketing: { description: "Campaigns, content and positioning" },
        },
        defaults: {
          capabilities: {
            "oats.core": { from: "package" },
            "nw-house-style": { from: keys.agents },
          },
          knowledge: { "oats.okf": { from: "package" } },
          messaging: "none",
          tasks: "none",
          byTeam: {
            engineering: { capabilities: { "nw-release-tooling": { from: keys.agents } } },
            marketing: { capabilities: { "nw-brand-voice": { from: keys.marketing } } },
          },
        },
        stores: { org: refs.knowledge },
        messaging: { private: "per-human", channels: ["northwind-eng", "northwind-mkt"] },
        external: [{ source: `${refs.experts}@${expertsCommit}`, soul: "souls/security-reviewer" }],
      },
    },
    "oats-membership.yaml": membership(workspaceRef, "global"),
    ...soulDir("souls/release-manager", {
      soul: {
        schemaVersion: 2,
        name: "release-manager",
        description: "Cuts, verifies and announces platform releases.",
        work: "worktree",
        team: "engineering",
        // nw-deploy comes from the PACKAGE, never `from: <nw-tools key>` — even though nw-tools is a member.
        capabilities: { "nw-release-tooling": { from: "here" }, "nw-deploy": { from: "package" } },
        knowledge: { owns: "release-manager", reads: ["platform-engineer", "data-analyst"] },
        messaging: { channels: ["northwind-eng"] },
      },
      agents: "# release-manager\n\nYou cut, verify and announce platform releases for Northwind.\n",
      skills: { "release-checklist": { description: "Walk the release checklist before cutting a release.", text: "1. Verify CI is green.\n2. Cut the tag.\n3. Announce." } },
    }),
    ...soulDir("souls/support-triager", {
      soul: {
        schemaVersion: 2,
        name: "support-triager",
        description: "Triages inbound support issues into Jira.",
        work: "directory",
        capabilities: { "nw-house-style": "off" },
        knowledge: "none",
      },
      agents: "# support-triager\n\nYou triage inbound support issues.\n",
      skills: { "triage-issue": { description: "Classify and route an inbound support issue.", text: "Read, classify, route." } },
    }),
    "capabilities/nw-release-tooling/oats.json": {
      json: {
        capability: "nw-release-tooling",
        team: "engineering",
        version: "0.0.0-workspace",
        description: "Northwind release checklist, changelog and tag automation.",
        compatibility: { oats: ">=0.24.0" },
        requires: ["oats.core"],
        skills: ["skills/cut-release"],
        inject: "injects/release-policy.md",
        commands: { cut: "bin/nw-release.mjs cut", verify: "bin/nw-release.mjs verify" },
      },
    },
    "capabilities/nw-release-tooling/skills/cut-release/SKILL.md": skill("cut-release", "Cut a Northwind release with the house tooling.", "Run `nw-release cut`, then `nw-release verify`."),
    "capabilities/nw-release-tooling/injects/release-policy.md": "## Release policy\n\nEvery release is cut from main, tagged, and announced in #northwind-eng.\n",
    "capabilities/nw-release-tooling/bin/nw-release.mjs": tinyScript("nw-release"),
    "capabilities/nw-house-style/oats.json": {
      json: {
        capability: "nw-house-style",
        version: "0.0.0-workspace",
        description: "Northwind house style for every agent's prose.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        inject: "injects/house-style.md",
      },
    },
    "capabilities/nw-house-style/injects/house-style.md": "## House style\n\nShort sentences. Active voice. Name the repo you mean.\n",
  };
}

function platformRepo({ refs }) {
  return {
    "src/index.mjs": "export const platform = 'northwind';\n",
    "oats-membership.yaml": membership(refs.agents, "engineering"),
    ...soulDir("souls/platform-engineer", {
      soul: {
        schemaVersion: 2,
        name: "platform-engineer",
        description: "Implements platform features on a branch and opens PRs.",
        work: "worktree",
        capabilities: {},
        knowledge: { owns: "platform-engineer", reads: ["release-manager"] },
      },
      agents: "# platform-engineer\n\nYou implement platform features on a branch and open PRs.\n",
      skills: { "open-pr": { description: "Open a reviewable PR against main.", text: "Branch, commit, push, open PR." } },
    }),
    ...soulDir("souls/platform-reviewer", {
      soul: {
        schemaVersion: 2,
        name: "platform-reviewer",
        description: "Reviews platform PRs; internal to this repo.",
        work: "checkout",
        capabilities: {},
        knowledge: { owns: "platform-reviewer" },
      },
      agents: "# platform-reviewer\n\nYou review platform PRs from within the platform repo.\n",
      skills: { "review-pr": { description: "Review a platform PR for correctness and direction.", text: "Read the diff; comment; approve or return." } },
    }),
  };
}

function dataRepo({ refs }) {
  return {
    "warehouse/README.md": "# warehouse\n\nAnalytics models.\n",
    "oats-membership.yaml": membership(refs.agents, "engineering"),
    ...soulDir("souls/data-analyst", {
      soul: {
        schemaVersion: 2,
        name: "data-analyst",
        description: "Answers questions against the warehouse with attributable evidence.",
        work: "directory",
        capabilities: { "nw-warehouse-access": { from: "here" } },
        knowledge: { owns: "data-analyst" },
      },
      agents: "# data-analyst\n\nYou answer questions against the warehouse with attributable evidence.\n",
      skills: { "attribute-evidence": { description: "Attach a query and row count to every claim.", text: "Every number cites its query." } },
    }),
    "capabilities/nw-warehouse-access/oats.json": {
      json: {
        capability: "nw-warehouse-access",
        team: "engineering",
        version: "0.0.0-workspace",
        description: "Read access to the Northwind warehouse.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/query-warehouse"],
        commands: { query: "bin/nw-wh.mjs query" },
      },
    },
    "capabilities/nw-warehouse-access/skills/query-warehouse/SKILL.md": skill("query-warehouse", "Query the Northwind warehouse.", "Run `nw-wh query <sql>`."),
    "capabilities/nw-warehouse-access/bin/nw-wh.mjs": tinyScript("nw-wh"),
  };
}

function marketingRepo({ refs, keys }) {
  return {
    "campaigns/README.md": "# campaigns\n",
    "oats-membership.yaml": membership(refs.agents, "marketing"),
    ...soulDir("souls/campaign-writer", {
      soul: {
        schemaVersion: 2,
        name: "campaign-writer",
        description: "Drafts launch campaigns from what engineering is actually shipping.",
        work: "directory",
        capabilities: {
          "nw-campaign-metrics": { from: "here" },
          "nw-release-tooling": { from: keys.agents },
        },
        knowledge: { owns: "campaign-writer", reads: ["release-manager", "platform-engineer"] },
        messaging: { channels: ["northwind-mkt"] },
      },
      agents: "# campaign-writer\n\nYou draft launch campaigns from what engineering is actually shipping.\n",
      skills: { "draft-campaign": { description: "Draft a launch campaign from a release note.", text: "Read the release; write the campaign." } },
    }),
    ...soulDir("souls/positioning-analyst", {
      soul: {
        schemaVersion: 2,
        name: "positioning-analyst",
        description: "Analyses market positioning against competitors.",
        work: "directory",
        capabilities: { "nw-campaign-metrics": { from: "here" } },
        knowledge: { owns: "positioning-analyst" },
      },
      agents: "# positioning-analyst\n\nYou analyse Northwind's positioning against competitors.\n",
      skills: { "compare-positioning": { description: "Compare positioning statements across competitors.", text: "Collect, compare, conclude." } },
    }),
    "capabilities/nw-brand-voice/oats.json": {
      json: {
        capability: "nw-brand-voice",
        team: "marketing",
        version: "0.0.0-workspace",
        description: "Northwind brand voice guidance and tone checks.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        inject: "injects/brand-voice.md",
        skills: ["skills/tone-check"],
      },
    },
    "capabilities/nw-brand-voice/injects/brand-voice.md": "## Brand voice\n\nConfident, concrete, never breathless.\n",
    "capabilities/nw-brand-voice/skills/tone-check/SKILL.md": skill("tone-check", "Check a draft against the Northwind brand voice.", "Read the draft aloud; strike every superlative."),
    "capabilities/nw-campaign-metrics/oats.json": {
      json: {
        capability: "nw-campaign-metrics",
        team: "marketing",
        version: "0.0.0-workspace",
        description: "Queries the ads APIs for campaign metrics.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/campaign-report"],
        commands: { report: "bin/nw-cm.mjs report" },
      },
    },
    "capabilities/nw-campaign-metrics/skills/campaign-report/SKILL.md": skill("campaign-report", "Produce a campaign metrics report.", "Run `nw-cm report <campaign>`."),
    "capabilities/nw-campaign-metrics/bin/nw-cm.mjs": tinyScript("nw-cm"),
  };
}

function nwToolsRepo({ refs }) {
  return {
    "README.md": "# nw-tools\n\nNorthwind's own tooling: a member repo that ALSO publishes the `nw.tools` package.\n",
    "oats-membership.yaml": membership(refs.agents, "engineering"),
    ...soulDir("souls/tools-expert", {
      soul: {
        schemaVersion: 2,
        name: "tools-expert",
        description: "Knows the nw.tools package — its manifests, executables, release tags and consumers; evolves it through PRs.",
        work: "worktree",
        capabilities: {
          "nw-tools-dev": { from: "here" },
          "nw-lint": { from: "package" },
        },
        knowledge: { owns: "tools-expert", reads: ["release-manager"] },
      },
      agents: "# tools-expert\n\nYou know the nw.tools package and evolve it through PRs.\n",
      skills: { "cut-tools-release": { description: "Tag and publish a new nw.tools version.", text: "Bump oats-package.json, tag vX.Y.Z, push the tag." } },
    }),
    // member-tier: latest state, for people working ON nw-tools
    "capabilities/nw-tools-dev/oats.json": {
      json: {
        capability: "nw-tools-dev",
        team: "engineering",
        version: "0.0.0-workspace",
        description: "Developer conventions for working on the nw.tools package itself.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/package-conventions"],
        inject: "injects/nw-tools-dev.md",
      },
    },
    "capabilities/nw-tools-dev/skills/package-conventions/SKILL.md": skill("package-conventions", "Follow nw.tools package conventions when editing manifests.", "Every capability under oats-package/capabilities/ lists its executables in `commands`."),
    "capabilities/nw-tools-dev/injects/nw-tools-dev.md": "## nw-tools development\n\nYou work on the package source; consumers see it only through the pinned version.\n",
    // package-tier: consumed only through packages: (git:<ref>@v0.4.0), locked (commit + integrity)
    "oats-package/oats-package.json": {
      json: {
        package: "nw.tools",
        version: "0.4.0",
        description: "Northwind's lint and deploy tooling.",
        compatibility: { oats: ">=0.24.0" },
        capabilities: ["capabilities/nw-lint", "capabilities/nw-deploy"],
      },
    },
    "oats-package/capabilities/nw-lint/oats.json": {
      json: {
        capability: "nw-lint",
        version: "0.4.0",
        description: "House lint rules for Northwind repositories.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/lint"],
      },
    },
    "oats-package/capabilities/nw-lint/skills/lint/SKILL.md": skill("lint", "Lint a Northwind repository with the house rules.", "Run the linter; fix every finding before opening a PR."),
    "oats-package/capabilities/nw-deploy/oats.json": {
      json: {
        capability: "nw-deploy",
        version: "0.4.0",
        description: "Deploys Northwind services; carries an executable (bin/nw-deploy.mjs).",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/deploy"],
        commands: { plan: "bin/nw-deploy.mjs plan", apply: "bin/nw-deploy.mjs apply" },
      },
    },
    "oats-package/capabilities/nw-deploy/skills/deploy/SKILL.md": skill("deploy", "Plan and apply a Northwind deployment.", "Run `nw-deploy plan`, review, then `nw-deploy apply`."),
    "oats-package/capabilities/nw-deploy/bin/nw-deploy.mjs": tinyScript("nw-deploy"),
  };
}

function knowledgeRepo() {
  return {
    "README.md": "# Northwind knowledge\n\nThe shared OKF knowledge base — a store, not a member. Publication is PR-only.\n",
  };
}

function expertsRepo() {
  return soulDir("souls/security-reviewer", {
    soul: {
      schemaVersion: 2,
      name: "security-reviewer",
      description: "Reviews changes for security regressions.",
      work: "worktree",
      capabilities: {},
      compatibility: { "oats.okf": ">=2.1" },
    },
    agents: "# security-reviewer\n\nYou review changes for security regressions. Written by oss-collective.\n",
    skills: { "threat-model": { description: "Build a threat model for a change.", text: "Assets, actors, entry points, mitigations." } },
  });
}

function pkgFrameworkRepo() {
  return {
    "README.md": "# oats.framework (fixture)\n",
    "oats-package/oats-package.json": {
      json: {
        package: "oats.framework",
        version: "1.1.3",
        description: "Explicit OATS operation guidance (fixture edition).",
        compatibility: { oats: ">=0.24.0" },
        capabilities: ["capabilities/oats-core"],
      },
    },
    "oats-package/capabilities/oats-core/oats.json": {
      json: {
        capability: "oats.core",
        version: "1.0.1",
        description: "Explicit OATS operation, soul discovery and lifecycle guidance; no fundamental-layer or executable authority.",
        compatibility: { oats: ">=0.24.0" },
        requires: [],
        skills: ["skills/oats-operate"],
        inject: "injects/oats.md",
        helperInjection: { version: 1, mode: "inherit" },
      },
    },
    "oats-package/capabilities/oats-core/skills/oats-operate/SKILL.md": skill("oats-operate", "Use when operating OATS instances: spawn, status, retire, doctor.", "Load the oats skill before the first `oats` command of a session."),
    "oats-package/capabilities/oats-core/injects/oats.md": "## You run on OATS\n\nYou are an agent instance in the OATS framework (fixture inject).\n",
  };
}

function pkgOkfRepo() {
  return {
    "README.md": "# oats.okf (fixture)\n",
    "oats-package/oats-package.json": {
      json: {
        package: "oats.okf",
        version: "2.1.3",
        description: "OKF knowledge layer (fixture edition).",
        compatibility: { oats: ">=0.24.4" },
        capabilities: ["capabilities/oats-okf"],
      },
    },
    "oats-package/capabilities/oats-okf/oats.json": {
      json: {
        capability: "oats.okf",
        command: "okf",
        version: "2.1.3",
        compatibility: { oats: ">=0.24.4" },
        layer: "knowledge",
        description: "External OKF bases with owned nodes and immutable reader views (fixture edition).",
        requires: [],
        settings: {
          "harvest-runtime": { default: "pi", values: ["pi", "claude", "codex"], description: "Harness for the memory harvester." },
          "bindings-file": { description: "Absolute host-owned path identifying the version:1 bindings document." },
          "state-dir": { description: "Absolute host-owned durable state directory for portable bindings." },
          // Decision 27 (K1″): a host fact only oats-local.yaml may supply — the resolver refuses it elsewhere.
          "custody-root": { description: "Absolute host-owned custody directory (fixture edition of a hostOnly key).", hostOnly: true },
        },
        skills: ["skills/okf"],
        commands: {
          harvest: "bin/oats-okf.mjs harvest",
          inspect: "bin/oats-okf.mjs inspect",
          "binding-normalize": "bin/oats-okf.mjs binding-normalize",
          "binding-bind": "bin/oats-okf.mjs binding-bind",
          "binding-check": "bin/oats-okf.mjs binding-check",
          status: "bin/oats-okf.mjs status",
          reindex: "bin/oats-okf.mjs reindex",
        },
        // Provider operations (a home view and a home action) so inspect lists them
        // and `oats operation run` yields a real envelope (Desktop F3b-2 captures).
        operations: {
          status: { kind: "view", command: "status", context: "home", description: "This instance's knowledge status" },
          reindex: { kind: "action", command: "reindex", context: "home", description: "Rebuild this instance's knowledge index",
            args: [{ name: "scope", flag: "--scope", required: false, description: "Limit the reindex to one node" }] },
        },
        binding: {
          version: 1,
          normalize: "binding-normalize",
          bind: "binding-bind",
          check: "binding-check",
          reasons: [
            "setting bindings-file is required (absolute host path)",
            "setting state-dir is required (absolute host path)",
            "setting harvest-runtime must be pi, claude or codex",
          ],
        },
        inject: "injects/okf.md",
        helperInjection: { version: 1, mode: "omit" },
        hooks: { spawn: { command: "bin/oats-okf.mjs spawn", required: true }, retire: { command: "bin/oats-okf.mjs retire" } },
      },
    },
    "oats-package/capabilities/oats-okf/skills/okf/SKILL.md": skill("okf", "Use when maintaining an OKF knowledge bundle.", "Validate after every non-trivial edit."),
    "oats-package/capabilities/oats-okf/injects/okf.md": "## Knowledge layer: OKF\n\nYour durable knowledge lives in an OKF bundle (fixture inject).\n",
    "oats-package/capabilities/oats-okf/bin/oats-okf.mjs": tinyScript(
      "oats-okf",
      `if (cmd === "binding-check") {
  // The check wire: {status, problems} from the merged settings (OATS_SETTINGS, else the request's).
  const fs = await import("node:fs");
  let req = {}; try { req = process.stdin.isTTY ? {} : JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { req = {}; }
  let settings = {}; try { settings = JSON.parse(process.env.OATS_SETTINGS || "null") ?? req.settings ?? {}; } catch { settings = req.settings ?? {}; }
  const problems = typeof settings["state-dir"] === "string" && settings["state-dir"] ? [] : [{ code: "needs-configuration", message: "setting state-dir is required (absolute host path)" }];
  process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: req.slot ?? "knowledge", capability: req.capability ?? "oats.okf", ok: true,
    result: { status: problems.length ? "needs-configuration" : "ready", problems } }) + "\\n");
  process.exit(0);
}
if (cmd.startsWith("binding-")) {
  // A real but minimal binding contract: normalize → bind succeed.
  process.stdout.write(JSON.stringify({ ok: true, action: cmd, args: rest }) + "\\n");
  process.exit(0);
}
if (cmd === "status") {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { summary: "fixture knowledge status",
    documents: [{ label: "Status", kind: "markdown", text: "# okf status\\n\\nInstance: " + (process.env.OATS_INSTANCE || "none") + "\\n" }] } }) + "\\n");
  process.exit(0);
}
if (cmd === "reindex") {
  const i = rest.indexOf("--scope");
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { status: "reindexed", scope: i >= 0 ? rest[i + 1] ?? null : null } }) + "\\n");
  process.exit(0);
}
if (cmd === "spawn" && process.env.OATS_INSTANCE_HOME) {
  // Record the identity the kernel handed the hook (what a real provider keys durable state on).
  (await import("node:fs")).writeFileSync(process.env.OATS_INSTANCE_HOME + "/.okf-hook-env.json", JSON.stringify({ OATS_SOUL: process.env.OATS_SOUL, OATS_SOUL_ID: process.env.OATS_SOUL_ID, OATS_AGENT: process.env.OATS_AGENT, OATS_TEAM_ID: process.env.OATS_TEAM_ID, OATS_TEAM_SCOPE: process.env.OATS_TEAM_SCOPE, OATS_TEAM_LABEL: process.env.OATS_TEAM_LABEL, OATS_WORKSPACE_NAME: process.env.OATS_WORKSPACE_NAME, OATS_WORKSPACE_KEY: process.env.OATS_WORKSPACE_KEY }));
}
`,
    ),
  };
}

/* ───────────────────────────── build ──────────────────────────────────── */

async function initBare(barePath) {
  await fs.mkdir(path.dirname(barePath), { recursive: true });
  await git(path.dirname(barePath), ["init", "-q", "--bare", "-b", "main", barePath]);
  await git(barePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
}

async function withClone(barePath, fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "northwind-clone-"));
  try {
    // `git clone` of an empty bare repo warns on stderr but succeeds; HEAD follows the bare's symbolic ref.
    await git(tmp, ["clone", "-q", "--no-hardlinks", barePath, "work"]);
    const work = path.join(tmp, "work");
    await git(work, ["checkout", "-q", "-B", "main"]);
    return await fn(work);
  } finally {
    // git may still be finishing a write under .git/ (a detached auto-gc or an
    // index lock) when the clone's last command returns; a single rmdir then
    // races it and fails ENOTEMPTY (seen on CI, 2026-09-24). Retry, bounded.
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function commitAll(work, message, date) {
  await git(work, ["add", "-A"]);
  await git(work, ["commit", "-q", "--allow-empty", "-m", message], { date });
  await git(work, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  return git(work, ["rev-parse", "HEAD"]);
}

async function buildRepo(barePath, spec, { message, tag }) {
  await initBare(barePath);
  return withClone(barePath, async (work) => {
    await writeTree(work, spec);
    const commit = await commitAll(work, message, BASE_DATE);
    if (tag) {
      await git(work, ["tag", tag, commit]);
      await git(work, ["push", "-q", "origin", `refs/tags/${tag}`]);
    }
    return commit;
  });
}

/**
 * Build the Northwind fixture under baseDir. Returns
 *   { baseDir, remotesDir, refs: { <name>: <abs bare path> }, keys: { <name>: "local/<abs path>" },
 *     urls: { <name>: "file:///…" }, commits: { <name>: <40-hex> }, tags: { "pkg-okf": { tag, commit }, "nw-tools": { tag: "v0.4.0", commit }, … },
 *     catalog: { "oats.okf": { url, ref: "v2.1.3", path: "oats-package" }, "oats.framework": { url, ref: "v1.1.3", path: "oats-package" } },
 *     moves: 0 }
 * Refuses to build into a baseDir that already has a remotes/ directory (E_FIXTURE_EXISTS) or whose
 * path contains whitespace/`@` (E_FIXTURE_BASEDIR).
 */
export async function buildNorthwind(baseDir) {
  const root = path.resolve(baseDir);
  // `local/<abs path>` repo keys are embedded in `from:` values; the workspace schema's repoKey
  // forbids whitespace and `@`, so such a baseDir would build a fixture the kernel refuses.
  if (/[\s@]/.test(root)) {
    throw oatsErrorWithDetails("E_FIXTURE_BASEDIR", `fixture baseDir must not contain whitespace or "@" (repo keys embed it): ${root}`, { baseDir: root });
  }
  const remotesDir = path.join(root, "remotes");
  try {
    await fs.access(remotesDir);
    throw oatsErrorWithDetails("E_FIXTURE_EXISTS", `fixture already built under ${remotesDir}`, { remotesDir });
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const refs = {};
  const urls = {};
  const keys = {};
  for (const name of REPO_NAMES) {
    refs[name] = bareRepoPath(root, name);
    urls[name] = repoRef(refs[name]);
    keys[name] = repoKey(refs[name]);
  }

  const commits = {};
  const tags = {};

  // Repos with no cross-references first (their content embeds no path).
  commits.knowledge = await buildRepo(refs.knowledge, knowledgeRepo(), { message: "knowledge: initial store" });
  commits.experts = await buildRepo(refs.experts, expertsRepo(), { message: "experts: security-reviewer" });
  for (const name of PACKAGE_NAMES) {
    const spec = name === "pkg-okf" ? pkgOkfRepo() : pkgFrameworkRepo();
    const tag = PACKAGE_TAGS[name];
    commits[name] = await buildRepo(refs[name], spec, { message: `${name}: release ${tag}`, tag });
    tags[name] = { tag, commit: commits[name] };
  }

  // Members reference the workspace by URL; the workspace references members, store and the pinned external.
  const ctx = { refs: urls, keys, expertsCommit: commits.experts };
  commits.platform = await buildRepo(refs.platform, platformRepo(ctx), { message: "platform: join northwind" });
  commits.data = await buildRepo(refs.data, dataRepo(ctx), { message: "data: join northwind" });
  commits.marketing = await buildRepo(refs.marketing, marketingRepo(ctx), { message: "marketing: join northwind" });
  commits["nw-tools"] = await buildRepo(refs["nw-tools"], nwToolsRepo(ctx), { message: `nw-tools: join northwind; release ${PACKAGE_TAGS["nw-tools"]}`, tag: PACKAGE_TAGS["nw-tools"] });
  tags["nw-tools"] = { tag: PACKAGE_TAGS["nw-tools"], commit: commits["nw-tools"] };
  commits.agents = await buildRepo(refs.agents, agentsRepo(ctx), { message: "agents: northwind workspace" });

  // The catalog carries the two official packages ONLY: nw.tools is pinned by a direct git ref (no third form).
  const catalog = {
    "oats.okf": { url: refs["pkg-okf"], ref: PACKAGE_TAGS["pkg-okf"], path: "oats-package" },
    "oats.framework": { url: refs["pkg-framework"], ref: PACKAGE_TAGS["pkg-framework"], path: "oats-package" },
  };

  return { baseDir: root, remotesDir, refs, urls, keys, commits, tags, catalog, moves: 0 };
}

/* ───────────────────────────── scenario helpers ───────────────────────── */

function requireRepo(fixture, name) {
  const barePath = fixture?.refs?.[name];
  if (!barePath) {
    throw oatsErrorWithDetails("E_FIXTURE_UNKNOWN_REPO", `northwind fixture has no repo named ${name}`, { name, known: Object.keys(fixture?.refs ?? {}) });
  }
  return barePath;
}

/**
 * Commit a change to a member's default branch. `mutate(workDir, tools)` may be async and edits the
 * checked-out tree in place (tools = { writeTree, fs, path }). Every call advances a deterministic
 * clock by one minute so successive moves are reproducible. A no-op `mutate` still produces a
 * (tree-identical) commit — the helper is total: "moved" means "new commit", not "new content".
 * → { name, previous, commit }
 */
export async function moveMember(fixture, name, mutate, { message = `${name}: move` } = {}) {
  const barePath = requireRepo(fixture, name);
  fixture.moves = (fixture.moves ?? 0) + 1;
  const date = new Date((MOVE_DATE_EPOCH + fixture.moves * 60) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const previous = fixture.commits[name];
  const commit = await withClone(barePath, async (work) => {
    await mutate(work, { writeTree: (spec) => writeTree(work, spec), fs, path });
    return commitAll(work, message, date);
  });
  fixture.commits[name] = commit;
  return { name, previous, commit };
}

/** Remove a member's oats-membership.yaml (→ confirmMembership reason "no-backlink"). */
export async function dropBacklink(fixture, name) {
  return moveMember(
    fixture,
    name,
    async (work) => {
      await fs.rm(path.join(work, "oats-membership.yaml"), { force: true });
    },
    { message: `${name}: drop backlink` },
  );
}

/**
 * chmod 000 the bare repo (→ git ls-remote fails; confirmMembership reason "cannot-read").
 * → { name, path, restore } — call `await restore()` before removing the fixture directory.
 */
export async function makeUnreadable(fixture, name) {
  const barePath = requireRepo(fixture, name);
  await fs.chmod(barePath, 0o000);
  return {
    name,
    path: barePath,
    restore: async () => {
      await fs.chmod(barePath, 0o755);
    },
  };
}
