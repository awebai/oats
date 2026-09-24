import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fs, join, dirname, safePath, readJSON, save, atomic, tree, materialize, digest, hash, withLock, exec, cleanEnv, fail, relPath, overlaps, resolve } from './io.mjs';
import { metadata, noGit, gitTimeoutMs } from './config.mjs';
const validator = fileURLToPath(new URL('../skills/okf/scripts/okf-validate.mjs', import.meta.url));
// Never let local replace refs reinterpret frozen OIDs, including inside Git's
// transport subprocesses. Override even an explicitly supplied command env.
const gitEnv = (env = cleanEnv()) => ({...env,GIT_NO_REPLACE_OBJECTS:'1'});
export const git = (cwd,args,opts={}) => exec('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','protocol.ext.allow=never','-C',cwd,...args],{cwd,...opts,env:gitEnv(opts.env)});
export const baseLock = b => `${b.path}.okf-lock`;
export const journalPath = b => `${b.path}.okf-publication.json`;
export function validateBase(root, base) {
  const files=tree(root,{git:base.kind==='git' && base.root==='.'}); const meta=metadata(files,base);
  const result=JSON.parse(exec(process.execPath,[validator,root,'--strict','--json'],{acceptedStatus:[0,1]}));
  if(result.errors.length || result.warnings.length) fail('E_VALIDATION', [...result.errors,...result.warnings].join('; '));
  return {files,meta,digest:digest(files)};
}
/** Write a blob straight to a file descriptor: no in-memory buffer, so object
 *  size never limits what a base may hold. The remote budget applies because a
 *  partial clone fetches a missing blob on its first read. */
function writeBlob(cwd,oid,target,mode) {
  const fd=fs.openSync(target,'wx',mode);
  let result; try { result=spawnSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-C',cwd,'cat-file','blob',oid],{cwd,env:gitEnv(),timeout:gitTimeoutMs(),stdio:['ignore',fd,'pipe']}); } finally { fs.closeSync(fd); }
  if(result.error || result.status!==0) fail('E_COMMAND','Git object read failed');
  fs.chmodSync(target,mode);
}
/** A tree entry the store never materializes: outside the knowledge base root.
 *  Its absence from a staging tree is by construction; its presence is a
 *  worker's doing and is judged like any other change. */
const outsideBase=(base,p)=>!(base.root==='.' || p===base.root || p.startsWith(base.root+'/'));
function materializeGitObjects(base,dest,head) {
  immutableCommit(dest,head);
  const entries=gitTreeEntries(dest,head);
  // Preflight paths/modes before materialization. No checkout/smudge/process/
  // working-tree-encoding conversion: accepted bytes come directly from OIDs.
  for(const [p,entry] of entries) {
    relPath(p);const inBase=base.root==='.' || p===base.root || p.startsWith(base.root+'/');
    if(!['100644','100755','120000','160000'].includes(entry.mode) || (entry.mode==='160000'?entry.type!=='commit':entry.type!=='blob')) fail('E_PATH','unsupported Git tree entry');
    if(inBase && !['100644','100755'].includes(entry.mode)) fail('E_PATH','symlink or submodule in knowledge base is not allowed');
  }
  // Index/HEAD updates do not apply content filters. They preserve the normal
  // Git worktree needed by existing diff/publication guards without checkout.
  git(dest,['read-tree',head]);git(dest,['update-ref','--no-deref','HEAD',head]);
  // Only the knowledge base is materialized: the index carries the whole tree
  // for publication, but bytes outside the base root are never read, so the
  // size of the rest of the repository does not matter. The scope checks know
  // that an entry outside the root is expected to be absent (see outsideBase).
  for(const [p,entry] of entries) {
    if(outsideBase(base,p)) continue;
    const target=safePath(join(dest,p));fs.mkdirSync(dirname(target),{recursive:true});
    writeBlob(dest,entry.oid,target,entry.mode==='100755'?0o755:0o644);
  }
}
function clone(base, dest, selectedHead) {
  safePath(dest);
  if(fs.existsSync(dest)) fail('E_PATH',`staging destination exists: ${dest}`);
  fs.mkdirSync(dirname(dest),{recursive:true});
  // Fetch only what the store reads: the accepted branch, trees now and blobs
  // on demand. Only a remote that does not offer object filtering gets a plain
  // single-branch clone instead; any other failure is the failure it is. The
  // ancestry the publication checks walk is present either way.
  const cloneArgs=['clone','--no-hardlinks','--no-checkout','--single-branch','--branch',base.acceptedBranch];
  try { git(dirname(dest),[...cloneArgs,'--filter=blob:none','--',base.repository,dest],{timeout:gitTimeoutMs()}); }
  catch(e) {
    if(e.code!=='E_COMMAND' || !/filter/i.test(e.message)) throw e;
    fs.rmSync(dest,{recursive:true,force:true});
    git(dirname(dest),[...cloneArgs,'--',base.repository,dest],{timeout:gitTimeoutMs()});
  }
  git(dest,['fetch','origin',`refs/heads/${base.acceptedBranch}`],{timeout:gitTimeoutMs()});
  const head=selectedHead ?? git(dest,['rev-parse','FETCH_HEAD']);
  verifyRemote(base,dest);
  materializeGitObjects(base,dest,head);
  // Reject a linked bundle even if Git happily checked the link out.
  safePath(join(dest,base.root));
  return head;
}
export function stageBase(base, dest) {
  safePath(dest);
  if(fs.existsSync(dest)) fail('E_PATH',`staging destination exists: ${dest}`);
  const acceptedPath=base.kind==='directory'?base.path:(base.repository.startsWith('/')?resolve(base.repository,base.root):null);
  if(acceptedPath && overlaps(acceptedPath,dest)) fail('E_PATH','stage overlaps accepted base');
  if(base.kind==='git') {
    const head=clone(base,dest); const root=join(dest,base.root);
    const validated=validateBase(root,base);
    verifyPublicationTree(base,dest,head,head,validated.files);
    return { ...validated, head, root, checkout:dest };
  }
  noGit(base.path);
  return withLock(baseLock(base),()=>{
    if(fs.existsSync(journalPath(base))) fail('E_RECOVERY',`publication pending: ${journalPath(base)}; retry its recorded run before reading`);
    const result=validateBase(base.path,base); materialize(dest,result.files);
    return {...result,root:dest};
  });
}
export function allowedChanges(before, after, meta, owned) {
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);
  if(changed.includes('okf-base.json')) fail('E_OWNER','harvest cannot change base identity/ownership');
  const paths=owned.map(n=>meta.nodes[n]?.path || fail('E_OWNER',`unknown owned node ${n}`));
  for(const p of changed) if(!['index.md','log.md'].includes(p) && !paths.some(n=>p.startsWith(n+'/'))) fail('E_OWNER',`unauthorized touched path: ${p}`);
  // Base navigation can only gain/remove listings for this worker's nodes.
  if(changed.includes('index.md')) {
    const filter=value=>Buffer.from(value || '', 'base64').toString().split('\n').filter(l=>!paths.some(p=>l.includes(`](${p}/`) || l.includes(`](/${p}/`))).join('\n');
    if(filter(before['index.md'])!==filter(after['index.md'])) fail('E_OWNER','base index edits must be navigation for owned nodes only');
  }
  if(changed.includes('log.md')) {
    const old=Buffer.from(before['log.md']||'','base64').toString();
    const next=Buffer.from(after['log.md']||'','base64').toString();
    if(!next.includes(old)) fail('E_OWNER','base log is append/prepend-only, preserve history bytes');
  }
  return changed;
}
const INDEX_SNAPSHOT_LIMIT=16*1024*1024;
const indexFailure=()=>fail('E_INDEX','Git verification requires a stable regular self-contained index within 16 MiB');
function readVerificationIndex(source) {
  let fd;
  try {
    const before=fs.lstatSync(safePath(source),{bigint:true});
    const regular=stat=>stat.isFile() && stat.size>=0n && stat.size<=BigInt(INDEX_SNAPSHOT_LIMIT);
    const same=stat=>regular(stat) && ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>stat[key]===before[key]);
    if(!regular(before) || typeof fs.constants.O_NOFOLLOW!=='number' || typeof fs.constants.O_NONBLOCK!=='number') indexFailure();
    // lstat alone races. NONBLOCK prevents a swapped FIFO from hanging open;
    // NOFOLLOW plus descriptor identity/type checks precede every byte read.
    fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    if(!same(fs.fstatSync(fd,{bigint:true})) || !same(fs.lstatSync(safePath(source),{bigint:true}))) indexFailure();
    const bytes=Buffer.alloc(Number(before.size));
    for(let offset=0;offset<bytes.length;) {
      const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!count) indexFailure();offset+=count;
    }
    if(!same(fs.fstatSync(fd,{bigint:true})) || !same(fs.lstatSync(safePath(source),{bigint:true}))) indexFailure();
    return bytes;
  } catch {indexFailure();}
  finally {if(fd!==undefined) fs.closeSync(fd);}
}
function withVerificationIndex(cwd,fn) {
  // Git 2.44 diff refreshes even with optional locks disabled. Use a COPY,
  // never a worker-index write/restore or the private publication index.
  const scratch=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'oats-okf-verify-index-')),owned=fs.lstatSync(scratch);
  try {
    const index=join(scratch,'index'),source=resolve(cwd,git(cwd,['rev-parse','--git-path','index']));
    fs.writeFileSync(index,readVerificationIndex(source),{flag:'wx',mode:0o600});
    const env={...cleanEnv(),GIT_INDEX_FILE:index},format=git(cwd,['rev-parse','--show-object-format']);
    if(!['sha1','sha256'].includes(format)) indexFailure();
    // Native split-index parsing freshens backing files BEFORE splitIndex=false
    // takes effect. Preflight in an EMPTY private gitdir: original sharedindex
    // files are never searched/opened, and missing dependencies refuse. Merely
    // putting a backing copy beside GIT_INDEX_FILE would not isolate that read.
    const gitdir=join(scratch,'repository');
    git(scratch,['init','--bare','--quiet','--template=',`--object-format=${format}`,gitdir]);
    try {
      const shared=git(scratch,['--no-optional-locks','-c','core.splitIndex=false','-c','core.fsmonitor=false','rev-parse','--shared-index-path'],{env:{...env,GIT_DIR:gitdir}});
      if(shared) indexFailure();
    } catch {indexFailure();}
    return fn(args=>git(cwd,['--no-optional-locks','-c','diff.autoRefreshIndex=true','-c','core.splitIndex=false',...args],{env}));
  } finally {
    const current=fs.lstatSync(scratch);
    if(!current.isDirectory() || current.dev!==owned.dev || current.ino!==owned.ino) fail('E_INDEX','Git verification scratch ownership changed; cleanup refused');
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
export function verifyGitScope(base, dest, baseline, { checkModes = true } = {}) {
  return withVerificationIndex(dest,read=>{
    // Entries outside the root are never materialized, so their absence is
    // not a deletion; a present outside file that differs still is a change.
    const names=read(['diff','--name-only','-z',baseline,'--']).split('\0').filter(Boolean).filter(p=>!(outsideBase(base,p) && !fs.existsSync(join(dest,p))));
    // A restored working file can conceal a staged, unauthorized index entry.
    names.push(...read(['diff','--cached','--name-only','-z',baseline,'--']).split('\0').filter(Boolean));
    names.push(...read(['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean));
    if(base.root!=='.' && names.some(p=>!p.startsWith(base.root+'/'))) fail('E_OWNER','Git worker touched files outside its knowledge base');
    // --others without exclude-standard includes ignored additions as well.
    // Unchanged code symlinks outside the base are not knowledge and need not be
    // traversed. Bundle symlinks are rejected by validateBase/tree.
    const extra=read(['ls-files','--others','-z']).split('\0').filter(Boolean);
    if(base.root!=='.' && extra.some(p=>!p.startsWith(base.root+'/'))) fail('E_OWNER','untracked/ignored file outside knowledge');
    if(checkModes) {
      // Harvest judgments authorize content, not executable-bit edits. Inspect
      // the filesystem against frozen objects, not core.fileMode or index flags.
      for(const [p,entry] of gitTreeEntries(dest,baseline)) {
        if(!['100644','100755'].includes(entry.mode)) continue;
        const path=join(dest,p);
        let stat;try {stat=fs.lstatSync(path);} catch(e) {if(e.code==='ENOENT' || e.code==='ENOTDIR') continue;throw e;}
        if(stat.isFile() && (stat.mode & 0o100 ? '100755':'100644')!==entry.mode) fail('E_OWNER',`harvest cannot change Git file mode: ${p}`);
      }
    }
    verifyRemote(base,dest);
  });
}
// Caller MUST hold the cooperative base lock. Intent is durable before journal
// installation; publishing is durable AFTER it and BEFORE the first accepted
// write. The journal is removed only after a durable accepted receipt. Thus an
// absent journal can cancel an intent, but never a write-authorized publication.
export function reconcileDirectoryIntent(base, receipt, persist) {
  if(fs.existsSync(journalPath(base))) return;
  if(receipt.status==='publication-intent') {
    receipt.status='validated'; persist();
  } else if(!['validated','staged','accepted','no-change'].includes(receipt.status)) {
    fail('E_RECOVERY','directory publication journal missing after writes were authorized; inspect and restore custody before retrying or rejudging');
  }
}
export function directoryPublish(base, proposal, receipt, persist, { afterWrite } = {}) {
  noGit(base.path);
  return withLock(baseLock(base),()=>{
    const jp=journalPath(base);
    reconcileDirectoryIntent(base,receipt,persist);
    if(receipt.status==='accepted' && !fs.existsSync(jp)) return receipt;
    const changed=[...new Set([...Object.keys(proposal.before),...Object.keys(proposal.after)])].filter(p=>proposal.before[p]!==proposal.after[p]);
    // A mount boundary cannot support our cross-directory atomic rename.
    // Detect it BEFORE journal intent or any deletion/replacement, rather than
    // leaving a partially applied publication that can only fail with EXDEV.
    const device=fs.statSync(baseLock(base)).dev;
    for(const p of changed.filter(p=>proposal.after[p]!==undefined)) {
      let parent=dirname(safePath(join(base.path,relPath(p))));
      while(!fs.existsSync(parent)) parent=dirname(parent);
      if(fs.statSync(parent).dev!==device) fail('E_PATH','directory publication targets and sibling lock must share a filesystem');
    }
    let journal;
    if(fs.existsSync(jp)) {
      journal=readJSON(jp);
      if(journal.run!==proposal.run || journal.proposalHash!==hash(proposal)) fail('E_RECOVERY',`another publication must recover first: ${jp}`);
    } else {
      const current=validateBase(base.path,base);
      if(current.digest!==digest(proposal.before)) fail('E_BASELINE','directory base changed; retain evidence and rejudge on a fresh run');
      journal={version:1,run:proposal.run,proposalHash:hash(proposal),proposalFile:proposal.file,status:'publishing'};
      receipt.status='publication-intent'; persist();
      atomic(jp,JSON.stringify(journal,null,2)+'\n',{tempDir:baseLock(base)});
    }
    if(receipt.status==='accepted') {
      // A death after receipt persistence needs only journal cleanup, never
      // another accepted write (nor a replay over unexpected newer bytes).
      const final=validateBase(base.path,base);
      if(final.digest!==digest(proposal.after) || receipt.acceptedDigest!==final.digest) fail('E_CONFIRM','accepted directory receipt differs from journalled bytes');
      fs.rmSync(jp); syncParent(jp); return receipt;
    }
    const current=tree(base.path);
    for(const p of new Set([...Object.keys(current),...Object.keys(proposal.before),...Object.keys(proposal.after)])) {
      if(current[p]!==proposal.before[p] && current[p]!==proposal.after[p]) fail('E_BASELINE',`unexpected bytes during publication recovery: ${p}`);
      if(!changed.includes(p) && current[p]!==proposal.before[p]) fail('E_BASELINE',`unchanged file differs: ${p}`);
    }
    receipt.status='publishing'; persist();
    let count=0;
    for(const p of changed) {
      const target=safePath(join(base.path,relPath(p)));
      // A previous death may follow rename/unlink but precede its directory
      // fsync. Confirm that metadata without replacing accepted bytes again.
      if(current[p]===proposal.after[p]) {syncParent(target);continue;}
      if(proposal.after[p]===undefined) { fs.rmSync(target,{force:true}); syncParent(target); }
      // The lock owns scratch files as well as owner.json. A dead-owner unlock
      // removes incomplete scratch; it never leaves temp files in the bundle.
      else atomic(target,Buffer.from(proposal.after[p],'base64'),{tempDir:baseLock(base)});
      afterWrite?.(++count); // fault injection is programmatic tests only, never an environment switch
    }
    const final=validateBase(base.path,base);
    if(final.digest!==digest(proposal.after)) fail('E_CONFIRM','directory publication confirmation differs');
    receipt.status='accepted'; receipt.acceptedDigest=final.digest; receipt.acceptedAt=new Date().toISOString(); persist();
    fs.rmSync(jp); syncParent(jp);
    return receipt;
  });
}
function syncParent(p) { const fd=fs.openSync(dirname(p),'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);} }
function prRows(base,branch,cwd,{identity,allBases=false}={}) {
  const fields='number,url,state,headRefOid,baseRefName,headRefName,mergedAt,mergeCommit';
  // Once observed, a PR is addressed by repository + number, never a mutable
  // head/base filter. A missing/inaccessible identity is an error, not absence.
  if(identity) {
    if(!Number.isInteger(identity.number) || identity.number<1 || !/^https:\/\//.test(identity.url)) fail('E_RECOVERY','invalid recorded PR identity');
    const pr=JSON.parse(exec('gh',['pr','view',String(identity.number),'--repo',base.pr.repository,'--json',fields],{cwd,env:gitEnv()}));
    if(!pr || Array.isArray(pr) || typeof pr!=='object') fail('E_RECOVERY','known PR missing; reconcile custody before rejudging');
    return [pr];
  }
  const raw=exec('gh',['pr','list','--repo',base.pr.repository,'--head',branch,...(allBases?[]:['--base',base.acceptedBranch]),'--state','all','--json',fields],{cwd,env:gitEnv()});
  const rows=JSON.parse(raw); if(!Array.isArray(rows)) fail('E_PR','invalid gh PR list'); return rows;
}
function verifyRemote(base,cwd) {
  for(const mode of [[],['--push']]) {
    const urls=git(cwd,['remote','get-url',...mode,'--all','origin']).split('\n');
    if(!urls.length || urls.some(url=>url!==base.repository)) fail('E_OWNER','worker changed frozen Git publication remote or effective push destination');
  }
}
function changedPaths(before,after) {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);
}
function gitTreeEntries(cwd,treeId) {
  return new Map(git(cwd,['ls-tree','-r','-z',treeId]).split('\0').filter(Boolean).map(entry=>{
    const tab=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,tab).split(' ');
    return [entry.slice(tab+1),{mode,type,oid}];
  }));
}
// Verify the REAL tree, not Git's working-tree view. Blob hashes include the
// exact bytes (no text trimming); Git filters/attributes and ignores cannot
// substitute something different from the validated proposal. Modes come only
// from the frozen baseline (new files are non-executable), never worker state.
function verifyPublicationTree(base,cwd,baseline,treeId,after,before=after) {
  const names=git(cwd,['diff-tree','--no-commit-id','--no-renames','--name-only','-r','-z',baseline,treeId,'--']).split('\0').filter(Boolean);
  if(base.root!=='.' && names.some(p=>!p.startsWith(base.root+'/'))) fail('E_OWNER','publication tree changes files outside its knowledge base');
  const format=git(cwd,['rev-parse','--show-object-format']);
  const prefix=base.root==='.'?'':base.root+'/';
  const changed=new Set(changedPaths(before,after).map(p=>prefix+p));
  if(names.some(p=>!changed.has(p))) fail('E_OWNER','publication tree changes paths outside the validated content changes');
  const baselineEntries=gitTreeEntries(cwd,baseline);
  const found=new Set();
  for(const [path,{mode,type,oid}] of gitTreeEntries(cwd,treeId)) {
    if(!path.startsWith(prefix)) continue;
    const p=path.slice(prefix.length);
    if(!Object.hasOwn(after,p) || type!=='blob' || !['100644','100755'].includes(mode)) fail('E_CONFIRM',`publication tree differs from validated proposal: ${p}`);
    if(mode!==(baselineEntries.get(path)?.mode || '100644')) fail('E_OWNER',`publication tree changes frozen Git file mode: ${p}`);
    const bytes=Buffer.from(after[p],'base64');
    const expected=createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(oid!==expected) fail('E_CONFIRM',`publication tree bytes differ from validated proposal: ${p}`);
    found.add(p);
  }
  if(found.size!==Object.keys(after).length) fail('E_CONFIRM','publication tree omits validated proposal files (check Git ignores/attributes)');
}
function immutableCommit(cwd,oid) {
  if(typeof oid!=='string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) fail('E_CONFIRM','publication requires an immutable full commit OID');
  if(git(cwd,['cat-file','-t',oid])!=='commit') fail('E_CONFIRM','publication OID must identify a commit object, not a peelable tag');
  // Read object headers, not revision history (which can honor grafts).
  const header=git(cwd,['cat-file','commit',oid]).split('\n\n')[0].split('\n');
  return {tree:header.find(l=>l.startsWith('tree '))?.slice(5),parents:header.filter(l=>l.startsWith('parent ')).map(l=>l.slice(7))};
}
export function gitPublish(base, stage, proposal, receipt, persist, {beforePublish=()=>{},prIdentity=receipt.pr}={}) {
  const cwd=stage.checkout, branch=`okf/${proposal.attempt || proposal.run}-${base.id}`;
  verifyRemote(base,cwd);
  const baseline=immutableCommit(cwd,stage.head);
  verifyPublicationTree(base,cwd,baseline.tree,baseline.tree,proposal.before);
  // Baseline must still be accepted. Never rebase model output without rejudging it.
  git(cwd,['fetch','origin',`refs/heads/${base.acceptedBranch}`],{timeout:gitTimeoutMs()});
  const accepted=git(cwd,['rev-parse','FETCH_HEAD']);
  if(accepted!==stage.head) {
    // A known or uncertain previously created PR may be reconciled, but a
    // committed/pushed proposal alone does not authorize a NEW stale-base PR.
    const prior=receipt.commit?prRows(base,branch,cwd,{identity:prIdentity}).filter(p=>p.headRefOid===receipt.commit && p.headRefName===branch && p.baseRefName===base.acceptedBranch):[];
    if(prior.length!==1) fail('E_BASELINE','accepted Git head changed before verified PR delivery; explicit rejudgment required');
  }
  if(!receipt.commit) {
    // Publication consumes a frozen content proposal, also on migration/retry
    // where materialization may have reset filesystem permissions. Its modes
    // are reconstructed below, not authorized by the mutable worktree.
    verifyGitScope(base,cwd,stage.head,{checkModes:false});
    if(digest(tree(stage.root,{git:base.root==='.'}))!==digest(proposal.after)) fail('E_BASELINE','staged proposal changed after validation');
    beforePublish();
    receipt.status='commit-intent'; receipt.branch=branch; persist();
    // Never trust the model's index. Start a private publication index from
    // the frozen accepted commit, and leave the worker's own index intact.
    const scratch=fs.mkdtempSync(join(dirname(proposal.file),'git-index-'));
    let treeId;
    try {
      const env={...cleanEnv(),GIT_INDEX_FILE:join(scratch,'index')};
      git(cwd,['read-tree',baseline.tree],{env});
      const prefix=base.root==='.'?'':base.root+'/';
      const entries=gitTreeEntries(cwd,baseline.tree);
      // Recompute the delta from validated bytes, never trust proposal.changed
      // or stage an entire directory (which also collects mode-only edits).
      for(const p of changedPaths(proposal.before,proposal.after)) {
        const path=prefix+relPath(p);
        // An ignored addition can exit 1. The exact tree check below must still
        // reject its omission; no ignore/filter failure becomes a partial PR.
        git(cwd,['--literal-pathspecs','add','--all','--chmod=-x','--',path],{env,acceptedStatus:[0,1]});
        if(Object.hasOwn(proposal.after,p) && entries.get(path)?.mode==='100755') git(cwd,['--literal-pathspecs','update-index','--chmod=+x','--',path],{env});
      }
      treeId=git(cwd,['write-tree'],{env});
      verifyPublicationTree(base,cwd,baseline.tree,treeId,proposal.after,proposal.before);
    } finally {fs.rmSync(scratch,{recursive:true,force:true});}
    // Deterministic commit-tree permits replay after process death between the
    // real Git write and receipt persistence; no guessed commit or fake repository.
    const stamp=proposal.created;
    const env={...cleanEnv(),GIT_AUTHOR_NAME:'OKF harvest',GIT_AUTHOR_EMAIL:'okf@localhost',GIT_COMMITTER_NAME:'OKF harvest',GIT_COMMITTER_EMAIL:'okf@localhost',GIT_AUTHOR_DATE:stamp,GIT_COMMITTER_DATE:stamp};
    receipt.commit=git(cwd,['commit-tree',treeId,'-p',stage.head,'-m',`memory-harvest: ${proposal.run}`],{env});
    receipt.status='committed'; persist();
  }
  const publication=immutableCommit(cwd,receipt.commit);
  if(publication.parents.length!==1 || publication.parents[0]!==stage.head) fail('E_CONFIRM','publication commit must have exactly the frozen baseline as its parent');
  verifyPublicationTree(base,cwd,baseline.tree,publication.tree,proposal.after,proposal.before);
  const remoteTip=()=>git(cwd,['ls-remote','--heads','origin',`refs/heads/${branch}`],{timeout:gitTimeoutMs()}).split(/\s/)[0] || null;
  let tip=remoteTip();
  if(tip && tip!==receipt.commit) fail('E_PR','publication branch has unexpected commit; never force push');
  if(tip!==receipt.commit) {
    beforePublish();
    receipt.status='push-intent'; persist();
    try { verifyRemote(base,cwd);git(cwd,['push','--no-follow-tags','--recurse-submodules=no','origin',`${receipt.commit}:refs/heads/${branch}`],{timeout:gitTimeoutMs()}); }
    catch(e) { receipt.status='push-unknown'; receipt.error=e.message; persist(); throw e; }
    tip=remoteTip(); if(tip!==receipt.commit) {receipt.status='push-unknown';persist();fail('E_CONFIRM','pushed head not confirmed');}
  }
  receipt.status='pushed'; persist();
  let rows;
  try {rows=prRows(base,branch,cwd,{identity:prIdentity});} catch(e) {receipt.status='pr-unknown';receipt.error=e.message;persist();throw e;}
  if(!rows.length) {
    beforePublish();
    receipt.status='pr-intent'; persist();
    try { exec('gh',['pr','create','--repo',base.pr.repository,'--head',branch,'--base',base.acceptedBranch,'--title',`memory-harvest: ${proposal.run}`,'--body',`Knowledge-only proposal from durable OKF input ${proposal.run}. Review provenance and promotion judgment.`],{cwd,env:gitEnv()}); }
    catch(e) {receipt.status='pr-unknown';receipt.error=e.message;persist();throw e;}
    rows=prRows(base,branch,cwd);
  }
  const matching=rows.filter(p=>p.headRefOid===receipt.commit && p.headRefName===branch && p.baseRefName===base.acceptedBranch && Number.isInteger(p.number) && /^https:\/\//.test(p.url) && (!prIdentity || (p.number===prIdentity.number && p.url===prIdentity.url)));
  if(matching.length!==1 || rows.length!==1) {receipt.status='pr-unknown';persist();fail('E_PR','actual PR identity/head/base could not be uniquely verified');}
  const pr=matching[0];receipt.pr=pr;receipt.status='delivered';receipt.deliveredAt ||= new Date().toISOString();persist();
  if(pr.state==='CLOSED' && !pr.mergedAt) {receipt.status='rejected';persist();fail('E_PR','PR closed without merge; retained proposal requires operator review');}
  if(pr.mergedAt) {
    git(cwd,['fetch','origin',`refs/heads/${base.acceptedBranch}`],{timeout:gitTimeoutMs()});
    const merge=pr.mergeCommit?.oid;
    if(!merge) fail('E_CONFIRM','merged PR lacks merge commit');
    git(cwd,['merge-base','--is-ancestor',merge,'FETCH_HEAD']);
    receipt.status='accepted';receipt.acceptedCommit=git(cwd,['rev-parse','FETCH_HEAD']);receipt.acceptedAt=new Date().toISOString();persist();
  }
  return receipt;
}

export function recoveryStage(base, stage, proposal, dest) {
  clone(base,dest,stage.head);
  const root=join(dest,base.root);
  for(const p of Object.keys(proposal.before)) if(!(p in proposal.after)) fs.rmSync(safePath(join(root,p)),{force:true});
  materialize(root,proposal.after);validateBase(root,base);
  return {...stage,root,checkout:dest};
}

// Remote-read-only recovery gate. --repo makes this independent of any deleted
// worker checkout. The caller durably saves first observations separately from
// historical receipts, even if a later gate prevents recovery from completing.
export function gitRecoveryState(base,receipt,cwd,{identity=receipt.pr,onObserve=()=>{}}={}) {
  if(['accepted','no-change'].includes(receipt.status)) return 'settled';
  if(!receipt.branch) return 'unresolved';
  const rows=prRows(base,receipt.branch,cwd,{identity,allBases:true});
  if(!rows.length) {
    if(identity || ['delivered','rejected'].includes(receipt.status)) fail('E_RECOVERY','known PR missing; reconcile custody before rejudging');
    return 'unresolved';
  }
  const pr=rows[0];
  if(rows.length!==1 || pr.headRefOid!==receipt.commit || pr.headRefName!==receipt.branch || pr.baseRefName!==base.acceptedBranch || !Number.isInteger(pr.number) || pr.number<1 || !/^https:\/\//.test(pr.url) || [identity,receipt.pr].some(known=>known && (pr.number!==known.number || pr.url!==known.url)) || !['OPEN','CLOSED','MERGED'].includes(pr.state) || (pr.state==='MERGED' && !pr.mergedAt)) fail('E_RECOVERY','actual PR identity/head/base could not be uniquely verified for recovery');
  onObserve(pr);
  return pr.state==='CLOSED' && !pr.mergedAt?'unresolved':'settled';
}
