#!/usr/bin/env node
// The detached delivery of a judged harvest run, started by `oats okf
// complete` (worker.mjs startDelivery). Progress and outcome are recorded in
// the run's delivery record; this log keeps what the record cannot.
import { loadSource } from './sources.mjs';
import { deliver } from './worker.mjs';
import { redactUrls } from './io.mjs';
const [file, id] = process.argv.slice(2);
const say = text => process.stderr.write(`${new Date().toISOString()} run ${id}: ${text}\n`);
say(`delivery started (pid ${process.pid})`);
try { const result = deliver(loadSource(file), id); say(`delivery finished: ${result.status}`); }
catch (e) { say(`delivery failed: ${e.code || 'E_OKF'}: ${redactUrls(e.message)}`); process.exitCode = 1; }
