/** Kernel side of the Pi record-witness seam. Record support is deliberately
 * capability-checked before admission: older path-only readers cannot launch a
 * protected host. The record-library implementation is separately owned. */
import { basename, dirname, join } from "node:path";
import * as records from "../packages/record/lib/native-history.mjs";
import { oatsError } from "./errors.mjs";

export function capturedPiSessionDirectory(home) {
  const history = records.nativeHistoryPath(home);
  return join(dirname(history), `${basename(history)}.pi`);
}

export function requireCapturedPiRecordSupport() {
  if (records.CAPTURED_PI_RECORD_VERSION !== 2
    || ["inspectCapturedPiRoot", "prepareCapturedPiStart", "assertCapturedPiStart"].some(name => typeof records[name] !== "function")) {
    throw oatsError("E_PI_HOST_RECORD_UNAVAILABLE", "captured Pi requires complete versioned native-root discovery/read/capture guards; path-only record support cannot launch it");
  }
  return records;
}

export function inspectCapturedPiRoot(home, authority) {
  return requireCapturedPiRecordSupport().inspectCapturedPiRoot(home, authority);
}
export function prepareCapturedPiStart(home, authority) {
  return requireCapturedPiRecordSupport().prepareCapturedPiStart(home, authority);
}
export function assertCapturedPiStart(home, nativeRecordId, authority) {
  return requireCapturedPiRecordSupport().assertCapturedPiStart(home, nativeRecordId, authority);
}
