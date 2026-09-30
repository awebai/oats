#!/usr/bin/env node
import { runBindingWire } from '../lib/binding-wire.mjs';

const args=process.argv.slice(2);
if(args.includes('--help') || args.includes('-h')) {
  process.stdout.write('oats okf provider binding phase (manifest-owned JSON stdin/stdout)\n');
} else {
  const phase=args[0];
  if(args.length!==1) {
    await runBindingWire(phase,[],process.stdout);
  } else {
    await runBindingWire(phase);
  }
}
