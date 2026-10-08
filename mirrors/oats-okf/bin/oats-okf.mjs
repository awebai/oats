#!/usr/bin/env node
import { resolve, fail, unlock, redactUrls } from '../lib/io.mjs';
import { loadBindings } from '../lib/config.mjs';
import { service, ensureInstanceKnowledge, consultSource, checkSeat } from '../lib/sources.mjs';
import { CONSULT } from '../lib/consult.mjs';
import { initBase, migrate, deliverMigration, cutoverMigration, forgetMigration } from '../lib/migration.mjs';
import { inspect } from '../lib/inspection.mjs';
import { loadInvocationKnowledgeBinding } from '../lib/binding-wire.mjs';
import { refuseLegacySettings, removeLegacySettings, soulOptOut } from '../lib/legacy-settings.mjs';
const HELP=`oats okf inspect [--home PATH] [--json]
oats okf bases [--fresh] [--json]
oats okf index [--base ALIAS] [NODE | ALIAS/NODE] [--fresh] [--json]
oats okf cat --base ALIAS PATH [--from PATH] [--fresh] [--json]
oats okf ls --base ALIAS [DIR] [--fresh] [--json]
oats okf links --base ALIAS PATH [--fresh] [--json]
oats okf search [--base ALIAS | --all] [--node NODE] [--regex] [--case-sensitive] TEXT [--fresh] [--json]
Consult commands read the accepted state remotely (host cache, no local copy);
also accept --home PATH. PATH is /node/x.md from the base root, relative to
--from's directory, or bare node/x.md from the root.
oats okf init --base ALIAS --nodes FILE [--output PATH | --confirm] [--json]
oats okf migrate --legacy PATH --base ALIAS --node NODE --output PATH [--json]
oats okf migrate --deliver FILE | --cutover FILE --soul-dir PATH | --forget ID [--json]
oats okf unlock --lock PATH --token TOKEN [--json]
oats okf setup --remove-legacy-settings [--plan] --soul SOUL [--json]
  (from the deployment: deletes only settings.oats.okf.harvest/harvest-runtime/harvest-model
  from its oats-local.yaml; --plan writes nothing)
Knowledge reaches the accepted base by proposal: at a checkpoint the working agent writes a
short proposal and runs \`oats spawn oats.okf/knowledge-harvester --task-file FILE --relation unrelated\`
(the spawn brief in TASK.md). All settings use one absolute bindings-file.
`;
// okf 5.0.0: the 4.x harvest surfaces refuse, naming the new way; they never
// capture, run, complete or drain anything.
// The proposal procedure is in the spawn brief only, so a soul that opts out
// (knowledge: { harvest: off }) is never told to propose: the shared inject and
// skills carry no harvest direction.
// The spawn hook answers no meta, on success or failure: the kernel keeps a
// hook's meta as the receipt of external state, and a capability with no retire
// hook that reported one is quarantined when the spawn rolls back. This hook
// only writes STATE.md, log.md and notes/ in the home (removed with it) and
// primes the shared host cache.
const PROPOSE=`At an important checkpoint (a decision made, a PR opened or handed over, a task finished), after updating STATE.md, log.md and notes/, propose what you learned when it passes the promotion test (knowledge-theory) and is not already accepted (\`oats okf search\` first). Write a short, self-contained Markdown proposal in your instance home (proposals/<YYYY-MM-DD>-<slug>.md) with: exactly one line \`Source: instance <your instance name>, home <your instance home>, soul <your soul's name>\` (a pointer for the harvester, which checks it against the deployment's records; never authority); What (the claim, one concept each); Why (why it outlives this task); Evidence (what was observed and when, the accepted concepts it confirms or contradicts, task refs); and optionally Backing notes (notes/<file>.md, relative to your home; the harvester reads only those). No secrets, credentials or private paths outside the Source line. Then, from your instance home, run \`oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated\` (relation unrelated alone; no harness, model, wrapper or permission bypass). One spawn per proposal; report a refused spawn rather than retrying it in a loop, note the proposal in log.md, and keep its backing notes until the harvester hands over its PR. Nothing durable, no proposal.`;
const NEW_WAY='at a checkpoint the working agent writes a short proposal and runs `oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated` from its instance home (its spawn brief in TASK.md); oats.okf 5.0 keeps no source custody, runs or drains and never processes 4.x ones (README#upgrading-to-50)';
const removed=(what)=>fail('E_REMOVED',`${what} was removed in oats.okf 5.0: ${NEW_WAY}`);
const args=process.argv.slice(2);
if(args.includes('--help') || args.includes('-h')) {process.stdout.write(HELP);}
else {
  const event=process.env.OATS_EVENT || args[0];
  const hook=['spawn','soul-scaffold'].includes(event);
  const consult=Object.hasOwn(CONSULT,event);
  let exit=0,answer,text,textMode=consult && !args.includes('--json');
  try {
    // Removed 4.x commands refuse whatever their (old) flags were.
    if(['harvest','run-source','complete','retry','harvest-status'].includes(event)) removed(`oats okf ${event}`);
    const flags={},positionals=[]; const boolean=new Set(['json','confirm','fresh','all','regex','case-sensitive','remove-legacy-settings','plan','enable','disable','install-host','remove-schedules']);
    for(let i=1;i<args.length;i++) {
      if(consult && args[i]==='--') {positionals.push(...args.slice(i+1));break;}
      if(!args[i].startsWith('--')) {if(!consult) fail('E_USAGE',`unexpected argument ${args[i]}`);positionals.push(args[i]);continue;}
      const k=args[i].slice(2);if(k in flags) fail('E_USAGE',`duplicate --${k}`);
      if(boolean.has(k)) flags[k]=true;
      else {if(!args[i+1] || args[i+1].startsWith('--')) fail('E_USAGE',`--${k} needs a value`);flags[k]=args[++i];}
    }
    // Before anything else of this provider (bindings, state, hooks): a
    // forwarded 4.x harvest setting refuses with where it was set and the fix.
    // The one exemption is the cleanup that removes it (help is answered above).
    const cleanup=event==='setup' && flags['remove-legacy-settings']===true;
    if(!cleanup) refuseLegacySettings();
    for(const name of ['OATS_SOURCE_RECEIPT_FILE','OATS_INVOCATION_CONTEXT_FILE']) if(Object.hasOwn(process.env,name)) removed(`the captured source receipt/invocation context (${name})`);
    if(flags.source!==undefined) removed('--source (a 4.x source descriptor)');
    const accepted={
      spawn:[],'soul-scaffold':[],inspect:['home'],read:['home','base','path','fresh'],refresh:['home'],
      bases:['home','fresh'],index:['home','base','fresh'],cat:['home','base','from','fresh'],ls:['home','base','fresh'],
      links:['home','base','fresh'],search:['home','base','all','node','regex','case-sensitive','fresh'],
      setup:['remove-legacy-settings','plan','harvest','enable','disable','install-host','remove-schedules'],init:['base','nodes','output','confirm'],
      migrate:['source-home','legacy','base','node','output','deliver','cutover','soul-dir','forget'],unlock:['lock','token']
    };
    for(const k of Object.keys(flags)) if(!['json','soul',...(accepted[event] || [])].includes(k)) fail('E_USAGE',`unknown flag --${k} for ${event}`);
    if(!cleanup && loadInvocationKnowledgeBinding().kind==='captured' && ['setup','init','migrate','unlock'].includes(event)) fail('E_MIGRATION',`captured ${event} is not supported; use an explicit operator administration path`);
    const home=resolve(flags.home || process.env.OATS_INSTANCE_HOME || process.env.OATS_HOME || process.cwd());
    let result;
    if(event==='read') fail('E_REMOVED','okf 4.0.0 removed read: use `oats okf cat --base ALIAS PATH` (same path, text and receipt)');
    if(consult) {const answer=CONSULT[event](consultSource(home),flags,positionals);result=answer.result;text=answer.text;}
    else if(event==='refresh') fail('E_REMOVED','okf 3.0.0 has no per-instance views; index/cat always read the accepted state: run `oats okf index`, then `oats okf cat --base ALIAS PATH`');
    else if(event==='soul-scaffold') {
      // Souls are portable declarations, never an implicit knowledge store.
      result={meta:{scaffolded:false},brief:'OKF requires explicit external bindings and soul/okf.json before a working instance can spawn. Use init or migrate; no knowledge was created in this soul.'};
    } else if(event==='spawn') {
      if(service(home)) result={brief:'Service agent: follow your own task; no working-memory upkeep.'};
      else {
        const {decl,warnings}=checkSeat(home);ensureInstanceKnowledge(home);
        const nodes=(list)=>list.join(', ') || 'none',optOut=soulOptOut();
        result={brief:`Your soul knowledge is read remotely at its accepted state; there is no local copy. Start every task with your instance knowledge (STATE.md, log.md, notes/), then \`oats okf index\` (owns: ${nodes(decl.owns)}; reads: ${nodes(decl.reads.filter(r=>!decl.owns.includes(r)))}) and \`oats okf cat --base ALIAS PATH\` for the concepts the task needs; \`oats okf search\` before re-deriving a decision. Load okf-consultation and okf-instance-knowledge. Never edit accepted knowledge. ${optOut?'Your soul opts out of harvest (knowledge: { harvest: off }): keep your instance knowledge for your own work, and never propose knowledge or spawn a knowledge harvester.':PROPOSE}`,
          ...(warnings.length?{warning:`oats-okf: ${warnings.join('; ')}`}:{})};
      }
    } else if(event==='inspect') result=inspect(consultSource(home));
    else if(cleanup) {
      const other=Object.keys(flags).filter(k=>!['json','soul','remove-legacy-settings','plan'].includes(k));
      if(other.length) fail('E_USAGE',`--remove-legacy-settings takes only --plan (got --${other.join(', --')})`);
      result=removeLegacySettings({plan:!!flags.plan});
    }
    else if(event==='setup' && flags.harvest!==undefined) removed('setup --harvest (the deployment harvest switch)');
    else if(event==='setup' && (flags.enable || flags.disable || flags['install-host'] || flags['remove-schedules'])) removed('setup --enable/--disable/--install-host/--remove-schedules');
    else if(event==='setup') fail('E_USAGE','setup needs --remove-legacy-settings [--plan]');
    else if(event==='init') result=initBase(loadBindings(),flags.base,flags.nodes,flags.output,{confirm:!!flags.confirm});
    else if(event==='migrate') {
      if(flags['source-home']) removed('migrate --source-home (4.x source registration)');
      else if(flags.forget) result=forgetMigration(loadBindings(),flags.forget);
      else if(flags.deliver) result=deliverMigration(resolve(flags.deliver));
      else if(flags.cutover) result=cutoverMigration(resolve(flags.cutover),flags['soul-dir']);
      else result=migrate(loadBindings(),{legacy:flags.legacy,alias:flags.base,node:flags.node,output:flags.output});
    } else if(event==='unlock') result=unlock(resolve(flags.lock),flags.token);
    else fail('E_USAGE',`unknown command ${event}; see --help`);
    answer=hook?result:{schemaVersion:1,ok:true,result};
  } catch(e) {const code=e.code || 'E_OKF',message=redactUrls(e.message);exit=1;answer=hook?{warning:`oats-okf ${code}: ${message}`}:{schemaVersion:1,ok:false,error:{code,message,...(e.result?{result:e.result}:{})}};}
  // Consult commands print text unless --json; every other answer is JSON.
  // Let Node drain the pipe; no process.exit after a possibly large answer.
  if(textMode && exit) process.stderr.write(`oats okf ${event}: ${answer.error.code}: ${answer.error.message}\n`);
  else if(textMode) process.stdout.write(text+'\n');
  else process.stdout.write(JSON.stringify(answer)+'\n');
  process.exitCode=exit;
}
