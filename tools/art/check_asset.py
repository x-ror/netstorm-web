"""Check a generated asset against the original game sprite.

Usage:
  python check_asset.py NEW.png ORIGINAL.png [--tile] [-o out.png]

Prints transparency info and aspect ratio vs the original, and writes a preview:
  - top: the new asset (tiled 4x in a row if --tile)
  - bottom: new and original shrunk to the original in-game width, x4, side by side
Requires: pip install pillow
"""
import argparse
from PIL import Image, ImageDraw

def solid(im):
    a = im.split()[3].point(lambda v: 255 if v > 40 else 0)
    bb = a.getbbox()
    return im.crop(bb) if bb else im

ap = argparse.ArgumentParser()
ap.add_argument('new'); ap.add_argument('orig')
ap.add_argument('--tile', action='store_true', help='tile horizontally to check seams')
ap.add_argument('-o', default='check.png')
a = ap.parse_args()
raw = Image.open(a.new).convert('RGBA')
ext = raw.split()[3].getextrema()
print('new size', raw.size, '| alpha range', ext, '| corner pixel', raw.getpixel((2, 2)))
if ext[0] == 255: print('WARNING: no transparency at all')
new = solid(raw); orig = solid(Image.open(a.orig).convert('RGBA'))
rn, ro = new.width / new.height, orig.width / orig.height
print(f'aspect new {rn:.2f} vs original {ro:.2f} -> diff {abs(rn-ro)/ro*100:.0f}%')
W = 1000
S = Image.new('RGBA', (W, 700), (92, 88, 104, 255)); d = ImageDraw.Draw(S)
n = 4 if a.tile else 1
row = Image.new('RGBA', (new.width * n, new.height), (0, 0, 0, 0))
for i in range(n): row.paste(new, (i * new.width, 0), new)
r = row.resize((W - 40, max(1, round((W - 40) * row.height / row.width))))
if r.height > 380: r = row.resize((max(1, round(380 * row.width / row.height)), 380))
S.paste(r, (20, 30), r); d.text((20, 10), 'new' + (' x4 tiled' if a.tile else ''), fill='white')
gw = orig.width
def game(im, k):
    g = im.resize((gw, max(1, round(gw * im.height / im.width))), Image.LANCZOS)
    st = Image.new('RGBA', (g.width * k, g.height), (0, 0, 0, 0))
    for i in range(k): st.paste(g, (i * g.width, 0), g)
    z = max(1, min(4, 460 // st.width))
    return st.resize((st.width * z, st.height * z), Image.NEAREST)
k = 4 if a.tile else 1
g1, g2 = game(new, k), game(orig, k)
d.text((20, 430), 'new @ game size', fill='white'); S.paste(g1, (20, 450), g1)
d.text((520, 430), 'original @ game size', fill='white'); S.paste(g2, (520, 450), g2)
S.save(a.o); print('preview ->', a.o)
