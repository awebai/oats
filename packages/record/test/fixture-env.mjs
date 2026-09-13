// Native storage overrides must never escape a test's synthetic HOME.
// Preserve tool resolution, but explicitly opt in to each fixture location.
export function fixtureEnv() {
  const env = { ...process.env };
  for (const key of ["CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_SESSION_FILE", "CODEX_HOME"]) delete env[key];
  return env;
}
