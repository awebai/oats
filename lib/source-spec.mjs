/** Portable source grammar. Pure normalization only: no cwd/HOME inference,
 * filesystem access, repository identity claims or executable approval.
 * Legacy lock readers retain their original interpretation in capability-provenance.mjs. */
import { isAbsolute, resolve } from "node:path";
import { oatsError } from "./errors.mjs";
import { scalarString } from "./portable-values.mjs";

const refuse = (message) => { throw oatsError("invalid-source", message); };
const text = (value) => {
  scalarString(value, "source");
  if (!value || value.length > 8192 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) refuse("invalid source text");
  return value;
};
export function portablePath(value, { allowRoot = false } = {}) {
  scalarString(value, "source path");
  if (allowRoot && value === ".") return value;
  if (!value || value.includes("\\") || value.includes("\0") || /^[A-Za-z]:/.test(value)
      || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw oatsError("path-escape", "expected a contained canonical repository-relative path");
  }
  return value;
}
export function revisionSelector(value) {
  text(value);
  if (value === "@" || value.startsWith("-") || value.endsWith(".") || value.includes("..")
      || value.includes("@{") || /[\s~^:?*\[\\]/.test(value)
      || value.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    refuse("invalid Git revision selector");
  }
  return value;
}

function splitGit(body) {
  // Locate the repository-path start before looking for the selector delimiter.
  // SSH's user@host is authority; refs/heads/topic is one selector, not a URL.
  let start;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(body);
  if (scheme) {
    start = body.indexOf("/", scheme[0].length);
    if (start < 0) refuse("Git repository source needs a path");
  } else if (/^[^/@:]+@[^/:]+:/.test(body)) start = body.indexOf(":") + 1;
  else {
    start = body.indexOf("/");
    if (start < 0) refuse("Git source needs host and repository path");
  }
  const positions = [];
  for (let i = start; i < body.length; i++) if (body[i] === "@") positions.push(i);
  if (positions.length > 1) refuse("ambiguous Git selector delimiter; use an unambiguous repository locator");
  if (!positions.length) return { repository: body, selector: undefined };
  const at = positions[0];
  return { repository: body.slice(0, at), selector: revisionSelector(body.slice(at + 1)) };
}
function remoteUrl(repository, { allowLocalGit = false } = {}) {
  let spelling = repository, shorthand = false, scp = null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(spelling)) {
    scp = /^([^/@:]+)@([^/:]+):(.+)$/.exec(spelling);
    shorthand = !scp;
    spelling = scp ? `ssh://${scp[1]}@${scp[2]}${scp[3].startsWith("/") ? "" : "/"}${scp[3]}` : `https://${spelling}`;
  }
  if (/\s|\\/.test(spelling)) refuse("invalid Git repository URL");
  // Reject hidden path rewriting rather than letting URL dot normalization pick
  // another repository. Percent-encoded separators are equally ambiguous.
  const pathStart = spelling.indexOf("/", spelling.indexOf("://") + 3);
  const rawPath = spelling.slice(pathStart);
  if (pathStart < 0 || rawPath.split("/").slice(1).some((part) => {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { return true; }
    return !part || decoded === "." || decoded === ".." || /[/\\\x00-\x1f\x7f]/.test(decoded);
  })) refuse("Git repository path is not canonical");
  let url;
  try { url = new URL(spelling); } catch { refuse("invalid Git repository URL"); }
  if (!["https:", "http:", "ssh:", "git:", ...(allowLocalGit ? ["file:"] : [])].includes(url.protocol)) {
    refuse("unsupported Git transport");
  }
  if (url.search || url.hash || url.password || (url.username && url.protocol !== "ssh:")) {
    refuse("Git repository locator must not contain credentials, query or fragment");
  }
  if (url.protocol !== "file:" && !url.hostname) refuse("Git repository needs a host");
  if (url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length !== 2) {
    refuse("GitHub repository locator needs owner and repository");
  }
  // SCP's host:path is home-relative; ssh://host/path is absolute. Keep the SCP
  // spelling rather than changing the path that Git sends to git-upload-pack.
  if (scp) return `${scp[1]}@${url.hostname}:${scp[3]}`;
  if (shorthand && !url.pathname.endsWith(".git")) url.pathname += ".git";
  return url.href;
}
function gitParts(spec, options) {
  text(spec);
  if (!spec.startsWith("git:")) refuse("expected an explicit git: source");
  const body = spec.slice(4), hash = body.indexOf("#");
  if (hash >= 0 && body.indexOf("#", hash + 1) >= 0) refuse("source has multiple package fragments");
  const fragment = hash < 0 ? undefined : body.slice(hash + 1);
  const split = splitGit(hash < 0 ? body : body.slice(0, hash));
  return { ...split, url: remoteUrl(split.repository, options), fragment };
}

/** Repository/import/knowledge locators never acquire a package-root default. */
export function parseRepositorySource(spec, options) {
  const parsed = gitParts(spec, options);
  if (parsed.selector !== undefined || parsed.fragment !== undefined) {
    refuse("repository locator keeps revision and exported path in separate fields");
  }
  return { kind: "git", url: parsed.url, normalized: `git:${parsed.url}` };
}

export function parsePortableSource(spec, { localBase, allowLocalPaths = false } = {}) {
  text(spec);
  if (spec.startsWith("repo:")) return { kind: "repo", path: portablePath(spec.slice(5), { allowRoot: true }) };
  if (spec.startsWith("path:")) {
    const source = spec.slice(5);
    if (!source || source.startsWith("~") || source.includes("#")) refuse("local source needs an explicit path, not HOME or a fragment");
    if (!allowLocalPaths) refuse("local inputs require explicit local adoption authorization");
    if (localBase !== undefined && !isAbsolute(localBase)) refuse("local source base must be absolute");
    if (!isAbsolute(source) && localBase === undefined) refuse("relative path: source needs an explicit local base");
    const path = isAbsolute(source) ? resolve(source) : resolve(localBase, source);
    return { kind: "path", source: `path:${path}`, path: ".", localPath: path, portable: false };
  }
  const parsed = gitParts(spec);
  if (parsed.selector === undefined) refuse("portable Git capability source requires a revision selector");
  const path = parsed.fragment === undefined ? "oats-package"
    : parsed.fragment === "" ? "." : portablePath(parsed.fragment, { allowRoot: true });
  return { kind: "git", source: `git:${parsed.url}@${parsed.selector}`, url: parsed.url,
    selector: parsed.selector, path, portable: true };
}

/** New-format locked sources already carry a canonical URL and a separate path.
 * Reading must not repair noncanonical persisted values or inherit cwd defaults. */
export function parseLockedSource3(source, path) {
  text(source); portablePath(path, { allowRoot: true });
  if (source.startsWith("path:")) {
    const local = source.slice(5);
    if (!isAbsolute(local) || local.includes("#") || resolve(local) !== local || path !== ".") refuse("invalid canonical local lock source");
    return { kind: "path", source, path, localPath: local, portable: false };
  }
  if (source.startsWith("catalog:")) {
    const entry = /^catalog:([a-z0-9][a-z0-9._-]*)(?:@([^\s#]+))?$/.exec(source);
    if (!entry) refuse("invalid canonical catalog lock source");
    return { kind: "catalog", source, path, id: entry[1], selector: entry[2] };
  }
  const parsed = gitParts(source, { allowLocalGit: true });
  if (parsed.fragment !== undefined || parsed.selector === undefined
      || source !== `git:${parsed.url}@${parsed.selector}`) refuse("invalid canonical Git lock source");
  return { kind: "git", source, path, url: parsed.url, selector: parsed.selector, portable: true };
}
