/** Doubles for the workspace-view helpers the shipped HTTP handler (server/oats-web.mjs) references
 * (#482), over a plain list of deployments where every deployment is its own one-deployment view
 * (the view id IS the deployment id, as for an unattached deployment). They mirror the real
 * OATSWEB_VIEWS functions for that case:
 * - `deployments()`: the list, read on every call (tests mutate it or count lookups);
 * - `deploymentFor(id)`: the exact deployment, or the first one when no id is given, else null;
 * - `surfaceDeployment(id, request)`: exact id only when the body names an instance home
 *   (`selector.home` / `spec.home`), else deploymentFor;
 * - `isServed(id)`: the id is a listed deployment.
 * Tests that need real views use test/workspace-views-server.test.mjs's extraction instead. */
export function deploymentDoubles(deployments) {
  const exact = id => deployments().find(w => w.id === id);
  const deploymentFor = id => (id ? exact(id) : deployments()[0]) ?? null;
  const namesInstance = request => request?.selector?.home !== undefined || request?.spec?.home !== undefined;
  return {
    deployments,
    deploymentFor,
    surfaceDeployment: (id, request) => (namesInstance(request) ? exact(id) : deploymentFor(id)),
    isServed: id => !!exact(id),
  };
}
