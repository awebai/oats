#!/usr/bin/env node
import Ajv2020 from "ajv/dist/2020.js";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYamlFull } from "yaml";
import { checkOkfMirror } from "./check-okf-mirror.mjs";
import { checkKnowledgeTheoryPackage } from "./check-knowledge-theory-package.mjs";
import { checkReleaseVersions } from "./check-package-dry-runs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (message) => failures.push(message);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function walk(dir, accept = () => true) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, accept));
    else if (entry.isFile() && accept(path)) files.push(path);
  }
  return files;
}

// Schemas + current clean-contract artifacts.
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const manifestSchemaPath = join(root, "docs", "capability-manifest.schema.json");
const packageSchemaPath = join(root, "docs", "oats-package.schema.json");
const lockSchemaPath = join(root, "docs", "oats-lock.schema.json");
const manifestSchema = json(manifestSchemaPath);
const baseSchemas = [[manifestSchemaPath, manifestSchema], [packageSchemaPath, json(packageSchemaPath)], [lockSchemaPath, json(lockSchemaPath)]];
for (const [path, schema] of baseSchemas) {
  if (!ajv.validateSchema(schema)) fail(`${relative(root, path)} is not a valid JSON Schema: ${ajv.errorsText()}`);
}
const validateManifest = ajv.compile(manifestSchema);
// Workspace model (v2) declaration schemas — documentation examples are checked
// against the schema their shape names (see exampleKind below).
const v2Schemas = Object.fromEntries(["oats-workspace", "oats-membership", "soul", "oats-local"].map((name) => {
  const path = join(root, "docs", `${name}.schema.json`);
  const schema = json(path);
  if (!ajv.validateSchema(schema)) fail(`${relative(root, path)} is not a valid JSON Schema: ${ajv.errorsText()}`);
  return [name, ajv.compile(schema)];
}));
const validatePackage = ajv.compile(json(packageSchemaPath));
const theoryManifest = join(root, "oats-package/oats-package.json");
if (!validatePackage(json(theoryManifest))) fail(`oats-package/oats-package.json: ${ajv.errorsText(validatePackage.errors)}`);
try { checkKnowledgeTheoryPackage({ repoRoot: root }); } catch (error) { fail(`optional knowledge theory: ${error.message}`); }
try { checkOkfMirror({ repoRoot: root }); } catch (error) { fail(`standalone OKF mirror: ${error.message}`); }
try { checkReleaseVersions(root); } catch (error) { fail(`release manifests: ${error.message}`); }
let manifests = 0;
for (const path of [
  ...walk(join(root, "capabilities"), (p) => basename(p) === "oats.json"),
  ...walk(join(root, "oats-package"), (p) => basename(p) === "oats.json"),
]) {
  manifests++;
  if (!validateManifest(json(path))) fail(`${relative(root, path)}: ${ajv.errorsText(validateManifest.errors)}`);
}
// The repository is a workspace member: a work tree of it sits between an instance's
// commands and its deployment, where the kernel refuses any oats-config.yaml
// (E_CONFIG_BROKEN legacy-config). The v2 host and member files are the only root config.
if (existsSync(join(root, "oats-config.yaml"))) fail("oats-config.yaml: the 0.25 config file must not exist at the repository root — the kernel refuses it in every member work tree (oats-workspace.yaml and oats-membership.yaml are the root config)");

// Public Markdown set: local links/anchors and v2 declaration YAML examples.
const markdown = [join(root, "README.md"), ...walk(join(root, "docs"), (p) => extname(p) === ".md")];
for (const dir of walk(join(root, "capabilities"), (p) => basename(p) === "README.md")) markdown.push(dir);
markdown.push(join(root, "packages", "pi", "README.md"));
markdown.push(...walk(join(root, "oats-package"), (p) => extname(p) === ".md"));
const publicMarkdown = [...new Set(markdown.filter(existsSync))].sort();
const exampleMarkdown = [...new Set([
  ...publicMarkdown,
  ...walk(join(root, "skills"), (p) => basename(p) === "SKILL.md"),
  ...walk(join(root, "capabilities"), (p) => basename(p) === "SKILL.md"),
].filter(existsSync))].sort();

function slugHeadings(text) {
  const counts = new Map();
  const slugs = new Set();
  for (const line of text.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    let slug = match[1].toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim().replace(/\s+/g, "-");
    const count = counts.get(slug) || 0;
    counts.set(slug, count + 1);
    if (count) slug += `-${count}`;
    slugs.add(slug);
  }
  return slugs;
}
const headingCache = new Map();
function headings(path) {
  if (!headingCache.has(path)) headingCache.set(path, slugHeadings(readFileSync(path, "utf8")));
  return headingCache.get(path);
}

let links = 0;
let examples = 0;
for (const file of publicMarkdown) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let href = match[1].trim().replace(/^<|>$/g, "");
    if (!href || /^(?:https?:|mailto:|#)/.test(href)) {
      if (href.startsWith("#") && !headings(file).has(decodeURIComponent(href.slice(1)))) fail(`${relative(root, file)}: missing anchor ${href}`);
      continue;
    }
    links++;
    const [rawPath, rawAnchor] = href.split("#", 2);
    const target = resolve(dirname(file), decodeURIComponent(rawPath));
    if (!existsSync(target)) { fail(`${relative(root, file)}: broken link ${href}`); continue; }
    if (rawAnchor && lstatSync(target).isFile() && extname(target) === ".md" && !headings(target).has(decodeURIComponent(rawAnchor))) {
      fail(`${relative(root, file)}: missing anchor ${href}`);
    }
  }
}
/** Which declaration a YAML example is, by shape. A block that is only a fragment
 *  (a `# soul.yaml` comment header, a partial `capabilities:` excerpt, a mixed
 *  illustration with several files) is not a document and is skipped. */
function exampleKind(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const has = (k) => keys.includes(k);
  if (parsed.schemaVersion === 2) {
    if (has("members") || has("teams") || has("defaults") || has("stores") || has("external")) return has("name") ? "oats-workspace" : null;
    if (has("workspace") && keys.every((k) => ["schemaVersion", "workspace", "team"].includes(k))) return "oats-membership";
    if (has("workspace") || has("standalone") || has("clones") || has("settings") || has("souls")) return "oats-local";
    if (has("name") && has("description") && has("work")) return "soul";
    return null;
  }
  return null;
}
for (const file of exampleMarkdown) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/```ya?ml\s*\n([\s\S]*?)```/g)) {
    const block = match[1];
    let parsed;
    // v2 declarations use lists of mappings, which the kernel's mini parser does not
    // model; the full YAML parser reads examples. Placeholder grammar (`<slug>`, `…`)
    // fails to parse or to classify and is skipped as illustration.
    try { parsed = parseYamlFull(block); } catch { continue; }
    const kind = exampleKind(parsed);
    if (!kind) continue;
    examples++;
    const validator = v2Schemas[kind];
    if (!validator(parsed)) fail(`${relative(root, file)} YAML example #${examples} (${kind}): ${ajv.errorsText(validator.errors)}`);
  }
}

if (failures.length) {
  console.error(`Project validation failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Project validation passed: ${baseSchemas.length + Object.keys(v2Schemas).length} schemas, ${manifests} clean-contract manifests, ${examples} config examples, ${links} local links across ${publicMarkdown.length} public Markdown files.`);
