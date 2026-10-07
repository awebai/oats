/** Native aw 1.36.23 uses Go time.ParseDuration, then requires 60s..720h.
 * Keep its component-wise nanosecond truncation (including Go's float64
 * fractional conversion), rather than comparing a numeric prefix or hours.
 */
export const DEFAULT_GRANT_TTL = "720h";
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

export function resolveGrantTTL(configured) {
  const ttl = configured === undefined || configured === null || configured === ""
    ? DEFAULT_GRANT_TTL : String(configured);
  try {
    const ns = durationNanoseconds(ttl);
    if (ns < 60000000000n || ns > 2592000000000000n) throw new Error("out of range");
  } catch {
    throw new Error("E_GRANT_TTL: identity.ttl must be a Go duration between 60s and 720h (maximum 720h); no value was clamped");
  }
  return ttl;
}
