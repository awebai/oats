#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { fs, join, dirname, resolve, readJSON, save, safePath, cliPath, oats, fail, unlock } from '../lib/io.mjs';
import { loadBindings, declaration, splitRef } from '../lib/config.mjs';
import { register, registerCaptured, loadInvocationSourceReceipt, homeSource, loadSource, loadStatus, saveStatus, updateStatus, capture, scheduleSource, settleRetiredSchedule, service, markerPath, views } from '../lib/sources.mjs';
import { runSource, complete, retry, readRun, requireQualifiedHelper } from '../lib/worker.mjs';
import { initBase, migrate, deliverMigration, cutoverMigration, migrateSource, forgetMigration } from '../lib/migration.mjs';
import { inspect } from '../lib/inspection.mjs';
import { loadInvocationKnowledgeBinding } from '../lib/binding-wire.mjs';
import { loadCapturedOkfInvocation, loadOkfSourceReceiptInput, assertOkfInvocationAction, requireOkfAdmittedAction, assertOkfSourceContext, assertOkfRegisteredSourceReplay } from '../lib/invocation-context.mjs';
const HELP=`oats okf inspect [--home PATH | --source FILE] [--json]
oats okf harvest [--home PATH] [--no-launch] [--json]
oats okf run-source --source FILE [--manual] [--no-launch] [--json]
oats okf complete --source FILE --run ID --judgment FILE [--json]
oats okf retry --source FILE [--run ID --rejudge | --rejudge | --launch | --adopt-home PATH] [--json]
oats okf read [--home PATH | --source FILE] --base ALIAS [--path node/index.md] [--json]
oats okf refresh [--home PATH | --source FILE] [--json]
oats okf setup --source FILE [--enable | --disable] [--install-host] [--json]
oats okf init --base ALIAS --nodes FILE [--output PATH | --confirm] [--json]
oats okf migrate --legacy PATH --base ALIAS --node NODE --output PATH [--json]
oats okf migrate --deliver FILE | --cutover FILE --soul-dir PATH [--json]
oats okf migrate --source-home PATH [--json]
oats okf migrate --forget ID [--json]
oats okf unlock --lock PATH --token TOKEN [--json]
Captured workers use oats operation run knowledge:harvest with SOURCE --deployment/--resolution/--home,
--arg native-request=ABS_BACKEND_ONLY_JSON and optional --arg worker-mode=prepare|launch.
Raw captured harvest/run-source/scheduler/rejudge remain held; completed runs use SOURCE complete/retry.
Unknown scaffold/native outcomes are retained, never automatically re-scaffolded or redispatched.
Explicit retry --run ID requires --rejudge; add --launch only for operator-approved launch.
Closed-PR recovery uses retained evidence and a fresh run; complete its returned ID.
Settled destinations and old proposals/receipts are preserved; another active run blocks recovery.
All settings use one absolute bindings-file. Setup host installation is explicit.
`;
const args=process.argv.slice(2);
if(args.includes('--help') || args.includes('-h')) {process.stdout.write(HELP);}
else {
  const event=process.env.OATS_EVENT || args[0];
  const hook=['spawn','retire','soul-scaffold'].includes(event);
  let exit=0,answer;
  try {
    const flags={}; const boolean=new Set(['json','no-launch','manual','rejudge','launch','enable','disable','install-host','confirm']);
    for(let i=1;i<args.length;i++) {
      if(!args[i].startsWith('--')) fail('E_USAGE',`unexpected argument ${args[i]}`);
      const k=args[i].slice(2);if(k in flags) fail('E_USAGE',`duplicate --${k}`);
      if(boolean.has(k)) flags[k]=true;
      else {if(!args[i+1] || args[i+1].startsWith('--')) fail('E_USAGE',`--${k} needs a value`);flags[k]=args[++i];}
    }
    const accepted={
      spawn:[],retire:['home'], 'soul-scaffold':[],
      harvest:['home','no-launch','native-request','worker-mode'],inspect:['home','source'],
      'run-source':['source','manual','no-launch'],complete:['source','run','judgment'],
      retry:['source','run','rejudge','launch','adopt-home'],read:['home','source','base','path'],refresh:['home','source'],
      setup:['source','enable','disable','install-host'],init:['base','nodes','output','confirm'],
      migrate:['source-home','legacy','base','node','output','deliver','cutover','soul-dir'],unlock:['lock','token']
    };
    for(const k of Object.keys(flags)) if(!['json','soul',...(accepted[event] || [])].includes(k)) fail('E_USAGE',`unknown flag --${k} for ${event}`);
    if(flags.source && flags.home) fail('E_USAGE','choose source descriptor OR home');
    const execution=Object.hasOwn(process.env,'OATS_INVOCATION_CONTEXT_FILE')?loadCapturedOkfInvocation():null;
    const invocation=execution?{kind:'captured',binding:execution.binding}:loadInvocationKnowledgeBinding(),captured=invocation.kind==='captured';
    if(execution) assertOkfInvocationAction(execution.context,event,readJSON(new URL('../oats.json',import.meta.url)));
    // Only an actual admitted, instance-scoped kernel operation can create a
    // captured worker. Raw commands/null intents and legacy ingress stay closed.
    const capturedHarvest=captured && execution?.context.action.kind==='operation' && execution.context.action.slot==='knowledge' && execution.context.action.name==='harvest';
    if(captured && event==='harvest') {
      if(!capturedHarvest)requireQualifiedHelper({providerBinding:invocation.binding});
      requireOkfAdmittedAction(execution.context);
      if(!flags['native-request']||!['prepare','launch'].includes(flags['worker-mode']||'launch'))fail('E_CAPTURED_HELPER','captured harvest needs explicit native-request and supported worker-mode');
    }
    const unsupportedCaptured=new Set(['setup','init','migrate','unlock']);
    if(captured && unsupportedCaptured.has(event)) fail('E_MIGRATION',`captured ${event} is not supported; use an explicit operator administration path`);
    const target=execution?.context.instance;
    if(target && flags.home && resolve(flags.home)!==target.home) fail('E_INVOCATION','captured invocation target differs from requested home');
    const home=target?.home || resolve(flags.home || (execution?process.cwd():process.env.OATS_INSTANCE_HOME || process.env.OATS_HOME || process.cwd()));
    if(execution && ['spawn','retire'].includes(event)) requireOkfAdmittedAction(execution.context);
    const sourceReceipt=execution?loadOkfSourceReceiptInput(execution):loadInvocationSourceReceipt(home);
    if(sourceReceipt.mode==='captured' && !['spawn','retire'].includes(event)) fail('E_SOURCE','captured source receipt is valid only for lifecycle hooks');
    const src=()=>{
      try {
        const source=flags.source?loadSource(resolve(flags.source)):homeSource(home);
        if(execution) assertOkfSourceContext(source,execution.context,execution.binding);
        else if(captured) assertOkfRegisteredSourceReplay(source,invocation.binding);
        else if(source.providerBinding && event!=='inspect') fail('E_INVOCATION','captured source execution requires its selected binding');
        return source;
      } catch(error) {if(captured && ['ENOENT','ENOTDIR'].includes(error.code)) fail('E_SOURCE','captured command requires its durable registered source descriptor');throw error;}
    };
    // Deliberate old registered-source replay is a separate qualified contract,
    // never a way to create a source or synthesize generic admission. A present
    // invalid/unadmitted generic invocation cannot enter this compatibility path.
    if(captured && !execution && Object.hasOwn(accepted,event) && event!=='soul-scaffold') {
      if(!fs.existsSync(flags.source?resolve(flags.source):markerPath(home))) fail('E_ADMISSION','new captured registration requires generic admitted invocation inputs');
      src();
    }
    if(['spawn','retire'].includes(event)) {
      // A generic intent authorizes its action, not missing source/role input.
      // Absence may replay an already qualified source, never create one or
      // infer a helper skip from an ambient kind/name/knowledge-slot heuristic.
      if(captured && sourceReceipt.mode!=='captured' && !fs.existsSync(markerPath(home))) fail('E_SOURCE','new captured registration requires SourceReceipt1 input authority');
      if(execution && fs.existsSync(markerPath(home))) src();
      if(!captured && fs.existsSync(join(home,'instance.json')) && Object.hasOwn(readJSON(safePath(join(home,'instance.json'))),'executionBinding')) fail('E_INVOCATION','captured home cannot use legacy lifecycle ingress');
    }
    // Scope commands have no kernel instance intent. They may finish only
    // already retained runs under their exact source binding/descriptor, never
    // allocate a new worker or infer an incarnation for a deleted source.
    const retainedRun=s=>{
      const id=event==='complete'?flags.run:loadStatus(s).activeRun;
      if(!id) {if(event==='complete') fail('E_RUN','complete requires an existing --run');requireQualifiedHelper(s);}
      readRun(s,id);return s;
    };
    let result;
    if(event==='soul-scaffold') {
      // Souls are portable declarations, never an implicit knowledge store.
      result={meta:{scaffolded:false},brief:'OKF requires explicit external bindings and soul/okf.json before a working instance can spawn. Use init or migrate; no knowledge was created in this soul.'};
    } else if(event==='spawn') {
      const s=sourceReceipt.mode==='captured'?registerCaptured(home,sourceReceipt.receipt):register(home);
      if(s.skipped) result={meta:{memory:'none'},brief:'Service agent: follow your own task; no working-memory upkeep.'};
      else {
        const schedule=loadStatus(s).schedule.result;
        result={meta:{memory:'okf-v2',source:s.file,schedule},brief:`Knowledge is an immutable accepted snapshot at ./knowledge/. Read knowledge/view.json for base paths under knowledge/bases/<alias>/, then the indexes for ${[...new Set([...s.decl.owns,...s.decl.reads])].join(', ')}. Follow only relevant links. All configured bases are available. Use oats okf read for current accepted text; old views stay stable. Keep STATE.md/log.md/notes/ current; never edit knowledge.`};
      }
    } else if(event==='retire') {
      if(captured) {
        let s;
        if(sourceReceipt.mode==='captured') {s=registerCaptured(home,sourceReceipt.receipt);if(s.skipped) {result={meta:{retired:true,reason:'service'}};s=null;}}
        else {if(!fs.existsSync(markerPath(home))) fail('E_MIGRATION','captured retire requires a durable registered source or explicit helper receipt');s=src();}
        if(s) {scheduleSource(s);const r=capture(s,{final:true});const schedule=settleRetiredSchedule(s);result={meta:{retired:r.complete===true,source:s.file,capture:r,schedule},brief:'Final input is in durable custody. Delivery remains asynchronous.'};}
      } else if(service(home)) result={meta:{retired:true}};
      else if(!fs.existsSync(markerPath(home))) {
        if(['STATE.md','log.md','notes','.okf-harvest-record.json','.okf-harvest-record.next.json'].some(p=>fs.existsSync(join(home,p)))) fail('E_MIGRATION','unregistered/legacy source has memory; explicitly migrate/register before retirement');
        result={meta:{retired:true,reason:'nothing-to-delete'}};
      } else {
        const s=src();scheduleSource(s);const r=capture(s,{final:true});const schedule=settleRetiredSchedule(s);result={meta:{retired:r.complete===true,source:s.file,capture:r,schedule},brief:'Final input is in durable custody. Delivery remains asynchronous.'};
      }
    } else if(event==='harvest') {
      if(capturedHarvest) {
        const s=src(); // existing registered descriptor ONLY; never new registration.
        result=runSource(s,{manual:true,noLaunch:!!flags['no-launch']||flags['worker-mode']==='prepare',capturedInvocation:execution.context,nativeRequest:flags['native-request']});
      } else {
        if(flags['native-request']||flags['worker-mode'])fail('E_USAGE','native-request/worker-mode require an admitted captured operation');
        // Snapshot absence does not turn a persisted captured source into legacy.
        if(fs.existsSync(markerPath(home))) requireQualifiedHelper(src());
        const s=register(home);
        result=s.skipped?{status:'skipped',reason:'service'}:runSource(s,{manual:true,noLaunch:!!flags['no-launch']});
      }
    } else if(event==='run-source') result=runSource(src(),{manual:!!flags.manual,noLaunch:!!flags['no-launch']});
    else if(event==='complete') {const s=src();if(captured) retainedRun(s);result=complete(s,flags.run,flags.judgment && resolve(flags.judgment));}
    else if(event==='retry') {const s=src();if(captured && !flags.run && !flags.rejudge && !flags.launch && !flags['adopt-home']) retainedRun(s);result=retry(s,{run:flags.run,rejudge:!!flags.rejudge,launch:!!flags.launch,adoptHome:flags['adopt-home']});}
    else if(event==='inspect') result=inspect(src());
    else if(event==='setup') {
      const s=src();if(flags.enable && flags.disable) fail('E_USAGE','choose enable or disable');
      scheduleSource(s);
      if(flags.enable || flags.disable) {oats(['schedule',flags.enable?'enable':'disable',`okf-${s.id}`,'--dir',s.context,'--json'],s.context);updateStatus(s,current=>{current.auto=!!flags.enable;});}
      if(flags['install-host']) oats(['schedule','host','install','--dir',s.context,'--json'],s.context);
      result={source:s.file,scheduler:oats(['schedule','list','--dir',s.context,'--json'],s.context).scheduler};
    } else if(event==='read' || event==='refresh') {
      const s=src();
      // A descriptor-selected read is independent of any invoking/source home.
      // In particular, retired sources must not leave caches in context/repo.
      const target=join(flags.source?join(dirname(s.file),'views'):home,`knowledge-view-${randomUUID()}`);
      const receipts=views(s.bindings,s.decl,target);
      if(event==='refresh') result={path:target,receipts};
      else {
        if(!Object.hasOwn(s.bindings.bases,flags.base || '')) fail('E_CONFIG','unknown --base');
        const basePath=join(target,receipts[flags.base].path);
        const p=safePath(join(basePath,flags.path || 'index.md'));
        if(!p.startsWith(basePath+'/') || !p.endsWith('.md')) fail('E_PATH','read only contained Markdown');
        result={path:p,text:fs.readFileSync(p,'utf8'),receipt:receipts[flags.base]};
      }
    } else if(event==='init') result=initBase(loadBindings(),flags.base,flags.nodes,flags.output,{confirm:!!flags.confirm});
    else if(event==='migrate') {
      if(flags['source-home']) result=migrateSource(loadBindings(),flags['source-home']);
      else if(flags.forget) result=forgetMigration(loadBindings(),flags.forget);
      else if(flags.deliver) result=deliverMigration(resolve(flags.deliver));
      else if(flags.cutover) result=cutoverMigration(resolve(flags.cutover),flags['soul-dir']);
      else result=migrate(loadBindings(),{legacy:flags.legacy,alias:flags.base,node:flags.node,output:flags.output});
    } else if(event==='unlock') result=unlock(resolve(flags.lock),flags.token);
    else fail('E_USAGE',`unknown command ${event}; see --help`);
    answer=hook?result:{schemaVersion:1,ok:true,result};
  } catch(e) {exit=1;answer=hook?{meta:{...(event==='retire'?{retired:false,reason:e.message}:{})},warning:`oats-okf: ${e.message}`}:{schemaVersion:1,ok:false,error:{code:e.code || 'E_OKF',message:e.message}};}
  // Let Node drain the pipe; no process.exit after a possibly large view.
  process.stdout.write(JSON.stringify(answer)+'\n');process.exitCode=exit;
}
