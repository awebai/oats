/** Private invocation projection, not a new binding store or action permit.
 * The synchronous caller has already loaded/qualified its exact captured action. */
import { lstatSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { portableStateDirectory } from './portable-state.mjs';
import { canonicalJson } from './portable-values.mjs';
import { validateProviderBinding } from './resolution-shape.mjs';
import { BINDING_LIMITS } from './provider-binding-wire.mjs';
import { oatsError } from './errors.mjs';

export function withCapturedBindingFile({deployment,record,capability},run) {
  const bindings=Object.values(record.bindings).filter(binding=>binding.capability===capability.id);
  if (!bindings.length) return run({});
  if (bindings.length !== 1) throw oatsError('invalid-resolution','one capability cannot consume contradictory slot bindings');
  const binding=validateProviderBinding(bindings[0]),bytes=canonicalJson(binding,BINDING_LIMITS);
  const directory=mkdtempSync(join(portableStateDirectory(deployment,true),'.binding-'));
  const owned=lstatSync(directory),file=join(directory,'binding.json');let primary,result,completed=false;
  try {
    writeFileSync(file,bytes,{flag:'wx',mode:0o600});
    result=run({OATS_BINDING_FILE:file});completed=true;return result;
  } catch(error) {primary=error;throw error;}
  finally {
    try {
      const current=lstatSync(directory);
      if (!current.isDirectory() || current.dev!==owned.dev || current.ino!==owned.ino) throw oatsError('integrity-drift','binding invocation directory ownership changed');
      rmSync(directory,{recursive:true});
    } catch(cleanup) {
      if (!primary) {
        const error=new AggregateError([cleanup],'captured binding cleanup failed after invocation',{cause:cleanup});
        error.code=cleanup.code;error.invocationCompleted=completed;error.invocationResult=result;throw error;
      }
      const error=new AggregateError([primary,cleanup],'captured command and binding cleanup failed',{cause:primary});
      error.code=primary.code;if(primary.invocationCompleted){error.invocationCompleted=true;error.invocationResult=primary.invocationResult;}throw error;
    }
  }
}
