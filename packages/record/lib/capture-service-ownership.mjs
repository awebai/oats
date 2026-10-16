// Deliberately small readers for the templates this package has actually
// written. Unsupported directives, expansions, markers or XML are foreign,
// never permission inferred from a filename or a mention of capture.
import { basename, isAbsolute, join } from "node:path";
import { captureServiceLabel, captureServiceUnit, captureServiceRequest } from "./capture-service-definition.mjs";

const owner = value => /^[A-Za-z0-9._-]+$/.test(value);
const node = value => typeof value === "string" && isAbsolute(value) && ["node", "nodejs"].includes(basename(value));
const exactKeys = (value, keys) => Object.keys(value).sort().join("|") === [...keys].sort().join("|");
function legacy(argv) {
  return argv?.length === 5 && node(argv[0]) && isAbsolute(argv[1]) && argv[1].endsWith("/bin/capture.mjs") &&
    argv[2] === "--watch" && argv[3] === "--owner" && owner(argv[4]);
}
function periodic(argv) {
  if (argv?.length !== 3 || typeof argv[0] !== "string" || !isAbsolute(argv[0]) || !isAbsolute(argv[1]) || !argv[1].endsWith("/lib/capture-service-runner.mjs")) return null;
  const value = JSON.parse(argv[2]);
  const request = captureServiceRequest(value);
  return JSON.stringify(value) === JSON.stringify(request) ? request : null;
}

export function captureServiceArgvOwnership(argv) {
  try { return legacy(argv) ? "legacy" : periodic(argv) ? "periodic" : "foreign"; }
  catch { return "foreign"; }
}

export function serviceSystemdArgs(line) {
  const words = []; let i = 0;
  while (i < line.length) {
    while (/[ \t]/.test(line[i] ?? "")) i++;
    if (i === line.length) break;
    let word = "";
    if (line[i] === '"') {
      i++;
      while (line[i] !== '"') {
        if (i >= line.length) throw new Error("unterminated systemd word");
        if (line[i] === "\\") { i++; if (!['"', "\\"].includes(line[i])) throw new Error("unsupported systemd escape"); }
        word += line[i++];
      }
      i++;
      if (i < line.length && !/[ \t]/.test(line[i])) throw new Error("joined systemd word");
    } else {
      while (i < line.length && !/[ \t]/.test(line[i])) word += line[i++];
      if (!/^[A-Za-z0-9_./:@+,-]+$/.test(word)) throw new Error("unsupported bare systemd word");
    }
    if (/%/.test(word.replace(/%%/g, ""))) throw new Error("systemd specifier");
    if (words.length) {
      if (/\$/.test(word.replace(/\$\$/g, ""))) throw new Error("systemd environment expansion");
      word = word.replace(/\$\$/g, "$");
    }
    words.push(word.replace(/%%/g, "%"));
  }
  return words;
}

function ini(text) {
  const values = {}; let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const heading = /^\[([A-Za-z]+)\]$/.exec(line);
    if (heading) { section = heading[1]; continue; }
    const item = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!section || !item || line.endsWith("\\")) throw new Error("unsupported unit directive");
    const key = `${section}.${item[1]}`;
    if (Object.hasOwn(values, key)) throw new Error("duplicate unit directive");
    values[key] = item[2];
  }
  return values;
}

function xmlText(raw) {
  if (/[<>]/.test(raw) || /&(?!amp;|lt;|gt;|quot;|apos;|#13;)/.test(raw)) throw new Error("unsupported XML text");
  return raw.replace(/&#13;/g, "\r").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function plist(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)) throw new Error("invalid XML character");
  for (const comment of text.matchAll(/<!--([^]*?)-->/g)) if (comment[1].includes("--")) throw new Error("invalid XML comment");
  let rest = text.replace(/\r\n?/g, "\n").trim();
  rest = rest.replace(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*/, "")
    .replace(/^<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\s*/, "")
    .replace(/<!--[^]*?-->/g, "").trim();
  const body = /^<plist version="1\.0">\s*<dict>([^]*)<\/dict>\s*<\/plist>$/.exec(rest);
  if (!body) throw new Error("unsupported plist");
  rest = body[1]; const values = {};
  while (rest.trim()) {
    const key = /^\s*<key>([^<]*)<\/key>\s*/.exec(rest);
    if (!key || Object.hasOwn(values, key[1])) throw new Error("invalid plist key");
    rest = rest.slice(key[0].length);
    const scalar = /^(?:<string>([^]*?)<\/string>|<integer>(\d+)<\/integer>|<(true|false)\s*\/>)/.exec(rest);
    if (scalar) {
      values[key[1]] = scalar[1] !== undefined ? xmlText(scalar[1]) : scalar[2] !== undefined ? Number(scalar[2]) : scalar[3] === "true";
      rest = rest.slice(scalar[0].length); continue;
    }
    const array = /^<array>([^]*?)<\/array>/.exec(rest);
    if (!array) throw new Error("unsupported plist value");
    let members = array[1]; const args = [];
    while (members.trim()) {
      const item = /^\s*<string>([^]*?)<\/string>/.exec(members);
      if (!item) throw new Error("unsupported plist array");
      args.push(xmlText(item[1])); members = members.slice(item[0].length);
    }
    values[key[1]] = args; rest = rest.slice(array[0].length);
  }
  return values;
}

export function captureServiceOwnership(text, kind) {
  try {
    const markers = text.match(/oats-turn-record-service:[^\s<>]*/g) ?? [];
    if (markers.length > 1 || (markers.length && markers[0] !== "oats-turn-record-service:1")) return "foreign";
    const marked = markers.length === 1;
    if (marked && !(kind === "plist" ? /<!-- oats-turn-record-service:1 -->/ : /^# oats-turn-record-service:1\s*$/m).test(text)) return "foreign";
    if (kind === "plist") {
      const p = plist(text);
      const common = ["Label", "ProgramArguments", "RunAtLoad", "StandardOutPath", "StandardErrorPath"];
      if (p.Label !== captureServiceLabel || p.RunAtLoad !== true || typeof p.StandardOutPath !== "string" ||
          p.StandardOutPath !== p.StandardErrorPath || !isAbsolute(p.StandardOutPath)) return "foreign";
      if (!marked && exactKeys(p, [...common, "KeepAlive", "ThrottleInterval"]) && p.KeepAlive === true && p.ThrottleInterval === 60 && legacy(p.ProgramArguments)) return "legacy";
      const request = marked && exactKeys(p, [...common, "StartInterval"]) && p.StartInterval === 900 && periodic(p.ProgramArguments);
      return request && p.StandardOutPath === join(request.plan.home, "Library", "Logs", "turn-record-capture.log") ? "periodic" : "foreign";
    }
    const p = ini(text);
    if (kind === "timer") return marked && exactKeys(p, ["Unit.Description", "Timer.OnBootSec", "Timer.OnUnitActiveSec", "Timer.Unit", "Install.WantedBy"]) &&
      p["Unit.Description"] === "turn-record periodic capture" && p["Timer.OnBootSec"] === "1min" && p["Timer.OnUnitActiveSec"] === "15min" &&
      p["Timer.Unit"] === captureServiceUnit && p["Install.WantedBy"] === "timers.target" ? "periodic" : "foreign";
    const argv = serviceSystemdArgs(p["Service.ExecStart"] ?? "");
    if (!marked && exactKeys(p, ["Unit.Description", "Service.ExecStart", "Service.Restart", "Service.RestartSec", "Install.WantedBy"]) &&
      p["Unit.Description"] === "turn-record capture watcher" && p["Service.Restart"] === "always" && p["Service.RestartSec"] === "60" &&
      p["Install.WantedBy"] === "default.target" && legacy(argv)) return "legacy";
    return marked && exactKeys(p, ["Unit.Description", "Service.Type", "Service.ExecStart", "Service.MemoryMax", "Service.RuntimeMaxSec"]) &&
      p["Unit.Description"] === "turn-record bounded capture pass" && p["Service.Type"] === "exec" && p["Service.MemoryMax"] === "2G" &&
      p["Service.RuntimeMaxSec"] === "300" && periodic(argv) ? "periodic" : "foreign";
  } catch { return "foreign"; }
}
