#!/usr/bin/env node
// Standalone setup passes no deployment request: other registrations survive.
import { captureSetup } from '../lib/capture-setup.mjs';
let result;
try { result = await captureSetup({ argv: process.argv.slice(2) }); }
catch (error) { result = { schemaVersion: 1, ok: false, exitCode: error.code === 'E_USAGE' ? 2 : 1,
  error: { code: error.code ?? 'E_CAPTURE_SETUP_FAILED', message: error.message } }; }
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else if (result.error && !result.summary) console.error(result.error.message);
process.exitCode = result.exitCode;
