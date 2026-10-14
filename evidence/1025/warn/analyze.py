import json,glob,os,re,collections,sys
def kind(t):
    if 'could not read your login environment' in t:
        r='ENOENT' if 'ENOENT' in t else ('HOME' if 'HOME is not' in t else 'other-reason:'+t[60:110])
        fb='own-env' if "this process's own environment" in t else ('recorded-copy' if 'home records' in t else ('no-fallback' if 'no fallback' in t else '?'))
        return f'login-env/{r}/{fb}'
    return re.sub(r'[0-9]+','N',(t.split('oats: warning:')[1] if 'oats: warning:' in t else 'TRUNCATED '+t)[:60].strip())
for f in sorted(glob.glob('/var/tmp/okd-fi/warn/*.jsonl')):
    name=os.path.basename(f)[:-6]
    rows=[json.loads(l) for l in open(f)]
    out=open(f[:-6]+'.out',errors='replace').read()
    outlines=[l for l in out.split('\n') if 'oats: warning:' in l]
    if not rows and not outlines: continue
    print(f'== {name}: {len(outlines)} lines in the output, {len(rows)} writes seen by the probe')
    c=collections.Counter()
    for r in rows:
        who='worker' if r['worker'] else 'child: '+' '.join(os.path.basename(a) if '/' in a else a for a in r['argv'][:3])[:50]
        fr=[x for x in r['frames']]
        test=[x for x in fr if x.split('(')[-1].startswith(('test/','tests/')) or ' (test/' in x or x.startswith('test/')]
        helper=next((x for x in fr if 'test/helpers/' in x), None)
        entry=(helper or (test[0] if test else (fr[-1] if fr else '?')))
        entry=re.sub(r':\d+:\d+\)?$','',entry).replace('TestContext.<anonymous> (','').replace('async ','')
        kernel=next((x.split(' ')[0] for x in fr if 'lib/' in x), '?')
        c[(who, r['stream'], kind(r['text']), kernel, entry[:70])]+=1
    for k,n in c.most_common(): print(f'   {n:3}  {k[0]} | {k[1]} | {k[2]} | {k[3]} | via {k[4]}')
    ko=collections.Counter(kind(l) for l in outlines)
    print('   in output:', dict(ko))
