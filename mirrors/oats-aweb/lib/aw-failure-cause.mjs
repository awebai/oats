// The cause of a failed aw call whose output is withheld because it can hold a
// credential (an invite mint), named from a fixed vocabulary: aw's own text is
// matched, never relayed (awebai/oats-aweb#52).

/** The refusal codes read from aw's --json error envelope
 *  (`{"error":{"code":...}}`, aw 1.36.52-rc.3 and later). A code is a fixed
 *  word, so naming it leaks nothing; anything else is never read. */
export const AW_ERROR_CODES = new Set(["unknown_or_invalid"]);

/** Transport failures as Go's net, net/http and crypto/tls word them in the aw
 *  binary: a dial (tcp, tcp4, tcp6), DNS, refused/reset/unreachable, timeouts
 *  (i/o, deadline, TLS handshake, the client's own), TLS and certificate
 *  errors, and a connection that ended early (`Post "…": EOF`). */
const NETWORK_FAILURE_RE = /\b(?:dial tcp[46]?|no such host|connection refused|connection reset|network is unreachable|i\/o timeout|context deadline exceeded|tls handshake timeout|client\.timeout exceeded)\b|\btls: |\bx509: |": (?:unexpected )?EOF\b/i;

/** The JSON object that `text` starts with, ignoring whatever follows it. */
export function leadingJsonObject(text) {
  let depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/** aw's --json error code (`{"error":{"code":...}}` leading its stdout), only
 *  when AW_ERROR_CODES lists it. */
export function awErrorCode(stdout) {
  try {
    const code = leadingJsonObject(String(stdout ?? "").trim())?.error?.code;
    return AW_ERROR_CODES.has(code) ? code : undefined;
  } catch { return undefined; }
}

/** The cause of a failure with no HTTP status: aw's allowlisted error code,
 *  else a network or TLS failure in its output, else that the output held
 *  none of these. */
export function withheldFailureCause({ stderr, stdout }) {
  const code = awErrorCode(stdout);
  if (code) return `aw error ${code}`;
  if (NETWORK_FAILURE_RE.test(`${stderr ?? ""}\n${stdout ?? ""}`)) return "the aweb service could not be reached: a network or TLS failure";
  return "no HTTP status, aw error code or network failure in its output";
}
