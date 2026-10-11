// Host-only provider settings in a deployment's oats-local.yaml: one entry of a
// block-style map under settings.oats.aweb (`roots`: team id → minting root,
// `residents`: resident name → custody directory). Only block-style YAML is
// edited; anything else refuses with the exact line to add by hand.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The singular a map's messages use for one of its entries. */
const ENTRY_NOUN = { roots: "root", residents: "resident" };

export const yamlQuote = (value) => JSON.stringify(String(value));
function blockEnd(lines, start, indent) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].trim() && !lines[i].startsWith(" ".repeat(indent + 1))) { end = i; break; }
  return end;
}
function ensureYamlBlock(lines, parentStart, parentEnd, indent, header) {
  const row = `${" ".repeat(indent)}${header}:`;
  for (let i = parentStart + 1; i < parentEnd; i++) if (lines[i].trimEnd() === row) return i;
  lines.splice(parentEnd, 0, row);
  return parentEnd;
}
export function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basenameForTemp(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}
function basenameForTemp(file) { return file.split(/[\\/]/).pop() || "oats-local.yaml"; }
function unsupportedLocalYaml(file, map, detail, key, value) {
  throw new Error(`${file}: cannot safely update settings.oats.aweb.${map} automatically (${detail}); add this line by hand under block-style settings.oats.aweb.${map}: ${yamlQuote(key)}: ${yamlQuote(value)}`);
}
function findBlockHeader(lines, start, end, indent, names) {
  const pad = " ".repeat(indent);
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(pad) || line.startsWith(pad + " ")) continue;
    const trimmed = line.slice(indent).trimEnd();
    for (const name of names) if (trimmed === `${name}:`) return i;
    for (const name of names) if (trimmed.startsWith(`${name}:`)) return { unsupported: i, line };
  }
  return -1;
}
/** Refuses, before any effect, when `settings.oats.aweb.<map>` could not be updated safely. */
export function assertAwebSettingRecordable(map, key, value, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const file = join(start, "oats-local.yaml");
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, map, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, key, value);
  if (settings < 0) return;
  const settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, map, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, key, value);
  if (aweb < 0) return;
  const awebEnd = blockEnd(lines, aweb, 2);
  const block = findBlockHeader(lines, aweb + 1, awebEnd, 4, [map]);
  if (typeof block === "object") unsupportedLocalYaml(file, map, `line ${block.unsupported + 1} is not a block-style ${map}: mapping`, key, value);
}
/** Sets `settings.oats.aweb.<map>[key]: value` in the deployment's oats-local.yaml. */
export function recordAwebSetting(map, entryKey, entryValue, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const noun = ENTRY_NOUN[map];
  const file = join(start, "oats-local.yaml");
  const existed = existsSync(file);
  const lines = existed ? readFileSync(file, "utf8").split(/\r?\n/) : ["schemaVersion: 2", "workspace: local"];
  while (lines.length && lines.at(-1) === "") lines.pop();
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, map, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, entryKey, entryValue);
  if (settings < 0) { lines.push("settings:"); settings = lines.length - 1; }
  let settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, map, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, entryKey, entryValue);
  if (aweb < 0) { aweb = ensureYamlBlock(lines, settings, settingsEnd, 2, "oats.aweb"); settingsEnd++; }
  let awebEnd = blockEnd(lines, aweb, 2);
  let block = findBlockHeader(lines, aweb + 1, awebEnd, 4, [map]);
  if (typeof block === "object") unsupportedLocalYaml(file, map, `line ${block.unsupported + 1} is not a block-style ${map}: mapping`, entryKey, entryValue);
  if (block < 0) { block = ensureYamlBlock(lines, aweb, awebEnd, 4, map); awebEnd++; }
  const blockEndIndex = blockEnd(lines, block, 4);
  const key = yamlQuote(entryKey), value = yamlQuote(entryValue), row = `      ${key}: ${value}`;
  // The public kernel serializer may wrap a scalar value and may choose a
  // plain or single-quoted key. Replace the entire scalar entry,
  // not just its first line, so a tokenless resume remains valid YAML.
  const keys = [key, entryKey, "'" + entryKey + "'"];
  // Identify the key/delimiter before examining the value. Empty or unsupported
  // tails must refuse, not disappear from duplicate detection.
  const matches = lines.flatMap((line, index) => {
    if (index <= block || index >= blockEndIndex || !line.startsWith("      ") || line.startsWith("       ")) return [];
    const entry = line.slice(6);
    for (const candidate of keys) {
      if (!entry.startsWith(candidate)) continue;
      const delimiter = /^[ \t]*:(.*)$/.exec(entry.slice(candidate.length));
      if (delimiter) return [{ index, tail: delimiter[1] }];
    }
    return [];
  });
  if (matches.length > 1) unsupportedLocalYaml(file, map, `duplicate ${noun} key`, entryKey, entryValue);
  if (matches.length) {
    const { index: existing, tail } = matches[0];
    if (tail && !/^[ \t]/.test(tail)) unsupportedLocalYaml(file, map, `unsupported ${noun} delimiter`, entryKey, entryValue);
    const scalar = tail.trimStart();
    let end = existing + 1, comment = "";
    if (scalar.startsWith('"') || scalar.startsWith("'")) {
      const quote = scalar[0];
      let closed = false, escaped = false;
      for (let i = existing; i < blockEndIndex && !closed; i++) {
        if (i > existing && (!lines[i].startsWith("       ") || !lines[i].trim() || lines[i].trimStart().startsWith("#"))) break;
        const part = i === existing ? scalar.slice(1) : lines[i].trimStart();
        for (let j = 0; j < part.length; j++) {
          const char = part[j];
          if (quote === '"' && escaped) { escaped = false; continue; }
          if (quote === '"' && char === "\\") { escaped = true; continue; }
          if (char !== quote) continue;
          if (quote === "'" && part[j + 1] === "'") { j++; continue; }
          const tail = part.slice(j + 1).trim();
          if (tail && !tail.startsWith("#")) unsupportedLocalYaml(file, map, `ambiguous ${noun} scalar`, entryKey, entryValue);
          comment = tail; closed = true; end = i + 1; break;
        }
        // A YAML backslash at end of line escapes the line break, not the
        // first character on the next line.
        escaped = false;
      }
      if (!closed) unsupportedLocalYaml(file, map, `unterminated or unsupported ${noun} scalar`, entryKey, entryValue);
    } else {
      if (!scalar || scalar.startsWith("#") || scalar === "null" || scalar === "~" || /^[|>&*!{[]/.test(scalar)) unsupportedLocalYaml(file, map, `unsupported ${noun} scalar`, entryKey, entryValue);
      comment = scalar.match(/\s+(#.*)$/)?.[1] || "";
    }
    // Never consume another setting, nested mapping or comment as a scalar.
    if (end < blockEndIndex && lines[end].trim() && !lines[end].trimStart().startsWith("#") && lines[end].startsWith("       ")) {
      unsupportedLocalYaml(file, map, `ambiguous ${noun} continuation`, entryKey, entryValue);
    }
    lines.splice(existing, end - existing, row + (comment ? " " + comment : ""));
  } else lines.splice(blockEndIndex, 0, row);
  atomicWrite(file, `${lines.join("\n")}\n`);
}
