import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { assessCapturedSessionReadiness } from './session-readiness.mjs';
import { custodyPreflight } from './grant-custody.mjs';
import { brokerDelivers, joinedReceiveModes, recordedRuntime, recordedStart } from './wake-receive.mjs';
import {
  MESSAGING_CONTRACT,
  MESSAGING_CONTRACT_VERSION,
  bindMessagingDomain,
  normalizeMessagingDeclarations,
  validateAwebBinding,
  validateAwebInvocationContext,
} from './portable-binding.mjs';

export const BINDING_WIRE_LIMITS=Object.freeze({bytes:1024*1024,depth:32,entries:16384});
const CAPABILITY='oats.aweb',SLOT='messaging';
const phases=new Set(['normalize','bind','check']);
const declarationKinds=new Set(['soul','workspace','adoption','operator']);
const errorCodes=new Set(['needs-configuration','requirement-conflict','invalid-binding','authorization-required','host-requirement-missing','provider-unavailable','provider-not-qualified']);
const TEAM_SETTING_MESSAGE='teams are not a setting since oats.aweb 1.17 / OATS 0.30: use oats teams / oats soul teams';
const AWEB_TEAM_ID_MESSAGE='aweb team ids must have shape <name>:<namespace> (name matches ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$; namespace is a hostname)';
const obj=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const wireError=(code,message=code)=>{throw Object.assign(new Error(message),{wireCode:code});};
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const same=(a,b)=>canonical(a)===canonical(b);
function keys(value,allowed,required) {
  if(!obj(value)) wireError('invalid-binding');
  for(const key of Object.keys(value)) if(!allowed.includes(key)) wireError('invalid-binding');
  for(const key of required) if(!Object.hasOwn(value,key)) wireError('invalid-binding');
  return value;
}
function pointer(value) {return typeof value==='string' && /^(?:\/(?:[^~]|~[01])*)+$/.test(value);}
function bindingKey(value) {return pointer(value) && value.startsWith('/bindings/messaging/') && value.length>'/bindings/messaging/'.length;}

class StrictJsonParser {
  constructor(text,{depth,entries}) {this.text=text;this.maxDepth=depth;this.maxEntries=entries;this.at=0;this.entries=0;}
  whitespace() {while(/[\u0009\u000a\u000d\u0020]/.test(this.text[this.at] || '')) this.at++;}
  count() {if(++this.entries>this.maxEntries) wireError('invalid-binding');}
  string() {
    if(this.text[this.at]!=='"') wireError('invalid-binding');
    const start=this.at++;
    while(this.at<this.text.length) {
      const code=this.text.charCodeAt(this.at++);
      if(code===0x22) {try{return JSON.parse(this.text.slice(start,this.at));}catch{wireError('invalid-binding');}}
      if(code<0x20) wireError('invalid-binding');
      if(code===0x5c) {
        const escaped=this.text[this.at++];
        if(escaped==='u') {if(!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.at,this.at+4))) wireError('invalid-binding');this.at+=4;}
        else if(!'"\\/bfnrt'.includes(escaped || '')) wireError('invalid-binding');
      }
    }
    wireError('invalid-binding');
  }
  value(depth=1) {
    this.whitespace();const char=this.text[this.at];
    if(char==='"') return this.string();
    if(char==='{') {
      if(depth>this.maxDepth) wireError('invalid-binding');this.at++;this.whitespace();
      const result=Object.create(null),seen=new Set();if(this.text[this.at]==='}') {this.at++;return result;}
      while(true) {
        this.whitespace();const key=this.string();if(seen.has(key)) wireError('invalid-binding');seen.add(key);this.count();
        this.whitespace();if(this.text[this.at++]!==':') wireError('invalid-binding');result[key]=this.value(depth+1);this.whitespace();
        const next=this.text[this.at++];if(next==='}') return result;if(next!==',') wireError('invalid-binding');
      }
    }
    if(char==='[') {
      if(depth>this.maxDepth) wireError('invalid-binding');this.at++;this.whitespace();
      const result=[];if(this.text[this.at]===']') {this.at++;return result;}
      while(true) {this.count();result.push(this.value(depth+1));this.whitespace();const next=this.text[this.at++];if(next===']') return result;if(next!==',') wireError('invalid-binding');}
    }
    for(const [token,value] of [['true',true],['false',false],['null',null]]) if(this.text.startsWith(token,this.at)) {this.at+=token.length;return value;}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.at));
    if(!match) wireError('invalid-binding');this.at+=match[0].length;const number=Number(match[0]);if(!Number.isFinite(number)) wireError('invalid-binding');return number;
  }
  parse() {this.whitespace();const value=this.value();this.whitespace();if(this.at!==this.text.length) wireError('invalid-binding');return value;}
}

export function parseBindingJson(bytes,limits=BINDING_WIRE_LIMITS) {
  if(!Buffer.isBuffer(bytes)) bytes=Buffer.from(bytes);
  if(bytes.length>limits.bytes) wireError('invalid-binding');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{wireError('invalid-binding');}
  return new StrictJsonParser(text,limits).parse();
}
function settings(value,{phase}={}) {
  if(!obj(value)) wireError('invalid-binding');
  if(Object.hasOwn(value,'team')) wireError('needs-configuration',TEAM_SETTING_MESSAGE);
  if(phase!=='check' && Object.hasOwn(value,'identity')) wireError('provider-not-qualified');
  keys(value,phase==='check'?['delivery','root','roots','identity','residents','join']:['delivery','root','roots','join'],[]);
  if(value.delivery!==undefined && !['channel','session'].includes(value.delivery)) wireError('needs-configuration');
  if(value.root!==undefined && (typeof value.root!=='string' || !value.root.trim())) wireError('needs-configuration');
  if(value.join!==undefined && typeof value.join!=='string') wireError('needs-configuration');
  if(value.roots!==undefined && !obj(value.roots)) wireError('needs-configuration');
  if(obj(value.roots)) for(const [team,root] of Object.entries(value.roots)) if(!team || typeof root!=='string' || !root.trim()) wireError('needs-configuration');
  if(value.identity!==undefined && !obj(value.identity)) wireError('needs-configuration');
  if(value.residents!==undefined && !obj(value.residents)) wireError('needs-configuration');
  if(obj(value.residents)) for(const [name,custody] of Object.entries(value.residents)) if(!name || typeof custody!=='string' || !custody.trim()) wireError('needs-configuration');
  return value;
}
function request(value,phase) {
  keys(value,['schemaVersion','phase','slot','capability','settings','input'],['schemaVersion','phase','slot','capability','settings','input']);
  if(value.schemaVersion!==1 || value.phase!==phase || value.slot!==SLOT || value.capability!==CAPABILITY) wireError('invalid-binding');
  settings(value.settings,{phase});return value;
}
function declaration(value) {
  keys(value,['kind','value','origin','origins'],['kind','value','origin','origins']);
  if(!declarationKinds.has(value.kind) || !obj(value.value) || !obj(value.origin) || !obj(value.origins)) wireError('invalid-binding');
  return value;
}
function context(value,{request=false}={}) {
  if(value?.kind==='workspace') {
    keys(value,request?['kind','identity','observation']:['kind','identity'],request?['kind','identity','observation']:['kind','identity']);
    if(!obj(value.identity) || (request && !obj(value.observation))) wireError('invalid-binding');
    return {kind:'workspace',identity:value.identity};
  }
  if(value?.kind==='standalone') {
    keys(value,['kind','key'],['kind','key']);
    if(value.key!==null && (typeof value.key!=='string' || !value.key.trim())) wireError('invalid-binding');
    return {kind:'standalone',key:value.key};
  }
  wireError('invalid-binding');
}
function normalizePhase(req) {
  keys(req.input,['declarations','context'],['declarations','context']);
  if(!Array.isArray(req.input.declarations)) wireError('invalid-binding');
  const declarations=req.input.declarations.map(declaration);context(req.input.context,{request:true});
  return normalizeMessagingDeclarations({declarations,context:req.input.context});
}
function choiceMap(value,model) {
  if(!obj(value)) wireError('invalid-binding');
  const allowed=new Set(['/bindings/messaging/responsibleHuman','/bindings/messaging/privateTeam','/bindings/messaging/wider',...Object.values(model.teams)]);
  for(const [key,choice] of Object.entries(value)) {
    if(!bindingKey(key) || !allowed.has(key)) wireError('invalid-binding');
    keys(choice,['value','selectedBy','constraints','considered'],['value','selectedBy','constraints','considered']);
    if(!Array.isArray(choice.constraints) || !Array.isArray(choice.considered) || (choice.selectedBy!==null && !obj(choice.selectedBy))) wireError('invalid-binding');
  }
  return value;
}
function model(value) {
  keys(value,['contract','version','context','contextOrigin','requested','requestedOrigins','aliases','aliasOrigins','teams','privatePolicy','privatePolicyOrigin'],['contract','version','context','contextOrigin','requested','requestedOrigins','aliases','aliasOrigins','teams','privatePolicy','privatePolicyOrigin']);
  if(value.contract!==MESSAGING_CONTRACT || value.version!==MESSAGING_CONTRACT_VERSION || !Array.isArray(value.requested) || !obj(value.requestedOrigins) || !obj(value.aliases) || !obj(value.aliasOrigins) || !obj(value.teams) || typeof value.privatePolicy!=='boolean') wireError('invalid-binding');
  context(value.context);if(value.contextOrigin!==null && !obj(value.contextOrigin)) wireError('invalid-binding');if(value.privatePolicyOrigin!==null && !obj(value.privatePolicyOrigin)) wireError('invalid-binding');
  for(const key of Object.values(value.teams)) if(!bindingKey(key)) wireError('invalid-binding');
  return value;
}
function bindPhase(req) {
  keys(req.input,['model','choices','context'],['model','choices','context']);
  const normalized=model(req.input.model),selectedContext=context(req.input.context,{request:true});
  if(!same(selectedContext,normalized.context) || (selectedContext.kind==='workspace' && !same(req.input.context.observation,normalized.contextOrigin))) wireError('invalid-binding');
  return bindMessagingDomain({model:normalized,choices:choiceMap(req.input.choices,normalized)});
}
function binding(value) {
  keys(value,['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance'],['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance']);
  if(value.schemaVersion!==1 || value.capability!==CAPABILITY || value.payloadContract!==MESSAGING_CONTRACT || value.payloadVersion!==MESSAGING_CONTRACT_VERSION || !obj(value.payload) || !obj(value.credentialRefs) || Object.keys(value.credentialRefs).length || !Array.isArray(value.provenance)) wireError('invalid-binding');
  for(const origin of value.provenance) if(!obj(origin)) wireError('invalid-binding');
  return value;
}
function checkResult(message) {return {status:'needs-configuration',problems:[{code:'needs-configuration',message}]};}
function checkProblems(problems) {return problems.length?{status:'needs-configuration',problems}:null;}
function workspaceReadinessContext(value) {
  keys(value,['kind','workspace','deployment','soul','team','instance','home'],['kind','workspace','deployment','soul']);
  if(value.kind!=='workspace' || typeof value.workspace!=='string' || !value.workspace.trim() || typeof value.deployment!=='string' || !value.deployment.trim() || typeof value.soul!=='string' || !value.soul.trim()) wireError('invalid-binding');
  if(value.team!==null && value.team!==undefined && (typeof value.team!=='string' || !value.team.trim())) wireError('invalid-binding');
  if(value.instance!==null && value.instance!==undefined && (typeof value.instance!=='string' || !value.instance.trim())) wireError('invalid-binding');
  if(value.home!==null && value.home!==undefined && (typeof value.home!=='string' || !value.home.trim())) wireError('invalid-binding');
  return value;
}
function yamlScalar(text,key){const m=String(text).match(new RegExp(`^${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`,'m'));return m?m[1].trim():undefined;}
export const AW_MIN = '1.36.13';
export const NO_TEAMS_MESSAGE='no teams configured: run `oats aweb setup`';
/** The default team has a label but no provider id. The remedy names both forms of a new default, since a
 *  workspace without `localTeams: true` refuses `oats teams default` (team model 3). */
export const unmappedDefaultMessage=(label)=>`the default team ${label} has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: \`oats teams default <label>\`, or \`defaultTeam:\` in oats-workspace.yaml when the workspace doesn't allow local teams`;
const AW_VERSION_RE=/aw\s+v?(\d+\.\d+\.\d+)/;
/** The installed aw version ("x.y.z"), or undefined when it cannot be read.
 *  `aw version` prints its version line first and then makes a blocking update
 *  check against GitHub (aw 1.36.17 cmd/aw/root.go versionCmd, which ignores
 *  AW_NO_UPDATE_CHECK), so the reader resolves at the first stdout match and
 *  kills the child instead of waiting for it. The ceiling still bounds a child
 *  that never prints; a child that exits without a match is unreadable. The
 *  promise settles only after the child has exited, so no aw is left behind. */
export function readAwVersion({timeout=10000,env=process.env}={}) {
  return new Promise((settle) => {
    const childEnv={...env,AW_NO_UPDATE_CHECK:'1'};delete childEnv.AWEB_IDENTITY_HOME;
    let child,text='',answer,decided=false,exited=false,timer;
    // 'exit' can precede the last stdout chunk, so only 'close' judges the
    // output of a child that ended on its own; a decided read waits for 'exit'.
    const decide=(value) => {if(decided) return;decided=true;answer=value;clearTimeout(timer);if(exited) settle(answer);else child.kill('SIGKILL');};
    try {child=spawn('aw',['version'],{env:childEnv,stdio:['ignore','pipe','ignore']});} catch {settle(undefined);return;}
    timer=setTimeout(() => decide(undefined),timeout);
    child.on('error',() => {exited=true;decide(undefined);settle(answer);});
    child.on('exit',() => {exited=true;if(decided) settle(answer);});
    child.on('close',() => decide(AW_VERSION_RE.exec(text)?.[1]));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk) => {text=(text+chunk).slice(-4096);const m=AW_VERSION_RE.exec(text);if(m) decide(m[1]);});
  });
}
const CLASSIC_REFUSAL = 'oats.aweb 1.14 needs OATS 0.26.0 or newer (workspace model); on an older kernel pin oats.aweb v1.13.x';
function classicEnv(env=process.env) {return !!env.OATS_TEAM_SCOPE && !(env.OATS_WORKSPACE_KEY || env.OATS_WORKSPACE_NAME || env.OATS_DEFAULT_TEAM);}
export function grantYamlCustodySocket(text) {
  const lines=String(text??'').split(/\r?\n/);let inCustody=false,baseIndent=0;
  for(const line of lines) {
    const custody=/^(\s*)custody:\s*(?:#.*)?$/.exec(line);if(custody){inCustody=true;baseIndent=custody[1].length;continue;}
    if(inCustody){const ind=/^(\s*)/.exec(line)?.[1].length||0;if(line.trim()&&ind<=baseIndent)inCustody=false;const socket=/^\s*socket_path:\s*["']?([^"'\n#]+)["']?\s*$/.exec(line);if(socket)return socket[1].trim();}
  }
  return undefined;
}
function newestGrantHome(home) {
  if(typeof home!=='string'||!home.trim()) return null;
  try {
    const dirs=readdirSync(home).filter((name)=>name==='.aweb-identity'||/^\.aweb-identity-\d+$/.test(name)).map((name)=>join(home,name)).filter((p)=>{try{return statSync(p).isDirectory();}catch{return false;}}).map((p)=>{try{return {path:p,mtime:statSync(p).mtimeMs};}catch{return {path:p,mtime:0};}}).sort((a,b)=>b.mtime-a.mtime||b.path.localeCompare(a.path));
    return dirs[0]?.path||null;
  } catch {return null;}
}
function grantAttachmentProblem(home) {
  const grantHome=newestGrantHome(home);
  if(!grantHome) return null;
  const grantYaml=join(grantHome,'grant.yaml');
  if(!existsSync(grantYaml)) return null;
  let text;try{text=readFileSync(grantYaml,'utf8');}catch{return null;}
  if(grantYamlCustodySocket(text)) return null;
  const id=yamlScalar(text,'grant_id')||'<unknown>';
  return {code:'custody',message:`grant ${id} is not attached to custody; retire and respawn on aw >= ${AW_MIN}`};
}
function activeTeamAt(root){try{const text=readFileSync(join(resolve(root),'.aw','teams.yaml'),'utf8');return yamlScalar(text,'active_team')||yamlScalar(text,'active');}catch{return undefined;}}
function residentCustodyRoot(settings){const identity=obj(settings.identity)?settings.identity:{},residents=obj(settings.residents)?settings.residents:{};const name=typeof identity.resident==='string'?identity.resident:'';const root=name&&typeof residents[name]==='string'?residents[name]:undefined;return identity.mode==='global'&&root&&isAbsolute(root)?root:undefined;}
function teamFromSettings(settings,candidate,{env=process.env}={}) {
  return typeof env.OATS_DEFAULT_TEAM_ID==='string' && env.OATS_DEFAULT_TEAM_ID.trim()?env.OATS_DEFAULT_TEAM_ID.trim():undefined;
}
function rootCandidate(settings,team,{deployment,env=process.env}={}) {
  const roots=obj(settings.roots)?settings.roots:{};
  if(team && typeof roots[team]==='string' && roots[team].trim()) return {root:roots[team].trim(),key:`settings.oats.aweb.roots[${JSON.stringify(team)}]`,declared:true};
  if(typeof settings.root==='string' && settings.root.trim()) return {root:settings.root.trim(),key:'settings.oats.aweb.root',declared:true};
  const candidates=[env.OATS_WORKSPACE || deployment || process.cwd()];
  for(const root of candidates) if(isAbsolute(root) && existsSync(join(resolve(root),'.aw'))) return {root,key:'settings.oats.aweb.root',declared:false};
  return {root:candidates[0] || process.cwd(),key:'settings.oats.aweb.root',declared:false};
}
function validHostname(value){const s=String(value||'');return s.length<=253&&s.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));}
function validAwebTeamId(value){const m=/^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(value||''));return !!m&&validHostname(m[2]);}
function invalidAwebTeamId(env=process.env){const id=typeof env.OATS_DEFAULT_TEAM_ID==='string'&&env.OATS_DEFAULT_TEAM_ID.trim()?env.OATS_DEFAULT_TEAM_ID.trim():null;if(id&&!validAwebTeamId(id))return id;try{const rows=JSON.parse(env.OATS_TEAMS||'[]');if(Array.isArray(rows))for(const r of rows)if(r&&typeof r.team==='string'&&r.team.trim()&&!validAwebTeamId(r.team.trim()))return r.team.trim();}catch{}return null;}
function parseOatsTeams(env=process.env){try{const rows=JSON.parse(env.OATS_TEAMS||'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r==='object').map(r=>({label:String(r.label||''),team:typeof r.team==='string'?r.team:null,default:r.default===true,from:r.from==='shared'?'shared':'local'})):[];}catch{return [];}}
function primaryTeamLabel(env=process.env){return typeof env.OATS_DEFAULT_TEAM==='string'&&env.OATS_DEFAULT_TEAM.trim()?env.OATS_DEFAULT_TEAM.trim():null;}
function unmappedPrimary(env=process.env){return undefined;}
function joinedTeams(home){if(!home)return[];try{const doc=JSON.parse(readFileSync(join(home,'.oats-aweb','teams.json'),'utf8'));return Array.isArray(doc.joinedTeams)?doc.joinedTeams.filter(j=>j&&typeof j==='object'&&j.label&&j.team&&j.identityHome):[];}catch{return[];}}
async function readinessDetails(settings,{deployment,env=process.env}={}) {
  if(classicEnv(env)) return {team:undefined,candidate:null,warnings:[],result:{status:'needs-configuration',problems:[{code:'needs-configuration',message:CLASSIC_REFUSAL}]}};
  const invalidTeam=invalidAwebTeamId(env);if(invalidTeam)return {team:undefined,candidate:null,warnings:[],result:{status:'needs-configuration',problems:[{code:'needs-configuration',message:AWEB_TEAM_ID_MESSAGE}]}};
  const team=teamFromSettings(settings,null,{env}),candidate=rootCandidate(settings,team,{deployment,env}),problems=[],warnings=[];
  const awProblem=await awFloorProblem();if(awProblem) problems.push(awProblem);
  if(!team) {
    const label=typeof env.OATS_DEFAULT_TEAM==='string'&&env.OATS_DEFAULT_TEAM.trim()?env.OATS_DEFAULT_TEAM.trim():'';
    problems.push({code:'needs-configuration',message:label?unmappedDefaultMessage(label):NO_TEAMS_MESSAGE});
  }
  if(!candidate.root || !isAbsolute(candidate.root) || !existsSync(join(resolve(candidate.root),'.aw'))) problems.push({code:'needs-configuration',message:`no messaging root at ${candidate.root?resolve(candidate.root):process.cwd()}: run oats aweb setup there or set ${candidate.key}`});
  return {team,candidate,warnings,result:checkProblems(problems) || {status:'ready',problems:[]}};
}
async function readinessFromSettings(settings,options) {return (await readinessDetails(settings,options)).result;}
function runAw(argv,cwd,{unsetEnv=[],timeout=60000}={}) {
  // An inherited AWEB_IDENTITY_HOME is the caller's identity, never this check's.
  const env={...process.env,AW_NO_UPDATE_CHECK:'1'};delete env.AWEB_IDENTITY_HOME;for(const name of unsetEnv) delete env[name];
  try {return execFileSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();}
  catch(e) {throw new Error(`${argv.slice(0,3).join(' ')} failed${e.status===undefined?'':` (exit ${e.status})`}`);}
}
function semverLt(a,b) {const A=String(a||'0.0.0').split('.').map(n=>Number(n)||0),B=String(b).split('.').map(n=>Number(n)||0);for(let i=0;i<3;i++){if((A[i]||0)!==(B[i]||0)) return (A[i]||0)<(B[i]||0);}return false;}
function onPath(cmd,env=process.env){for(const dir of String(env.PATH||'').split(delimiter)){if(!dir)continue;try{const st=statSync(join(dir,cmd));if(st.isFile()&&(st.mode&0o111))return true;}catch{}}return false;}
async function awFloorProblem(){if(!onPath('aw'))return{code:'needs-configuration',message:`aw CLI not on PATH; install aw >= ${AW_MIN}`};const installed=await readAwVersion();if(!installed)return{code:'needs-configuration',message:`aw version could not be read; install aw >= ${AW_MIN}`};return !semverLt(installed,AW_MIN)?null:{code:'needs-configuration',message:`aw ${installed} is older than required ${AW_MIN}; install aw >= ${AW_MIN}`};}
function wakeReadiness(home,{reliedOn=false}={}) {
  if(!home || !reliedOn) return {problems:[],warnings:[]};
  try {
    const doc=JSON.parse(runAw(['aw','wake','status','--json'],home,{timeout:10000}));
    const state=doc.daemon_version_state || (doc.daemon_running===false?'not_running':doc.daemon_version?'reported':'unknown');
    if(state==='reported') {
      const running=String(doc.daemon_version||'unknown');
      if(semverLt(running,AW_MIN)) return {problems:[{code:'wake-daemon-outdated',message:`host wake daemon is running ${running}; required ${AW_MIN}; upgrade aw, then restart the host wake daemon`}],warnings:[]};
      return {problems:[],warnings:[]};
    }
    if(state==='not_running') return {problems:[{code:'wake-daemon-not-running',message:'host wake daemon is not running; this home\'s broker delivery relies on it'}],warnings:[]};
    return {problems:[],warnings:[{code:'wake-daemon-version-unknown',message:`host wake daemon version is unknown; compatibility unproven; required ${AW_MIN}; upgrade aw, then restart the host wake daemon`}]};
  } catch {return {problems:[],warnings:[{code:'wake-daemon-version-unknown',message:`host wake daemon version is unknown; compatibility unproven; required ${AW_MIN}; upgrade aw, then restart the host wake daemon`}]};}
}
async function workspaceReadinessPhase(req) {
  const ctx=workspaceReadinessContext(req.input.context);
  if(!obj(req.input.action) || req.input.action.kind!=='readiness') wireError('invalid-binding');
  const details=await readinessDetails(req.settings,{deployment:ctx.deployment}),problems=[...details.result.problems],warnings=[...details.warnings];
  const identity=obj(req.settings.identity)?req.settings.identity:{},mode=identity.mode===undefined || identity.mode===null || identity.mode===''?'local':String(identity.mode);
  if(mode==='global') {
    const grantProblem=grantAttachmentProblem(ctx.home);if(grantProblem) problems.push(grantProblem);
    const resident=typeof identity.resident==='string' && identity.resident.trim()?identity.resident.trim():undefined;
    const residents=obj(req.settings.residents)?req.settings.residents:{};
    const custody=resident?residents[resident]:undefined;
    if(!resident) problems.push({code:'custody',message:'identity.mode "global" requires identity.resident; set oats-local.yaml settings.oats.aweb.residents.<name> to the absolute custody directory for that resident identity'});
    else if(typeof custody!=='string' || !isAbsolute(custody) || !existsSync(join(custody,'.aw','identity.yaml'))) problems.push({code:'custody',message:`identity.mode "global" resident ${JSON.stringify(resident)} is not resolvable; set oats-local.yaml settings.oats.aweb.residents.${resident} to an absolute custody directory whose .aw/identity.yaml exists`});
    else if(details.team) {
      try {
        const preflight=custodyPreflight({custody,resident,team:details.team,e2eeRequired:identity.e2ee!==false,fatalOnError:false,runAw:(argv,cwd,options={})=>runAw(argv,cwd,{...options,timeout:20000})});
        for(const message of preflight.warnings) warnings.push({code:'e2ee-disabled',message});
      }
      catch(e) {problems.push({code:'custody',message:e.message});}
    }
  }
  const joined=joinedTeams(ctx.home);
  if(joined.length) {
    let status;try{status=JSON.parse(runAw(['aw','wake','status','--json'],ctx.home,{timeout:10000}));}catch{status=undefined;}
    const why={'home-not-registered':'this home is not registered with the host wake broker','not-registered-with-broker':'its identity home is not registered with the host wake broker','wake-daemon-not-running':'the host wake daemon is not running','stream-not-admitted':'the host wake broker has not admitted its stream'};
    for(const mode of joinedReceiveModes(status,{home:ctx.home,joined})) {
      const row=joined.find(j=>j.label===mode.label);
      if(mode.receive==='native') warnings.push({code:'joined-team-receive',message:`joined team ${mode.label} receives native through the host wake broker (stream ${mode.phase})`});
      else warnings.push({code:'joined-team-poll-only',message:`joined team ${mode.label} receives by polling: ${status?why[mode.reason]||mode.reason:'aw wake status is unavailable'}${mode.detail?` (${mode.detail})`:''}; check aw --identity-home ${row.identityHome} mail inbox and chat pending at task boundaries`});
    }
  }
  // A home relies on the wake daemon when the broker delivers to it: decided
  // from the home's own record (its delivery and the runtime of its last
  // start), never from the runtime of whoever runs the check. Without a
  // record only delivery: session is known to rely on it.
  const {meta:recorded,harness}=ctx.home?recordedStart(ctx.home):{};
  const reliedOn=typeof recorded?.delivery==='string'?brokerDelivers({delivery:recorded.delivery,runtime:recordedRuntime(recorded,harness)}):String(req.settings.delivery||'channel')==='session';
  const wake=reliedOn?wakeReadiness(ctx.home,{reliedOn:true}):{problems:[],warnings:[]};
  problems.push(...wake.problems);warnings.push(...wake.warnings);
  const result=checkProblems(problems) || {status:'ready',problems:[]};
  return {...result,warnings};
}
async function checkPhase(req) {
  keys(req.input,['binding','context','action','invocation'],['context','action']);
  if(!obj(req.input.action) || typeof req.input.action.kind!=='string') wireError('invalid-binding');
  if(!Object.hasOwn(req.input,'binding')) return workspaceReadinessPhase(req);
  const current=validateAwebBinding(binding(req.input.binding)),selectedContext=context(req.input.context,{request:true});
  if(!same(selectedContext,current.payload.context)) wireError('invalid-binding');
  const invocation=Object.hasOwn(req.input,'invocation')?validateAwebInvocationContext(req.input.invocation,current,{context:req.input.context,action:req.input.action}):null;
  if(['command','hook','operation'].includes(req.input.action.kind) && (!invocation || invocation.instance===null || invocation.intent===null)) return checkResult('an admitted captured instance intent is required for execution');
  if(current.payload.privateTeam===null) return checkResult('an explicit private-team binding is required');
  const hostReady=await readinessFromSettings(req.settings);
  if(hostReady.status!=='ready') return hostReady;
  if(!invocation) return hostReady;
  // Read-only public kernel observations, not an account/grant attestation.
  // Native setup is performed only by the separately admitted execution path.
  return assessCapturedSessionReadiness({binding:current,invocation,settings:req.settings});
}

// check answers through a promise (its aw floor read is asynchronous).
export function handleBindingRequest(phase,value) {
  if(!phases.has(phase)) wireError('invalid-binding');
  const req=request(value,phase);
  if(phase==='normalize') return normalizePhase(req);
  if(phase==='bind') return bindPhase(req);
  return checkPhase(req);
}
function response(phase,body) {return {schemaVersion:1,phase,slot:SLOT,capability:CAPABILITY,...body};}
function errorCode(error) {if(errorCodes.has(error?.wireCode)) return error.wireCode;if(errorCodes.has(error?.code)) return error.code;return 'invalid-binding';}
// Only these literal domain diagnostics may cross the wire. Never reflect a
// caught exception's dynamic alias/key/path, native stderr or credential text.
const safeReasons=new Map([
  ['needs-configuration',[
    TEAM_SETTING_MESSAGE,
    AWEB_TEAM_ID_MESSAGE,
    'messaging-enabled standalone preparation needs an explicit context key',
    'messaging binding needs one soul declaration',
    'messaging workspace must declare private: per-human',
    'an explicit responsible-human binding is required',
    'an explicit wider-membership consent list is required',
    'a selected wider-team binding is required',
    'a selected wider alias needs an explicit workspace team mapping',
  ]],
  ['requirement-conflict',['multiple soul messaging declarations','adoption team aliases have conflicting mappings']],
]);
const fallbackReasons=Object.freeze({
  'needs-configuration':'messaging settings and explicit binding selections are required',
  'requirement-conflict':'messaging declarations contain incompatible requirements',
  'invalid-binding':'messaging input must match the supported binding contract',
  'authorization-required':'explicit native messaging authorization is required',
  'host-requirement-missing':'a required native messaging host resource is unavailable',
  'provider-unavailable':'the selected messaging provider is unavailable',
  'provider-not-qualified':'the requested messaging configuration is not qualified',
});
function errorProblem(error) {
  const code=errorCode(error),message=safeReasons.get(code)?.find(literal=>literal===error?.message)??fallbackReasons[code];
  return {code,message};
}
function enforceOutputLimits(value,depth=1,state={entries:0}) {
  if(depth>BINDING_WIRE_LIMITS.depth) wireError('provider-not-qualified');
  if(value===null || typeof value!=='object') return;
  for(const child of Array.isArray(value)?value:Object.values(value)) {
    if(++state.entries>BINDING_WIRE_LIMITS.entries) wireError('provider-not-qualified');
    enforceOutputLimits(child,depth+1,state);
  }
}
export async function runBindingWire(phase,input=process.stdin,output=process.stdout) {
  let answer;
  try {
    const chunks=[];let length=0;
    for await(const chunk of input) {const bytes=Buffer.from(chunk);length+=bytes.length;if(length>BINDING_WIRE_LIMITS.bytes) wireError('invalid-binding');chunks.push(bytes);}
    const result=await handleBindingRequest(phase,parseBindingJson(Buffer.concat(chunks,length)));
    answer=response(phase,{ok:true,result});
  } catch(error) {answer=response(phases.has(phase)?phase:'check',{ok:false,error:errorProblem(error)});}
  let bytes;
  try {enforceOutputLimits(answer);bytes=Buffer.from(JSON.stringify(answer)+'\n');if(bytes.length>BINDING_WIRE_LIMITS.bytes) wireError('provider-not-qualified');}
  catch {bytes=Buffer.from(JSON.stringify(response(phases.has(phase)?phase:'check',{ok:false,error:{code:'provider-not-qualified',message:'messaging response exceeds the supported wire limits'}}))+'\n');}
  output.write(bytes);return answer.ok;
}
