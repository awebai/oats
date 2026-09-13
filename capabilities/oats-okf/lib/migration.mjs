import { randomUUID } from 'node:crypto';
import { fs, join, dirname, resolve, safePath, readJSON, save, atomic, tree, materialize, digest, hash, overlaps, withLock, fail, identifier } from './io.mjs';
import { metadata, noGit, validateDeclaration, loadBindings, resolveNodes, splitRef } from './config.mjs';
import { stageBase, validateBase, baseLock, journalPath, gitPublish, directoryPublish } from './stores.mjs';
const b64=s=>Buffer.from(s).toString('base64');
export function initBase(bindings,alias,nodesFile,output,{confirm=false}={}) {
  const base=Object.hasOwn(bindings.bases,alias)?bindings.bases[alias]:null;if(!base) fail('E_CONFIG','unknown base');
  const nodes=readJSON(nodesFile);const files={'okf-base.json':b64(JSON.stringify({version:1,id:base.id,nodes},null,2)+'\n'),'index.md':b64('---\nokf_version: "0.1"\n---\n\n# Knowledge base\n\n'+Object.entries(nodes).map(([n,s])=>`* [${n}](${s.path}/index.md) - owned by ${s.owner}.`).join('\n')+'\n'),'log.md':b64('# Knowledge log\n')};
  for(const [n,s] of Object.entries(nodes)) {identifier(n);files[`${s.path}/index.md`]=b64(`# ${n}\n`);files[`${s.path}/log.md`]=b64(`# ${n} log\n`);}
  metadata(files,base);
  const dest=safePath(output || (base.kind==='directory' && confirm ? base.path : fail('E_USAGE','init requires --output for a staged Git/operator proposal, or --confirm for a new directory base')));
  if(fs.existsSync(dest)) fail('E_BASE','init destination exists; never overwrite knowledge');
  for(const b of Object.values(bindings.bases)) {
    const path=b.kind==='directory'?b.path:(b.repository.startsWith('/')?resolve(b.repository,b.root):null);
    if(path && overlaps(path,dest) && !(b===base && b.kind==='directory' && dest===path && confirm)) fail('E_PATH','init stage overlaps accepted base');
  }
  if(overlaps(dest,bindings.stateDir)) fail('E_PATH','init cannot overlap durable state');
  const write=()=>{materialize(dest,files);validateBase(dest,base);};
  if(base.kind==='directory' && dest===base.path) {if(!confirm) fail('E_USAGE','directory provisioning needs --confirm');noGit(dest);withLock(baseLock(base),write);}
  else write();
  return {status:base.kind==='directory' && dest===base.path?'accepted':'staged',path:dest,next:base.kind==='git'?'Commit this initialized bundle in an operator-owned checkout and deliver through a reviewed PR before activating sources.':null};
}
export function migrate(bindings,{legacy,alias,node,output}) {
  const base=Object.hasOwn(bindings.bases,alias)?bindings.bases[alias]:null;if(!base) fail('E_CONFIG','unknown base');identifier(node);legacy=safePath(legacy);output=safePath(output);
  if(overlaps(legacy,output) || overlaps(legacy,bindings.stateDir) || overlaps(output,bindings.stateDir)) fail('E_PATH','migration source, stage and state must be disjoint');
  // Check ALL configured custody, before even creating preservation/staging
  // state. A destination alias does not grant writes to another accepted base.
  for(const b of Object.values(bindings.bases)) {
    const paths=b.kind==='directory'?[b.path,baseLock(b),journalPath(b)]:(b.repository.startsWith('/')?[resolve(b.repository,b.root)]:[]);
    if(paths.some(path=>overlaps(path,output))) fail('E_PATH','migration stage overlaps configured accepted base or coordination artifacts');
  }
  const original=tree(legacy);
  fs.mkdirSync(bindings.stateDir,{recursive:true,mode:0o700});
  const id=randomUUID();const dir=join(bindings.stateDir,'migrations',id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  save(join(dir,'legacy.json'),original); // byte-preserving backup BEFORE any delivery
  const stage=stageBase(base,output); const spec=stage.meta.nodes[node];if(!spec) fail('E_OWNER','migration node must be explicitly provisioned first');
  const prefix=spec.path+'/';
  if(Object.keys(stage.files).some(p=>p.startsWith(prefix) && ![prefix+'index.md',prefix+'log.md'].includes(p))) fail('E_MIGRATION','target node is not empty; merge migration requires human judgment');
  const after={...stage.files};for(const p of Object.keys(after)) if(p.startsWith(prefix)) delete after[p];
  for(const [p,content] of Object.entries(original)) {
    if(!p.endsWith('.md')) fail('E_MIGRATION',`legacy non-Markdown artifact requires manual migration: ${p}`);
    let text=Buffer.from(content,'base64').toString('utf8');
    text=text.replace(/\]\(\/(?!\/)([^)]+)\)/g,`](/${spec.path}/$1)`);
    if(p==='index.md') text=text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
    after[prefix+p]=b64(text);
  }
  after[prefix+'log.md'] ||= b64(`# ${node} log\n`);
  // Replace only the empty pre-provisioned node, not unrelated accepted bytes.
  fs.rmSync(join(stage.root,spec.path),{recursive:true});materialize(stage.root,after);validateBase(stage.root,base);
  const proposalFile=join(dir,'proposal.json');const proposal={version:1,run:id,created:new Date().toISOString(),file:proposalFile,before:stage.files,after};save(proposalFile,proposal);
  const record={version:1,id,alias,node,base,owner:spec.owner,legacy,originalDigest:digest(original),stage:{root:stage.root,checkout:stage.checkout,head:stage.head},proposal:proposalFile,proposalHash:hash(proposal),receipt:{status:'staged'}};save(join(dir,'migration.json'),record);
  return {status:'staged',migration:join(dir,'migration.json'),originalPreserved:true,stage:stage.root};
}
export function deliverMigration(file) {
  safePath(file);const m=readJSON(file);const proposal=readJSON(m.proposal);if(hash(proposal)!==m.proposalHash) fail('E_MIGRATION','migration proposal changed');
  const persist=()=>save(file,m);
  if(m.receipt.status==='accepted' && m.base.kind==='directory' && !fs.existsSync(`${m.base.path}.okf-publication.json`)) return m.receipt;
  if(m.base.kind==='git') gitPublish(m.base,m.stage,proposal,m.receipt,persist);
  else directoryPublish(m.base,proposal,m.receipt,persist);
  return m.receipt;
}
export function cutoverMigration(file,soul) {
  safePath(file);soul=safePath(soul);const m=readJSON(file);
  if(m.receipt.status!=='accepted') fail('E_MIGRATION','cutover requires provider-confirmed acceptance; deliver/inspect merged PR first');
  if(resolve(m.legacy)!==join(soul,'knowledge')) fail('E_MIGRATION','legacy path must be this soul/knowledge');
  if(m.cutover?.status==='complete') return {status:'complete',backup:join(dirname(file),'original')};
  const savedOriginal=join(dirname(file),'original');
  const live=fs.existsSync(m.legacy)?m.legacy:(m.cutover?.status==='intent' && fs.existsSync(savedOriginal)?savedOriginal:m.legacy);
  if(digest(tree(live))!==m.originalDigest) fail('E_MIGRATION','legacy bundle changed since staging; preserve and migrate the new version');
  const original=readJSON(join(dirname(file),'legacy.json'));if(digest(original)!==m.originalDigest) fail('E_MIGRATION','backup differs');
  const declarationFile=join(soul,'okf.json');const ref=`${m.alias}/${m.node}`;
  let decl=fs.existsSync(declarationFile)?validateDeclaration(readJSON(declarationFile)):{version:1,owner:m.owner,owns:[],reads:[]};
  if(decl.owner!==m.owner) fail('E_OWNER','existing soul declaration owner differs');
  decl={...decl,owns:[...new Set([...decl.owns,ref])],reads:[...new Set([...decl.reads,ref])]};
  // The declaration resolves through TODAY's bindings, not the frozen delivery
  // locator. Validate it before any cutover intent, archive or soul edit.
  const bindings=loadBindings();
  if(!Object.hasOwn(bindings.bases,m.alias) || hash(bindings.bases[m.alias])!==hash(m.base)) fail('E_MIGRATION','current migration alias differs from frozen delivered base');
  const proposal=readJSON(m.proposal);
  if(hash(proposal)!==m.proposalHash) fail('E_MIGRATION','migration proposal changed');
  const frozen=metadata(proposal.after,m.base).nodes[m.node];
  if(!frozen || frozen.owner!==m.owner) fail('E_OWNER','migration proposal owner differs');
  const accepted={};
  const scratch=fs.mkdtempSync(join(bindings.stateDir,'cutover-check-'));
  try {
    for(const alias of new Set([...decl.owns,...decl.reads].map(r=>splitRef(r)[0]))) {
      if(!Object.hasOwn(bindings.bases,alias)) fail('E_CONFIG',`unresolved base: ${alias}`);
      const staged=stageBase(bindings.bases[alias],join(scratch,alias));
      accepted[alias]=staged.meta;
      if(alias===m.alias) {
        if(hash(staged.meta.nodes[m.node] || null)!==hash(frozen)) fail('E_OWNER','accepted migration ownership/path differs from delivered node');
        const nodeFiles=files=>Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith(frozen.path+'/')));
        if(digest(nodeFiles(staged.files))!==digest(nodeFiles(proposal.after))) fail('E_MIGRATION','accepted migration node no longer matches delivered content; inspect and reconcile before cutover');
      }
    }
    resolveNodes(decl,bindings,accepted);
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
  m.cutover={status:'intent',soul};save(file,m);save(join(soul,'.okf-cutover.json'),{migration:file});
  // Atomic rename, not deletion. Cross-device moves deliberately fail closed;
  // the operator can keep the preserved bundle and arrange explicit cutover.
  if(live===m.legacy) fs.renameSync(m.legacy,savedOriginal);
  save(declarationFile,decl);fs.rmSync(join(soul,'.okf-cutover.json'));m.cutover.status='complete';save(file,m);
  return {status:'complete',backup:join(dirname(file),'original'),next:'Update old soul/knowledge references in soul instructions to knowledge/bases/<alias>/<node>. Skills are unchanged.'};
}

export function migrateSource(bindings, home) {
  home=safePath(home);
  if(overlaps(home,bindings.stateDir)) fail('E_PATH','legacy source overlaps durable state');
  const files={};
  for(const name of ['STATE.md','log.md','.okf-harvest-record.json','.okf-harvest-record.next.json']) if(fs.existsSync(join(home,name))) {safePath(join(home,name));files[name]=fs.readFileSync(join(home,name)).toString('base64');}
  if(fs.existsSync(join(home,'notes'))) for(const [p,b] of Object.entries(tree(join(home,'notes')))) files['notes/'+p]=b;
  const id=randomUUID(),file=join(bindings.stateDir,'migrations',id,'legacy-source.json');
  save(file,{version:1,home,files,digest:digest(files)});
  save(join(home,'.okf-v1-migration.json'),{version:1,backup:file,digest:digest(files)});
  return {status:'preserved',backup:file,next:'Migrate any soul/knowledge bundle first; harvest re-registers this source and captures all visible evidence. Old v1 cursors are preserved, NOT accepted as v2 processing proof.'};
}
