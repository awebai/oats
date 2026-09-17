/** Shape-only invocation fixtures. Synthetic digests are not retained/executable authority. */
export function invocationFixture({ deployment = "/deployment", home = null, helper = false, capability = "example.provider" } = {}) {
  const integrity = { format: "oats.tree-exec.v1", value: `sha256-${"a".repeat(64)}` };
  const origin = { kind: "operator", document: { kind: "operator", id: "invocation-fixture" }, pointer: "/source" };
  const identity = { kind: "local-soul", source: "path:/fixture-source", exportPath: "." };
  const artifact = { kind: "capability", capability, integrity };
  const subject = helper ? { kind: "helper", provider: artifact, definition: { owner: artifact, path: "agents/worker/soul.yaml", kind: "file" }, name: "worker" }
    : { kind: "persistent", soul: { identity, alias: "expert", sourceArtifact: { kind: "soul", identity, integrity },
      revision: { kind: "local", source: "path:/fixture-source", integrity, provenance: [origin] }, definition: "soul.yaml", projection: { roots: ["."] } } };
  const name = helper ? "worker" : "expert";
  return { schemaVersion: 1, executionBinding: { schemaVersion: 1, deployment, resolution: { schemaVersion: 1, id: `sha256-${"b".repeat(64)}` } },
    subject, intent: null, instance: home === null ? null : { home, work: `${home}/work`, name: `${name}-1`, agent: name, incarnationId: '11111111-1111-4111-8111-111111111111' },
    context: { kind: "standalone", key: "opaque-context" }, responsibleHuman: null, messagingChoice: { schemaVersion: 1, enabled: false },
    capability, action: home === null ? { kind: "command", capability, name: "show" } : { kind: "hook", capability, name: "spawn" }, priorReceipt: null };
}
