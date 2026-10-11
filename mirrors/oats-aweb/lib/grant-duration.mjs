/** Native aw uses Go time.ParseDuration, then requires 60s..720h; from aw
 * 1.36.32 it also takes the literal `never` (a grant that ends only when
 * revoked). Keep its component-wise nanosecond truncation (including Go's
 * float64 fractional conversion), rather than comparing a numeric prefix or hours.
 */
export const NEVER_GRANT_TTL = "never";
/** A new seat's grant never expires unless identity.ttl sets a duration. */
export const DEFAULT_GRANT_TTL = NEVER_GRANT_TTL;
/** What a grant minted before oats.aweb 1.25.0 (which records no ttl) renews at:
 *  that release's default, so an old seat never silently stops expiring. */
export const PRE_NEVER_GRANT_TTL = "720h";
const LIMIT = 1n << 63n;
const units = { ns: 1n, us: 1000n, "µs": 1000n, "μs": 1000n,
  ms: 1000000n, s: 1000000000n, m: 60000000000n, h: 3600000000000n };

export function durationNanoseconds(value) {
  if (typeof value !== "string") throw new Error("invalid duration");
  let text = value, negative = false, total = 0n;
  if (/^[+-]/.test(text)) { negative = text[0] === "-"; text = text.slice(1); }
  if (text === "0") return 0n;
  if (!text) throw new Error("invalid duration");
  while (text) {
    const part = /^(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))([^0-9.]+)/.exec(text);
    if (!part || !Object.hasOwn(units, part[4])) throw new Error("invalid duration");
    const integer = BigInt(part[1] || "0"), unit = units[part[4]];
    if (integer > LIMIT || integer > LIMIT / unit) throw new Error("duration overflow");
    let fraction = 0n, scale = 1;
    // Match Go leadingFraction: consume all digits, stop accumulating at overflow.
    for (const digit of part[2] ?? part[3] ?? "") {
      const next = fraction * 10n + BigInt(digit);
      if (fraction > (LIMIT - 1n) / 10n || next > LIMIT) break;
      fraction = next; scale *= 10;
    }
    const nanos = integer * unit + BigInt(Math.trunc(Number(fraction) * (Number(unit) / scale)));
    total += nanos;
    if (nanos > LIMIT || total > LIMIT) throw new Error("duration overflow");
    text = text.slice(part[0].length);
  }
  if (!negative && total >= LIMIT) throw new Error("duration overflow");
  return negative ? -total : total;
}

const unset = value => value === undefined || value === null || value === "";

export function resolveGrantTTL(configured) {
  const ttl = unset(configured) ? DEFAULT_GRANT_TTL : String(configured);
  if (ttl === NEVER_GRANT_TTL) return ttl;
  try {
    const ns = durationNanoseconds(ttl);
    if (ns < 60000000000n || ns > 2592000000000000n) throw new Error("out of range");
  } catch {
    throw new Error("E_GRANT_TTL: identity.ttl must be never or a Go duration between 60s and 720h (maximum 720h); no value was clamped");
  }
  return ttl;
}

/** The ttl a renewal mints with: the captured identity.ttl when set, else the
 *  ttl the renewed grant recorded, else (a grant minted before 1.25.0) 720h. */
export function renewalGrantTTL(configured, recorded) {
  if (!unset(configured)) return resolveGrantTTL(configured);
  if (typeof recorded === "string" && recorded) {
    try { return resolveGrantTTL(recorded); } catch { /* an unreadable record renews like an old one */ }
  }
  return PRE_NEVER_GRANT_TTL;
}
