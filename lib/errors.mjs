/** Kernel error with a stable machine-readable code (contract §4) and optional provenance. */
export function oatsError(code, message, provenance) {
  const e = new Error(message);
  e.code = code;
  if (provenance) e.provenance = provenance;
  return e;
}
