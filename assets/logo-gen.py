import json, sys
from PIL import Image
src = Image.open('/Users/harryg/Downloads/OBrSyupX_400x400.jpg').convert('RGB')
# dominant colors
q = src.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette()[:18]; counts = sorted(q.getcolors(), reverse=True)
print("dominant:", [(c, '#%02x%02x%02x' % tuple(pal[i*3:i*3+3])) for c, i in counts[:6]])
# brand palette (measured from clusters, then rounded)
BG=(0xe9,0xe3,0xd5)  # beige background -> transparent
PALETTE={ 'sky':(0x7f,0xd8,0xff), 'orange':(0xf6,0x60,0x47), 'navy':(0x02,0x7b,0xb0) }
def nearest(px):
    best=None; bd=1e9
    for name,c in list(PALETTE.items())+[('bg',BG)]:
        d=sum((a-b)**2 for a,b in zip(px,c))
        if d<bd: bd=d; best=name
    return best
# crop to content bbox
W,H=src.size; px=src.load()
xs=[x for x in range(W) for y in range(0,H,4) if nearest(px[x,y])!='bg']
ys=[y for y in range(H) for x in range(0,W,4) if nearest(px[x,y])!='bg']
x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
pad=6; box=(max(0,x0-pad),max(0,y0-pad),min(W,x1+pad),min(H,y1+pad))
content=src.crop(box); print("content box",box,"size",content.size)
IDX={'bg':0,'sky':1,'orange':2,'navy':3}
out={}
for w in (32,44,60):
    h=round(content.size[1]*w/content.size[0]); h+=h%2  # even rows for half-blocks
    im=content.resize((w,h), Image.Resampling.LANCZOS); p=im.load()
    rows=[''.join(str(IDX[nearest(p[x,y])]) for x in range(w)) for y in range(h)]
    out[w]={'width':w,'height':h,'rows':rows}
    mono={0:' ',1:'░',2:'▒',3:'█'}
    print(f"\n=== {w}x{h} px -> {w} cols x {h//2} rows (mono preview, full-height pixels) ===")
    for r in rows: print(''.join(mono[int(c)] for c in r))
json.dump({'palette':{'bg':'#%02x%02x%02x'%BG,'sky':'#%02x%02x%02x'%PALETTE['sky'],'orange':'#%02x%02x%02x'%PALETTE['orange'],'navy':'#%02x%02x%02x'%PALETTE['navy']},'index':{'0':'transparent','1':'sky','2':'orange','3':'navy'},'sizes':out}, open('logo.json','w'), indent=1)
# half-block ANSI renderers for a quick look
def ansi(size, truecolor=True):
    d=out[size]; rows=d['rows']; col={1:PALETTE['sky'],2:PALETTE['orange'],3:PALETTE['navy']}
    def fg(c): return '\x1b[38;2;%d;%d;%dm'%c
    def bg(c): return '\x1b[48;2;%d;%d;%dm'%c
    lines=[]
    for y in range(0,d['height'],2):
        top=rows[y]; bot=rows[y+1] if y+1<d['height'] else '0'*d['width']; s=''
        for x in range(d['width']):
            t=int(top[x]); b=int(bot[x])
            if t and b: s+=fg(col[t])+bg(col[b])+'▀'+'\x1b[0m'
            elif t: s+=fg(col[t])+'▀'+'\x1b[0m'
            elif b: s+=fg(col[b])+'▄'+'\x1b[0m'
            else: s+=' '
        lines.append(s.rstrip())
    return '\n'.join(lines)
for size in (32,44,60):
    open(f'logo-{size}.ans','w').write(ansi(size)+'\n')
print("\nwrote logo.json and logo-{32,44,60}.ans")
