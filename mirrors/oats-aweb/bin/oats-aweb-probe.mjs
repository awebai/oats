#!/usr/bin/env node
import {runProbe, formatProbe} from '../lib/probe.mjs';
const abort = new AbortController();
const stop = () => abort.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const args = process.argv.slice(2);
const result = await runProbe(args, {signal: abort.signal});
process.removeListener('SIGINT', stop);
process.removeListener('SIGTERM', stop);
console.log(formatProbe(result, args.includes('--json')));
process.exitCode = result.outcome === 'PASS' ? 0 : 1;
