# Usage: python export_refs.py <path/to/all-assets> <out_dir>   (writes refs + ../refs.json)
import json,sys,os,re
from PIL import Image
root=sys.argv[1]; out=sys.argv[2]
idx=json.load(open(os.path.join(root,'sprites','index.json')))
cat={};name={}
cur=None
for line in open(os.path.join(root,'ASSETS.md')):
    m=re.match(r'## (.+)',line)
    if m: cur=m.group(1).strip(); continue
    m=re.match(r'- (\S+) — [^(]+\((.*)\)',line)
    if m:
        k=m.group(1); inner=m.group(2)
        nm=inner.rsplit(',',1)[0].strip() if ',' in inner else ''
        cat[k]=cur; name[k]=nm
order=['terrain tile','decoration','structure','cannon','unit','projectile','effect','spell']
res=[]
for k,v in idx.items():
    c=cat.get(k)
    if c not in order or not v: continue
    fr=list(v.values())
    gifs=[]
    for f in fr:
        if f['gif'] not in gifs: gifs.append(f['gif'])
    main=[f for f in fr if not os.path.basename(f['gif']).lower().startswith(('b_','s_'))] or fr
    best=None;ba=-1
    for f in main:
        im=Image.open(os.path.join(root,'sprites',f['file'])).convert('RGBA')
        bb=im.getbbox()
        a=(bb[2]-bb[0])*(bb[3]-bb[1]) if bb else 0
        if a>ba: ba=a;best=(f,im.crop(bb) if bb else im)
    f,im=best
    sc=max(1,min(6,512//max(im.size)))
    big=im.resize((im.width*sc,im.height*sc),Image.NEAREST)
    n=len(res)
    res.append(dict(id=k,cat=c,name=name.get(k) or k,frames=len(fr),w=im.width,h=im.height,
        anims=[g for g in gifs if not os.path.basename(g).lower().startswith(('b_','s_'))]))
res.sort(key=lambda r:(order.index(r['cat']),-r['frames']<0 and 0, r['id']))
os.makedirs(out,exist_ok=True)
for i,r in enumerate(res,1):
    r['no']=i
    r['file']=f"{i:03d}_{r['id']}.png"
for r in res:
    v=list(idx[r['id']].values())
# re-render with final names
for r in res:
    fr=list(idx[r['id']].values())
    main=[f for f in fr if not os.path.basename(f['gif']).lower().startswith(('b_','s_'))] or fr
    best=None;ba=-1
    for f in main:
        im=Image.open(os.path.join(root,'sprites',f['file'])).convert('RGBA'); bb=im.getbbox()
        a=(bb[2]-bb[0])*(bb[3]-bb[1]) if bb else 0
        if a>ba: ba=a;best=im.crop(bb) if bb else im
    sc=max(1,min(6,512//max(best.size)))
    best.resize((best.width*sc,best.height*sc),Image.NEAREST).save(os.path.join(out,r['file']))
json.dump(res,open(os.path.join(out,'..','refs.json'),'w'),ensure_ascii=False,indent=1)
from collections import Counter
print(len(res),Counter(r['cat'] for r in res))
