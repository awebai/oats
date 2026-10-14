import json,sys,collections,os
f=sys.argv[1]; base='/var/tmp/okd-fi/probe/'+f
rows=[json.loads(l) for l in open(base+'.jsonl')] if os.path.exists(base+'.jsonl') else []
c=collections.Counter(); leave=collections.Counter(); ex={}
for r in rows:
    c[(r['env'], 'replaced' if r['replaced'] else 'real object')]+=1
    if r['env']=='none' and r['replaced']:
        leave[r['cmd']]+=1; ex.setdefault(r['cmd'], r)
print(f"{f}: {len(rows)} children started by the worker")
for k,n in sorted(c.items()): print(f"   env option {k[0]:5}, process.env {k[1]}: {n}")
print("   started with NO env while process.env is a replacement (these leave on Node >= 26.11):", dict(leave) or 0)
for cmd,r in ex.items(): print(f"     e.g. {cmd} {' '.join(r['args'][:5])[:80]} | real HOME {r['real']['HOME']} TMUX_TMPDIR {r['real']['TMUX_TMPDIR']} | replacement HOME {r['seen']['HOME']} TMUX_TMPDIR {r['seen']['TMUX_TMPDIR']}")
t=[l.rstrip('\n').split('\t',1) for l in open(base+'.tmux.tsv')] if os.path.exists(base+'.tmux.tsv') else []
out=[x for x in t if not x[0].startswith('/tmp/oats-tmux-')]
print(f"   stand-in tmux: {len(t)} calls, {len(out)} without a fixture's TMUX_TMPDIR", collections.Counter(x[0] for x in out).most_common(3))
for x in out[:3]: print("     e.g.", x[0], '|', x[1][:90])
g=[l.rstrip('\n').split('\t') for l in open(base+'.git.tsv')] if os.path.exists(base+'.git.tsv') else []
print(f"   git through the wrapper: {len(g)} calls; HOME values:", collections.Counter(('host home' if x[0]==os.path.expanduser('~') else ('fixture' if x[0].startswith('/tmp/') else x[0])) for x in g).most_common(4))
