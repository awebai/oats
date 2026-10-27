// A kernel change that outlives its client (file-output-exec.test.mjs): it waits until the client's pid is gone,
// then writes more than a pipe holds to both stdout and stderr, then writes a marker (JSON, renamed into place)
// with each write's result. Node ignores SIGPIPE, so a write to a pipe nobody reads fails with EPIPE, recorded.
//   node stand-in-kernel.mjs <client pid> <marker>
import { renameSync, writeFileSync, writeSync } from 'node:fs';

const [clientPid, marker] = [Number(process.argv[2]), process.argv[3]];
const SIZE = 256 * 1024, CHUNK = Buffer.alloc(16 * 1024, 'x');
const gone = () => { try { process.kill(clientPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
const finish = (facts) => { writeFileSync(`${marker}.tmp`, JSON.stringify(facts)); renameSync(`${marker}.tmp`, marker); process.exit(0); };

function writeAll(fd) {
  let written = 0;
  try { while (written < SIZE) written += writeSync(fd, CHUNK, 0, Math.min(CHUNK.length, SIZE - written)); return { written, error: null }; }
  catch (error) { return { written, error: error.code ?? String(error) }; }
}

const deadline = Date.now() + 20_000;
const poll = setInterval(() => {
  if (gone()) { clearInterval(poll); finish({ stdout: writeAll(1), stderr: writeAll(2), size: SIZE }); }
  else if (Date.now() > deadline) { clearInterval(poll); finish({ gaveUp: true }); }
}, 20);
