// Reading a file in bounded memory: its bytes in chunks, and its lines one at
// a time. Journals, comm logs and transcripts can be far larger than the heap
// (awebai/oats#456), so no reader here ever holds more than one chunk and one
// line.

import { readSync } from "node:fs";

// The bytes of `fd` from `start` up to `end` (default: the end of the file), in
// chunks of at most `size` bytes. Each chunk is a fresh buffer, so a caller may
// keep one past the next read.
export function* fileChunks(fd, { start = 0, end = Infinity, size = 1 << 20 } = {}) {
  for (let position = start; position < end; ) {
    const chunk = Buffer.allocUnsafe(Math.min(size, end - position));
    const n = readSync(fd, chunk, 0, chunk.length, position);
    if (n === 0) return;
    position += n;
    yield chunk.subarray(0, n);
  }
}

// The lines of `chunks`, one at a time: each complete line WITH its newline,
// then a final fragment without one, if the bytes end mid-line. A caller tells
// them apart by the last byte. Fragments are joined only at a newline, so a
// long line is copied once, not as each chunk arrives.
export function* bufferLines(chunks) {
  let pieces = [], size = 0;
  for (const chunk of chunks) {
    let from = 0;
    for (let nl = chunk.indexOf(10, from); nl >= 0; nl = chunk.indexOf(10, from)) {
      pieces.push(chunk.subarray(from, nl + 1));
      size += nl + 1 - from;
      yield pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, size);
      pieces = []; size = 0; from = nl + 1;
    }
    if (from < chunk.length) { pieces.push(chunk.subarray(from)); size += chunk.length - from; }
  }
  if (size > 0) yield pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, size);
}
