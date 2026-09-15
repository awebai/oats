/** The single existing executable-surface definition, shared with captured
 * approval diagnostics. This projection does not validate/compile a manifest
 * or permit execution; the action adapter must validate the full contract. */
export function executableSurfaceOf(manifest) {
  return {
    commands: Object.keys(manifest?.commands || {}),
    hooks: Object.keys(manifest?.hooks || {}),
    environment: [...(manifest?.environment || [])],
    ...(manifest?.environmentNamespaces?.length ? { environmentNamespaces: [...manifest.environmentNamespaces] } : {}),
  };
}
export function hasExecutableSurface(manifest) {
  const s = executableSurfaceOf(manifest);
  return s.commands.length > 0 || s.hooks.length > 0 || s.environment.length > 0;
}
