#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { fs, join, dirname, resolve, readJSON, save, safePath, cliPath, oats, fail, unlock } from '../lib/io.mjs';
import { loadBindings, declaration, splitRef } from '../lib/config.mjs';
import { register, homeSource, loadSource, loadStatus, saveStatus, updateStatus, capture, scheduleSource, service, markerPath, views } from '../lib/sources.mjs';
import { runSource, complete, retry, readRun } from '../lib/worker.mjs';
import { initBase, migrate, deliverMigration, cutoverMigration, migrateSource } from '../lib/migration.mjs';
import { inspect } from '../lib/inspection.mjs';
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
oats okf unlock --lock PATH --token TOKEN [--json]
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
      harvest:['home','no-launch'],inspect:['home','source'],
      'run-source':['source','manual','no-launch'],complete:['source','run','judgment'],
      retry:['source','run','rejudge','launch','adopt-home'],read:['home','source','base','path'],refresh:['home','source'],
      setup:['source','enable','disable','install-host'],init:['base','nodes','output','confirm'],
      migrate:['source-home','legacy','base','node','output','deliver','cutover','soul-dir'],unlock:['lock','token']
    };
    for(const k of Object.keys(flags)) if(!['json','soul',...(accepted[event] || [])].includes(k)) fail('E_USAGE',`unknown flag --${k} for ${event}`);
    if(flags.source && flags.home) fail('E_USAGE','choose source descriptor OR home');
    const home=resolve(flags.home || process.env.OATS_INSTANCE_HOME || process.env.OATS_HOME || process.cwd());
    const src=()=>flags.source?loadSource(resolve(flags.source)):homeSource(home);
    let result;
    if(event==='soul-scaffold') {
      // Souls are portable declarations, never an implicit knowledge store.
      result={meta:{scaffolded:false},brief:'OKF requires explicit external bindings and soul/okf.json before a working instance can spawn. Use init or migrate; no knowledge was created in this soul.'};
    } else if(event==='spawn') {
      const s=register(home);
      if(s.skipped) result={meta:{memory:'none'},brief:'Service agent: follow your own task; no working-memory upkeep.'};
      else {
        const schedule=loadStatus(s).schedule.result;
        result={meta:{memory:'okf-v2',source:s.file,schedule},brief:`Knowledge is an immutable accepted snapshot at ./knowledge/. Read knowledge/view.json for base paths under knowledge/bases/<alias>/, then the indexes for ${[...new Set([...s.decl.owns,...s.decl.reads])].join(', ')}. Follow only relevant links. All configured bases are available. Use oats okf read for current accepted text; old views stay stable. Keep STATE.md/log.md/notes/ current; never edit knowledge.`};
      }
    } else if(event==='retire') {
      if(service(home)) result={meta:{retired:true}};
      else if(!fs.existsSync(markerPath(home))) {
        if(['STATE.md','log.md','notes','.okf-harvest-record.json','.okf-harvest-record.next.json'].some(p=>fs.existsSync(join(home,p)))) fail('E_MIGRATION','unregistered/legacy source has memory; explicitly migrate/register before retirement');
        result={meta:{retired:true,reason:'nothing-to-delete'}};
      } else {
        const s=src();scheduleSource(s);const r=capture(s,{final:true});result={meta:{retired:r.complete===true,source:s.file,capture:r},brief:'Final input is in durable custody. Delivery remains asynchronous.'};
      }
    } else if(event==='harvest') {
      const s=register(home);
      result=s.skipped?{status:'skipped',reason:'service'}:runSource(s,{manual:true,noLaunch:!!flags['no-launch']});
    } else if(event==='run-source') result=runSource(src(),{manual:!!flags.manual,noLaunch:!!flags['no-launch']});
    else if(event==='complete') result=complete(src(),flags.run,flags.judgment && resolve(flags.judgment));
    else if(event==='retry') result=retry(src(),{run:flags.run,rejudge:!!flags.rejudge,launch:!!flags.launch,adoptHome:flags['adopt-home']});
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
