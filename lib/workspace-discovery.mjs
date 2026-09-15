/** Reciprocal workspace discovery and by-reference soul imports through one
 * repository transaction. Membership is observed eligibility, not enrollment. */
import { canonicalJson, compareUtf8, freezeJson } from "./portable-values.mjs";
import { objectAt, pointerKey } from "./portable-shape.mjs";
import { sameIdentity } from "./portable-identity.mjs";
import { validateOrigin } from "./resolution-shape.mjs";
import { parseMemberExports, parseSoulImport, parseWorkspaceDefinition } from "./workspace-definition.mjs";
import { parsePortableSoul } from "./portable-soul.mjs";
import { oatsError } from "./errors.mjs";

function declaredOrigin(parsed, pointer, kind) {
  const result = { ...parsed.origins[pointer], kind };
  validateOrigin(result); return result;
}
function minimumRoots(paths) {
  const roots = new Set(paths);
  if (roots.has(".")) return ["."];
  return [...roots].filter((path) => {
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) if (roots.has(path.slice(0, at))) return false;
    return true;
  }).sort(compareUtf8);
}

export function createWorkspaceDiscovery(transaction) {
  const workspaces = new WeakMap();
  return {
    readWorkspace(request) {
      canonicalJson(request);
      objectAt(request, ["source", "revision", "origin", "expectedIdentity"], ["source", "origin"]);
      const observation = transaction.observe(request.source, request);
      const document = transaction.readFile(observation, "oats-workspace.yaml");
      const parsed = parseWorkspaceDefinition(document.bytes, { origin: document.origin });
      const identity = { repository: observation.source.identity, path: "oats-workspace.yaml" };
      const view = freezeJson({ schemaVersion: 1, identity, source: observation.source, parsed, accessContextKey: observation.accessContextKey });
      workspaces.set(view, { observation, parsed, identity, document: document.origin });
      return view;
    },

    checkMember(view, request) {
      const workspace = workspaces.get(view);
      if (!workspace) throw oatsError("invalid-source", "workspace view was not issued by this discovery transaction");
      canonicalJson(request);
      objectAt(request, ["source", "origin", "expectedIdentity"], ["source", "origin"]);
      validateOrigin(request.origin);
      const evidence = [], problems = [];
      let member = null;
      const result = (status) => freezeJson({ schemaVersion: 1, status, workspace: { identity: workspace.identity,
        revision: workspace.observation.source.commit, document: workspace.document }, member, evidence, problems });
      const problem = (code, message, origins) => problems.push({ code, message, origins });
      const unavailable = (error, origins) => {
        problem(error.code ?? "source-unavailable", error.message, origins);
        return result(["source-identity-unresolved", "source-identity-change"].includes(error.code) ? "identity-unresolved" : "unavailable");
      };
      let candidate;
      try { candidate = transaction.identify(request.source, request); }
      catch (error) { return unavailable(error, [request.origin]); }
      if (candidate.accessContextKey !== view.accessContextKey) {
        problem("source-access-context-change", "membership observations use different access contexts", [request.origin]);
        return result("unavailable");
      }
      const entries = workspace.parsed.members;
      let index = entries.findIndex((entry) => entry.source === candidate.source);
      if (index < 0) {
        const unresolved = [];
        for (const [at, entry] of entries.entries()) {
          try {
            const listed = transaction.identify(entry.source);
            if (listed.accessContextKey !== view.accessContextKey) throw oatsError("source-access-context-change", "allowlist identity has a different access context");
            if (sameIdentity(listed.identity, candidate.identity)) { index = at; break; }
          } catch (error) { unresolved.push({ error, origin: declaredOrigin(workspace.parsed, `/members/${at}`, "workspace-admission") }); }
        }
        if (index < 0 && unresolved.length) return unavailable(unresolved[0].error, [unresolved[0].origin]);
      }
      if (index < 0) {
        problem("workspace-disallows-member", "repository is not admitted by this workspace", [request.origin]);
        return result("not-member");
      }
      const entry = entries[index], admission = declaredOrigin(workspace.parsed, `/members/${index}`, "workspace-admission");
      evidence.push(admission);
      try {
        // The workspace's declared selector governs admission evidence, not the
        // caller's work-tree branch or an arbitrary fork's copied descriptor.
        const observation = transaction.observe(entry.source, { ...(entry.revision === undefined ? {} : { revision: entry.revision }),
          origin: admission, expectedIdentity: candidate.identity });
        if (observation.accessContextKey !== view.accessContextKey) throw oatsError("source-access-context-change", "member observation has a different access context");
        if (!sameIdentity(observation.source.identity, candidate.identity)) throw oatsError("source-identity-change", "admission observed a different member identity");
        const document = transaction.readFile(observation, "oats.yaml", { optional: true });
        member = { identity: observation.source.identity, revision: observation.source.commit, document: document?.origin ?? null };
        if (!document) {
          problem("member-backlink-missing", "admitted repository has no member descriptor", [admission]);
          return result("not-member");
        }
        const parsed = parseMemberExports(document.bytes, { origin: document.origin });
        if (!parsed.workspace) {
          problem("member-backlink-missing", "repository exports do not declare workspace membership", [admission]);
          return result("not-member");
        }
        const backlink = declaredOrigin(parsed, "/workspace", "member-backlink"); evidence.push(backlink);
        const target = transaction.identify(parsed.workspace.source);
        if (target.accessContextKey !== view.accessContextKey) throw oatsError("source-access-context-change", "backlink identity has a different access context");
        if (!sameIdentity(target.identity, workspace.identity.repository)) {
          problem("member-backlink-mismatch", "member points to a different workspace identity", [admission, backlink]);
          return result("not-member");
        }
        const linkedWorkspace = transaction.observe(parsed.workspace.source, { ...(parsed.workspace.revision === undefined ? {} : { revision: parsed.workspace.revision }),
          origin: backlink, expectedIdentity: workspace.identity.repository });
        if (linkedWorkspace.accessContextKey !== view.accessContextKey) throw oatsError("source-access-context-change", "backlink observation has a different access context");
        if (!sameIdentity(linkedWorkspace.source.identity, workspace.identity.repository)) throw oatsError("source-identity-change", "backlink observed a different workspace identity");
        if (linkedWorkspace.source.commit !== workspace.observation.source.commit) {
          problem("workspace-observation-mismatch", "backlink resolves a different workspace revision; choose matching observations", [admission, backlink]);
          return result("stale");
        }
        return result("eligible");
      } catch (error) { return unavailable(error, evidence); }
    },

    importSoul(reference, { origin, expectedIdentity } = {}) {
      validateOrigin(origin);
      const parsedImport = parseSoulImport(reference, { pointer: origin.pointer, origin: origin.document });
      const imported = parsedImport.reference;
      const importOrigins = Object.create(null);
      const mark = (value, pointer) => {
        importOrigins[pointer] = { document: origin.document, pointer };
        if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) mark(child, `${pointer}/${pointerKey(key)}`);
      };
      mark(reference, origin.pointer);
      const observation = transaction.observe(imported.source, { revision: imported.revision, origin, ...(expectedIdentity === undefined ? {} : { expectedIdentity }) });
      const index = transaction.readFile(observation, "oats.yaml", { optional: true });
      if (!index) throw oatsError("export-not-found", "source repository has no advertised soul export index");
      const exports = parseMemberExports(index.bytes, { origin: index.origin });
      const at = (exports.exports.souls ?? []).findIndex((entry) => entry.path === imported.soul);
      if (at < 0) throw oatsError("export-not-found", "requested soul path is not advertised by this source revision");
      const exported = exports.exports.souls[at], definition = transaction.readFile(observation, exported.definition);
      const soul = parsePortableSoul(definition.bytes, { origin: definition.origin });
      const roots = [imported.soul, ...(soul.declaration.resources ?? [])];
      for (const [pointer, source] of Object.entries(soul.sources)) if (pointer.startsWith("/requires/") && source.kind === "repo") roots.push(source.path);
      // The publisher's backlink is parsed as data, never followed as an adopter
      // workspace or membership requirement. No adopter-owned soul is written.
      const identity = { kind: "git-soul", repository: observation.source.identity, exportPath: imported.soul };
      return freezeJson({ schemaVersion: 1, identity,
        reference: imported, observation, definition: exported.definition, soul, roots: minimumRoots(roots),
        adoption: imported.adoption ? { identity, parsed: parsedImport, origins: importOrigins, pointer: origin.pointer } : null,
        provenance: [declaredOrigin(exports, `/exports/souls/${at}`, "source-export")] });
    },
  };
}
