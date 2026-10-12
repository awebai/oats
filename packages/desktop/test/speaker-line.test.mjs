// #982: the one place the page puts a speaker's name in front of a text (renderer/speaker-line.mjs).
// Pure: the three leads with the Desktop's terms, the filter every text goes through, and the Desktop's
// own fixed sentences byte for byte. Each place that shows such a line has its own DOM test beside its view.
import test from "node:test";
import assert from "node:assert/strict";
import { speakerLine, reasonLine, rowReasonLine, runtimeErrorLine, unsupportedLine } from "../renderer/speaker-line.mjs";
import { DETAIL_WITHHELD } from "../../client/display-text.mjs";
import { originLead } from "../../client/instance-presentation.mjs";
import { rowReason } from "../../client/remote-address.mjs";
import { DESKTOP_TERMS } from "../renderer/desktop-terms.mjs";

const LEADS = { kernel: "OATS says:", "terminal-probe": "Desktop's terminal check says:", "roster-read": "Desktop's read of other machines says:" };
const HERDR = "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.";
// What a text can hold that must never be shown as it came.
const UNSAFE = ["a\u001b[31mb", "bell\u0007", "token: abc123", "https://user:pw@example.invalid/x"];

test("a text with one of the three speakers is shown after that speaker's words, in the Desktop's terms", () => {
  for (const [origin, lead] of Object.entries(LEADS)) {
    assert.equal(originLead(origin, DESKTOP_TERMS), lead, origin);
    assert.equal(speakerLine(origin, "session is gone"), `${lead} session is gone`, origin);
  }
});

test("a text with no speaker, or a value that is not one, is shown as it is, with no lead", () => {
  for (const origin of [undefined, null, "", "server-probe", "Kernel", "kernel ", 1, true, {}, ["kernel"], "__proto__", "constructor", "toString"]) {
    assert.equal(speakerLine(origin, "session is gone"), "session is gone", JSON.stringify(origin) ?? String(origin));
  }
});

test("the answer is always one display line: nothing to show is null, an unsafe text is withheld whole, and neither is put under a speaker's name", () => {
  for (const origin of [...Object.keys(LEADS), undefined]) {
    for (const nothing of [undefined, null, "", "   ", "\n\t", 7, {}, ["x"]]) assert.equal(speakerLine(origin, nothing), null, `${origin}: ${JSON.stringify(nothing)}`);
    for (const unsafe of UNSAFE) assert.equal(speakerLine(origin, unsafe), DETAIL_WITHHELD, `${origin}: ${JSON.stringify(unsafe)}`);
  }
  assert.equal(speakerLine("kernel", "first line\nsecond line\tthird"), "OATS says: first line second line third", "line breaks and tabs fold to one line");
  assert.equal(speakerLine("kernel", "  padded \n"), "OATS says: padded");
  // Markup is text: the line carries it as it came, and each place sets it as text.
  assert.equal(speakerLine("kernel", "<b>bold</b>"), "OATS says: <b>bold</b>");
  // A text that holds a speaker's words is still only a text: the lead in front is the mark's, never the text's.
  assert.equal(speakerLine(undefined, "OATS says: all is well"), "OATS says: all is well");
  assert.equal(speakerLine("roster-read", "OATS says: all is well"), "Desktop's read of other machines says: OATS says: all is well");
});

test("a reason is shown with its origin; a row's own text with the row's mark, and only when the mark is one of the three", () => {
  assert.equal(reasonLine({ sentence: "tmux said no", origin: "terminal-probe" }), "Desktop's terminal check says: tmux said no");
  assert.equal(reasonLine({ sentence: "written here" }), "written here");
  assert.equal(reasonLine(null), null); assert.equal(reasonLine({}), null);
  assert.equal(rowReasonLine(null), null, "no reason, no line");
  assert.equal(rowReasonLine({ label: "state unknown", sentence: "" }), "state unknown", "a reason with nothing to show keeps its label");
  assert.equal(rowReasonLine({ label: "state unknown", sentence: "a\u0007", origin: "kernel" }), DETAIL_WITHHELD);
  for (const [origin, lead] of Object.entries(LEADS)) {
    assert.equal(runtimeErrorLine({ runtimeError: "no session", runtimeErrorOrigin: origin }), `${lead} no session`, origin);
  }
  for (const origin of [undefined, null, "other", 3]) assert.equal(runtimeErrorLine({ runtimeError: "no session", runtimeErrorOrigin: origin }), "no session", String(origin));
  for (const row of [undefined, null, {}, { runtimeError: "" }, { runtimeError: null, runtimeErrorOrigin: "kernel" }, { runtimeError: 5, runtimeErrorOrigin: "kernel" }]) {
    assert.equal(runtimeErrorLine(row), null, JSON.stringify(row) ?? String(row));
  }
});

test("a Herdr row's line: the kernel's own text under the kernel's name, the stand-in written here with no lead, nothing for any other row", () => {
  const kernels = { instance: "dev-h", running: null, runtimeState: "unsupported", runtimeError: HERDR, runtimeErrorOrigin: "kernel" };
  assert.equal(unsupportedLine(kernels), `OATS says: ${HERDR}`);
  // The same text with no mark (a row that lost it) is shown as today.
  assert.equal(unsupportedLine({ ...kernels, runtimeErrorOrigin: undefined }), HERDR);
  // The stand-in is the client's sentence about an old row: a mark beside another text never names its speaker.
  for (const row of [{ instance: "dev-h", backend: "herdr" }, { instance: "dev-h", sessionTarget: "pane-1" },
    { instance: "dev-h", backend: "herdr", runtimeError: "another text", runtimeErrorOrigin: "kernel" }]) assert.equal(unsupportedLine(row), HERDR, JSON.stringify(row));
  for (const row of [{ instance: "dev-a", running: true }, { instance: "dev-a", running: null, runtimeError: "no session", runtimeErrorOrigin: "kernel" }, {}, null]) {
    assert.equal(unsupportedLine(row), null, JSON.stringify(row));
  }
});

test("each sentence written here reads byte for byte through the helper as it did before it", () => {
  const remote = { instance: "dev-a", server: "box", repoName: "box-repo", addressable: true };
  const rows = [
    [{ instance: "dev-h", backend: "herdr" }, HERDR],
    [{ ...remote, serverUnreached: true }, "box-repo was not reached."],
    [{ ...remote, missingRemotely: true }, "dev-a is no longer on box-repo. Remove it from this computer with: oats server forget box --instance dev-a"],
    [{ ...remote, addressable: false }, "box-repo did not report this instance as reachable."],
    [{ instance: "dev-a", server: "box", repoName: "box-repo" }, "This computer's OATS does not report whether box-repo can reach this instance. Update OATS here."],
    [{ instance: "dev-a", running: null }, "dev-a: status unknown"],
  ];
  for (const [row, sentence] of rows) {
    const reason = rowReason(row);
    assert.equal(reason.sentence, sentence, `${reason.key}: the sentence as the shared home writes it`);
    assert.equal(Object.hasOwn(reason, "origin"), false, `${reason.key}: written here, so no origin`);
    assert.equal(rowReasonLine(reason), sentence, `${reason.key}: the same bytes through the helper`);
  }
});

test("a name or a label inside a sentence written here is another party's text: an unsafe one withholds the line whole", () => {
  // The filter reads a credential's shape in "<name>: status unknown" when the name ends in one of its words.
  for (const name of ["api-token", "vault-secret", "db-password", "x-authorization", "svc-api-key"]) {
    assert.equal(rowReasonLine(rowReason({ instance: name, running: null })), DETAIL_WITHHELD, name);
  }
  assert.equal(rowReasonLine(rowReason({ instance: "token-dev", running: null })), "token-dev: status unknown", "a name that only begins with one reads as before");
  assert.equal(rowReasonLine(rowReason({ instance: "dev-a", server: "box", repoName: "box\u0007", addressable: true, serverUnreached: true })), DETAIL_WITHHELD);
});
