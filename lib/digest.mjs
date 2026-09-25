/** The raw-byte digest (`oats.bytes.v1`): a config document's integrity. */
import { createHash } from "node:crypto";
import { oatsError } from "./errors.mjs";

export const BYTES_FORMAT = "oats.bytes.v1";

export function bytesIntegrity(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw oatsError("invalid-declaration", "raw-byte integrity requires bytes");
  }
  return { format: BYTES_FORMAT, value: `sha256-${createHash("sha256").update(value).digest("hex")}` };
}
