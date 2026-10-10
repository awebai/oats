// The kernel's codes and what an answer says of an error that is not the kernel's (lib/errors.mjs;
// awebai/oats#892, with #874 item 3, #891 and #866). The lifecycle verbs (`oats retire`, `oats
// instance stop`, `oats session …`, `oats worktree add|remove`) answered any thrown error that had a
// `code` with that code, so a system error left the kernel as it was: `{"error":{"code":"EACCES"}}`.
// Now an answer carries a kernel code (`^E_[A-Z0-9_]+$`) or nothing: isKernelCode tests that shape,
// kernelCode chooses between the error's code and a fallback, asKernelError wraps what is not the
// kernel's, errorCause is the little of the original the answer keeps (`details.cause`: a code and a
// syscall, or a name; never a message, a path or a stack), and defectOf finds the defect, whose
// stack an answer must not swallow. A defect (isDefect) is one of the language's own error kinds
// without a code (a TypeError and its like), or a thrown value that is no Error. A plain Error
// without a code is not one: the kernel writes refusals that way, and a child process that exits
// non-zero is reported that way; it is answered with the general code and its message alone.
//
// Pure unit tests: no fixture. The system's and Node's errors are real ones, thrown by Node here.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asKernelError, defectOf, errorCause, isDefect, isKernelCode, kernelCode, oatsError, reportDefect } from "../lib/errors.mjs";

/** What `fn` throws. */
function thrownBy(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error("fixture premise: nothing was thrown");
}
/** A real system error: ENOENT, from the open of a path that does not exist. */
const missingFile = () => thrownBy(() => readFileSync(join(tmpdir(), `oats-kernel-code-${process.pid}`, "no-such-directory", "no-such-file")));
/** A real Node error that has a code and no syscall: ERR_INVALID_URL (a TypeError). */
const invalidUrl = () => thrownBy(() => new URL("x"));
/** Another one: ERR_INVALID_ARG_TYPE (a TypeError), from a path that is no path. */
const invalidArgument = () => thrownBy(() => readFileSync({}));
/** A real error of a child process that exits non-zero: a plain Error with a status and no code. */
const failedChild = () => thrownBy(() => execFileSync(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" }));

test("the fixtures are what they are named: a real ENOENT of open, and two real Node ERR_ codes", () => {
  const fsError = missingFile();
  assert.equal(fsError.code, "ENOENT");
  assert.equal(fsError.syscall, "open");
  assert.equal(typeof fsError.path, "string", "a system error carries the path, which an answer must not repeat outside its message");
  assert.equal(typeof fsError.errno, "number");
  assert.equal(invalidUrl().code, "ERR_INVALID_URL");
  assert.equal(invalidUrl().syscall, undefined);
  assert.ok(invalidUrl() instanceof TypeError);
  assert.equal(invalidArgument().code, "ERR_INVALID_ARG_TYPE");
  const child = failedChild();
  assert.equal(child.status, 3);
  assert.equal(child.code, undefined, "a child that exits non-zero has a status and no code");
  assert.equal(child.name, "Error");
});

// ---- isKernelCode ----

test("isKernelCode: E_ followed by upper-case letters, digits and underscores is a kernel code", () => {
  for (const code of ["E_BAD_ARGS", "E_WORK_INSPECTION_FAILED", "E_X", "E_A1_B2"]) assert.equal(isKernelCode(code), true, code);
});

test("isKernelCode tests the shape, not a list of known codes: a code no kernel defines passes", () => {
  assert.equal(isKernelCode("E_NOT_A_REAL_CODE_42"), true);
});

test("isKernelCode: an errno is not a kernel code", () => {
  for (const code of ["ENOENT", "EACCES", "ENOTEMPTY", "EEXIST"]) assert.equal(isKernelCode(code), false, code);
});

test("isKernelCode: a Node internal code (ERR_…) is not a kernel code", () => {
  for (const code of ["ERR_INVALID_ARG_TYPE", "ERR_MODULE_NOT_FOUND", invalidUrl().code, invalidArgument().code]) assert.equal(isKernelCode(code), false, code);
});

test("isKernelCode: what is not a string, or is empty, is not a kernel code", () => {
  for (const code of [undefined, null, 0, 42, "", {}, ["E_X"], true]) assert.equal(isKernelCode(code), false, JSON.stringify(code) ?? String(code));
});

test("isKernelCode: E_ alone, lower case, and white space before or after (a trailing newline included) are not kernel codes", () => {
  for (const code of ["E_", "E_lower", "e_x", " E_X", "E_X ", "E_X\n", "E_X\r\n", "\nE_X", "E_X\nE_Y", "E-X", "E_X.Y"]) assert.equal(isKernelCode(code), false, JSON.stringify(code));
});

test("isKernelCode: the typed failures of the CLI that are names, not codes, are not kernel codes", () => {
  for (const code of ["unsafe-config-key", "unsafe-config-value"]) assert.equal(isKernelCode(code), false, code);
});

// ---- kernelCode ----

test("kernelCode: a kernel error is answered with its own code, whatever the fallback", () => {
  assert.equal(kernelCode(oatsError("E_PLAN_STALE", "the plan changed"), "E_LIFECYCLE_FAILED"), "E_PLAN_STALE");
  assert.equal(kernelCode({ code: "E_NOT_A_REAL_CODE_42" }, "E_LIFECYCLE_FAILED"), "E_NOT_A_REAL_CODE_42", "the shape decides, not a list");
});

test("an errno (ENOENT) and a Node internal code (ERR_…) are wrapped and never answered as they are: kernelCode gives the fallback", () => {
  const fsError = missingFile();
  assert.equal(kernelCode(fsError, "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED");
  assert.equal(kernelCode(invalidUrl(), "E_SESSION_FAILED"), "E_SESSION_FAILED");
  assert.equal(kernelCode(invalidArgument(), "E_SESSION_FAILED"), "E_SESSION_FAILED");
  // And wrapped: the answer's code is the fallback, the system's code is in details.cause alone.
  for (const original of [fsError, invalidUrl(), invalidArgument()]) {
    const wrapped = asKernelError(original, "E_LIFECYCLE_FAILED");
    assert.notEqual(wrapped, original);
    assert.equal(wrapped.code, "E_LIFECYCLE_FAILED");
    assert.equal(wrapped.details.cause.code, original.code);
    assert.equal(kernelCode(wrapped, "E_OTHER"), "E_LIFECYCLE_FAILED", "once wrapped it is a kernel error");
  }
});

test("kernelCode: an exception without a code, undefined and a thrown string are answered with the fallback", () => {
  assert.equal(kernelCode(new TypeError("x"), "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED");
  assert.equal(kernelCode(undefined, "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED");
  assert.equal(kernelCode(null, "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED");
  assert.equal(kernelCode(thrownBy(() => { throw "a thrown string"; }), "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED");
  assert.equal(kernelCode(Object.assign(new Error("x"), { code: 13 }), "E_LIFECYCLE_FAILED"), "E_LIFECYCLE_FAILED", "a code that is a number");
});

// ---- errorCause ----

test("errorCause of a system error is its code and its syscall, and nothing else: no message, no path, no stack, no errno", () => {
  const cause = errorCause(missingFile());
  assert.deepEqual(cause, { code: "ENOENT", syscall: "open" });
  assert.deepEqual(Object.keys(cause).sort(), ["code", "syscall"]);
});

test("errorCause of a Node error that has a code is that code alone: no syscall key", () => {
  const cause = errorCause(invalidUrl());
  assert.deepEqual(cause, { code: "ERR_INVALID_URL" });
  assert.equal("syscall" in cause, false);
  assert.deepEqual(errorCause(invalidArgument()), { code: "ERR_INVALID_ARG_TYPE" });
});

test("errorCause of a defect is its name alone", () => {
  assert.deepEqual(errorCause(new TypeError("x")), { name: "TypeError" });
  assert.deepEqual(errorCause(new RangeError("x")), { name: "RangeError" });
  assert.deepEqual(errorCause(thrownBy(() => JSON.parse("{"))), { name: "SyntaxError" });
});

test("errorCause of a thrown value that is no Error is the name Error", () => {
  assert.deepEqual(errorCause(thrownBy(() => { throw "a thrown string"; })), { name: "Error" });
  assert.deepEqual(errorCause(undefined), { name: "Error" });
  assert.deepEqual(errorCause(null), { name: "Error" });
});

test("errorCause of a plain Error without a code is nothing: a refusal has no cause to name", () => {
  assert.equal(errorCause(new Error("session no longer exists")), undefined);
  assert.equal(errorCause(failedChild()), undefined);
  assert.equal(errorCause(new (class HookEnvironmentContractError extends Error {})("x")), undefined);
  assert.equal(errorCause(Object.assign(new Error("x"), { code: 13 })), undefined, "a code that is no string is no code");
  assert.equal(errorCause(Object.assign(new Error("x"), { code: "" })), undefined);
});

// ---- isDefect ----

test("isDefect: the language's own error kinds, and a thrown value that is no Error, are defects", () => {
  for (const e of [new TypeError("x"), new RangeError("x"), new ReferenceError("x"), new SyntaxError("x"), thrownBy(() => undefined.x), thrownBy(() => JSON.parse("{"))]) assert.equal(isDefect(e), true, e.name);
  for (const value of ["a thrown string", 42, undefined, null, { message: "an object" }]) assert.equal(isDefect(value), true, JSON.stringify(value) ?? String(value));
});

test("isDefect: a plain Error without a code is not a defect, whoever threw it: a refusal the kernel wrote, a child process that failed", () => {
  assert.equal(isDefect(new Error("session no longer exists")), false);
  assert.equal(isDefect(failedChild()), false);
  assert.equal(isDefect(new (class HookEnvironmentContractError extends Error {})("x")), false, "a class of the kernel's that names itself Error");
});

test("isDefect: an error that has a code is never a defect: a kernel error, a system error, a Node ERR_ TypeError", () => {
  assert.equal(isDefect(oatsError("E_BAD_ARGS", "usage")), false);
  assert.equal(isDefect(missingFile()), false);
  assert.equal(isDefect(invalidUrl()), false);
  assert.ok(invalidUrl() instanceof TypeError);
});

// ---- asKernelError ----

test("asKernelError returns a kernel error itself: the same object, its details untouched", () => {
  const details = { plan: { planRevision: "abc" } };
  const kernel = Object.assign(oatsError("E_PLAN_STALE", "the plan changed"), { details });
  const answered = asKernelError(kernel, "E_LIFECYCLE_FAILED", "another message");
  assert.equal(answered, kernel);
  assert.equal(answered.code, "E_PLAN_STALE");
  assert.equal(answered.message, "the plan changed");
  assert.equal(answered.details, details);
  assert.deepEqual(answered.details, { plan: { planRevision: "abc" } });
  assert.equal("cause" in answered.details, false, "no cause is added to a kernel error");
});

test("asKernelError wraps a system error: the fallback code, its message, details.cause, and the original as cause", () => {
  const fsError = missingFile();
  const wrapped = asKernelError(fsError, "E_LIFECYCLE_FAILED");
  assert.notEqual(wrapped, fsError);
  assert.ok(wrapped instanceof Error);
  assert.equal(wrapped.code, "E_LIFECYCLE_FAILED");
  assert.equal(wrapped.message, fsError.message, "the original message by default");
  assert.deepEqual(wrapped.details, { cause: { code: "ENOENT", syscall: "open" } });
  assert.equal(wrapped.cause, fsError);
  assert.equal(fsError.code, "ENOENT", "the original is not changed");
  assert.equal(fsError.details, undefined);
});

test("asKernelError wraps with the message it is given, and the same code, details.cause and cause", () => {
  const fsError = missingFile();
  const wrapped = asKernelError(fsError, "E_WORK_INSPECTION_FAILED", "could not inspect the home of dev-1 or its work");
  assert.equal(wrapped.code, "E_WORK_INSPECTION_FAILED");
  assert.equal(wrapped.message, "could not inspect the home of dev-1 or its work");
  assert.deepEqual(wrapped.details, { cause: { code: "ENOENT", syscall: "open" } });
  assert.equal(wrapped.cause, fsError);
});

test("asKernelError wraps a Node ERR_ error and a defect (a TypeError without a code) the same way", () => {
  const url = invalidUrl();
  const wrappedUrl = asKernelError(url, "E_SESSION_FAILED");
  assert.equal(wrappedUrl.code, "E_SESSION_FAILED");
  assert.equal(wrappedUrl.message, url.message);
  assert.deepEqual(wrappedUrl.details, { cause: { code: "ERR_INVALID_URL" } });
  assert.equal(wrappedUrl.cause, url);
  const typeError = new TypeError("x is not a function");
  const wrappedType = asKernelError(typeError, "E_LIFECYCLE_FAILED");
  assert.equal(wrappedType.code, "E_LIFECYCLE_FAILED");
  assert.equal(wrappedType.message, "x is not a function");
  assert.deepEqual(wrappedType.details, { cause: { name: "TypeError" } });
  assert.equal(wrappedType.cause, typeError);
});

test("asKernelError wraps a plain Error without a code with the fallback and its message alone: no details", () => {
  for (const original of [new Error("session no longer exists"), failedChild()]) {
    const wrapped = asKernelError(original, "E_SESSION_FAILED");
    assert.equal(wrapped.code, "E_SESSION_FAILED");
    assert.equal(wrapped.message, original.message);
    assert.equal(wrapped.details, undefined, "no details.cause for a refusal");
    assert.equal("details" in wrapped, false);
    assert.equal(wrapped.cause, original);
    assert.equal(defectOf(wrapped), undefined);
  }
});

test("asKernelError wraps a thrown string: the string is the message and the cause", () => {
  const wrapped = asKernelError(thrownBy(() => { throw "a thrown string"; }), "E_LIFECYCLE_FAILED");
  assert.equal(wrapped.code, "E_LIFECYCLE_FAILED");
  assert.equal(wrapped.message, "a thrown string");
  assert.deepEqual(wrapped.details, { cause: { name: "Error" } });
  assert.equal(wrapped.cause, "a thrown string");
});

// ---- defectOf ----

test("defectOf: a TypeError without a code is the defect itself", () => {
  const typeError = new TypeError("x");
  assert.equal(defectOf(typeError), typeError);
});

test("defectOf: wrapped by asKernelError, the defect is the original exception, with its stack", () => {
  const typeError = new TypeError("x");
  const defect = defectOf(asKernelError(typeError, "E_X"));
  assert.equal(defect, typeError);
  assert.match(defect.stack, /^TypeError: x\n\s+at /);
});

test("defectOf: a plain Error without a code is no defect, alone or wrapped", () => {
  assert.equal(defectOf(new Error("session no longer exists")), undefined);
  assert.equal(defectOf(failedChild()), undefined);
  assert.equal(defectOf(asKernelError(failedChild(), "E_X")), undefined);
});

test("defectOf: a kernel error, a system error and a wrapped system error are no defect", () => {
  assert.equal(defectOf(oatsError("E_BAD_ARGS", "usage")), undefined);
  assert.equal(defectOf(Object.assign(oatsError("E_PLAN_STALE", "stale"), { details: { plan: {} } })), undefined);
  const fsError = missingFile();
  assert.equal(defectOf(fsError), undefined);
  assert.equal(defectOf(asKernelError(fsError, "E_X")), undefined);
});

test("defectOf: a Node error that has a code (ERR_…) is no defect, alone or wrapped, though it is a TypeError", () => {
  const url = invalidUrl();
  assert.ok(url instanceof TypeError);
  assert.equal(defectOf(url), undefined);
  assert.equal(defectOf(asKernelError(url, "E_X")), undefined);
});

// ---- reportDefect ----

/** What `fn` writes on this process's stderr. */
function stderrOf(fn) {
  const write = process.stderr.write;
  let written = "";
  process.stderr.write = (chunk) => { written += String(chunk); return true; };
  try { fn(); } finally { process.stderr.write = write; }
  return written;
}

test("reportDefect prints the stack of a defect, alone or wrapped, on stderr", () => {
  const typeError = new TypeError("x");
  assert.equal(stderrOf(() => reportDefect(typeError)), `${typeError.stack}\n`);
  assert.equal(stderrOf(() => reportDefect(asKernelError(typeError, "E_X"))), `${typeError.stack}\n`);
});

test("reportDefect prints nothing for a kernel error, a system error, a Node ERR_ error or a plain Error without a code, wrapped or not", () => {
  for (const e of [oatsError("E_BAD_ARGS", "usage"), missingFile(), asKernelError(missingFile(), "E_X"), invalidUrl(), asKernelError(invalidUrl(), "E_X"), new Error("a refusal"), failedChild(), asKernelError(failedChild(), "E_X")]) {
    assert.equal(stderrOf(() => reportDefect(e)), "");
  }
});
