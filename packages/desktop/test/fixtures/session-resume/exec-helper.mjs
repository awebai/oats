// A client that starts a change through execFileToFiles and then goes (file-output-exec.test.mjs, the lifetime
// regression): it starts the stand-in kernel, prints `{"pid": <the stand-in's pid>}` on a line of its stdout, then
// exits at once (`exit`) or waits to be signalled (`wait`).
//   node exec-helper.mjs <stand-in> <marker> exit|wait
import { execFileToFiles } from '../../../../client/file-output-exec.mjs';

const [standIn, marker, mode] = process.argv.slice(2);
const child = execFileToFiles(process.execPath, [standIn, String(process.pid), marker], { cwd: '/', env: process.env }, () => {});
process.stdout.write(`${JSON.stringify({ pid: child.pid })}\n`, () => {
  if (mode === 'exit') process.exit(0);
  setInterval(() => {}, 1000); // the child keeps the loop alive too; this says so whatever it does
});
