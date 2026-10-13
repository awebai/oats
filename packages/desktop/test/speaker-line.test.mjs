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

test("a reason's sentence: with an origin it is a text from outside, filtered and under its speaker's words; with none it is the shared home's own, shown as written", () => {
  assert.equal(reasonLine({ sentence: "tmux said no", origin: "terminal-probe" }), "Desktop's terminal check says: tmux said no");
  // "unattributed" names nobody: the line alone, filtered all the same. So does any value that is no speaker.
  for (const origin of ["unattributed", "someone-else", "", null, 7, false]) {
    assert.equal(reasonLine({ sentence: "tmux said no", origin }), "tmux said no", JSON.stringify(origin));
    assert.equal(reasonLine({ sentence: "wipe \u001b[2J the screen", origin }), DETAIL_WITHHELD, JSON.stringify(origin));
    assert.equal(reasonLine({ sentence: "first\nsecond", origin }), "first second", JSON.stringify(origin));
    assert.equal(reasonLine({ sentence: "safe\u202Etxt.exe", origin }), "safe\uFFFDtxt.exe", JSON.stringify(origin));
  }
  for (const origin of Object.keys(LEADS)) assert.equal(reasonLine({ sentence: "bell\u0007", origin }), DETAIL_WITHHELD, "an unsafe text is never put under a speaker's name");
  // A text with an origin that is not a string has nothing to show: the row then keeps its label.
  for (const sentence of [7, true, { message: "x" }, ["x"], "", "   "]) assert.equal(reasonLine({ sentence, origin: "unattributed" }), null, JSON.stringify(sentence));
  assert.equal(rowReasonLine({ label: "state unknown", sentence: 7, origin: "unattributed" }), "state unknown");
  assert.equal(rowReasonLine({ label: "state unknown", sentence: "a\u0007", origin: "kernel" }), DETAIL_WITHHELD);
  // No origin: the shared home wrote it. Shown as written, never under a speaker's name.
  assert.equal(reasonLine({ sentence: "written here" }), "written here");
  assert.equal(reasonLine({ sentence: "written here", origin: undefined }), "written here");
  assert.equal(reasonLine(null), null); assert.equal(reasonLine({}), null); assert.equal(reasonLine({ sentence: "" }), null); assert.equal(reasonLine({ sentence: 7 }), null);
  assert.equal(rowReasonLine(null), null, "no reason, no line");
  assert.equal(rowReasonLine({ label: "state unknown", sentence: "" }), "state unknown", "a reason with nothing to show keeps its label");
});

test("a row's own text is always filtered, with the row's mark as its speaker and only when the mark is one of the three", () => {
  for (const [origin, lead] of Object.entries(LEADS)) {
    assert.equal(runtimeErrorLine({ runtimeError: "no session", runtimeErrorOrigin: origin }), `${lead} no session`, origin);
  }
  for (const origin of [undefined, null, "other", "unattributed", 3]) {
    assert.equal(runtimeErrorLine({ runtimeError: "no session", runtimeErrorOrigin: origin }), "no session", String(origin));
    assert.equal(runtimeErrorLine({ runtimeError: "bell\u0007", runtimeErrorOrigin: origin }), DETAIL_WITHHELD, String(origin));
  }
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

test("a sentence the shared home wrote keeps the names it holds as they are: no filter reads a credential's shape in an instance's name or a label", () => {
  for (const name of ["api-token", "vault-secret", "db-password", "x-authorization", "svc-api-key", "token-dev"]) {
    const reason = rowReason({ instance: name, running: null });
    assert.equal(Object.hasOwn(reason, "origin"), false, name);
    assert.equal(rowReasonLine(reason), `${name}: status unknown`, name);
  }
  // A label is shown raw in the sentence it enters, as on the base (the filter of a name where it enters its sentence is not this change).
  const unreached = rowReason({ instance: "dev-a", server: "box", repoName: "box\u0007", addressable: true, serverUnreached: true });
  assert.equal(Object.hasOwn(unreached, "origin"), false); assert.equal(rowReasonLine(unreached), "box\u0007 was not reached.");
});

test("a row that reaches the Desktop with a text and no speaker: its reason is unattributed, and the text is shown filtered with no lead", () => {
  for (const mark of [{}, { runtimeErrorOrigin: "someone-else" }, { runtimeErrorOrigin: "unattributed" }]) {
    const at = JSON.stringify(mark);
    const row = (runtimeError, extra = {}) => ({ instance: "dev-a", running: null, runtimeError, ...mark, ...extra });
    assert.equal(rowReason(row("no session")).origin, "unattributed", at);
    assert.equal(rowReasonLine(rowReason(row("no session"))), "no session", at);
    assert.equal(rowReasonLine(rowReason(row("wipe \u001b[2J the screen"))), DETAIL_WITHHELD, at);
    assert.equal(rowReasonLine(rowReason(row("token: abc123"))), DETAIL_WITHHELD, at);
    assert.equal(rowReasonLine(rowReason(row("safe\u202Etxt.exe"))), "safe\uFFFDtxt.exe", at);
    // The same row's text shown directly reads the same: filtered, no lead.
    assert.equal(runtimeErrorLine(row("no session")), "no session", at); assert.equal(runtimeErrorLine(row("wipe \u001b[2J the screen")), DETAIL_WITHHELD, at);
    // A Herdr row with the kernel's text and no speaker: unattributed too; the stand-in stays the shared home's own.
    assert.equal(unsupportedLine(row("E_HERDR_REMOVED: wipe \u001b[2J", { runtimeState: "unsupported" })), DETAIL_WITHHELD, at);
    assert.equal(unsupportedLine(row("E_HERDR_REMOVED: gone", { runtimeState: "unsupported" })), "E_HERDR_REMOVED: gone", at);
  }
  // A text that is not a string: the reason carries it as on the base, unattributed, and the filter has nothing to show.
  const odd = rowReason({ instance: "dev-a", running: null, runtimeError: { message: "x" } });
  assert.deepEqual([odd.origin, rowReasonLine(odd), reasonLine(odd)], ["unattributed", "state unknown", null]);
});
