"""Flatten base + top layers from render.py and lay the facings out for review.

  python sheet.py RENDER_DIR OUT.png [--game-width 45]

Top row: each facing at render size. Bottom row: the same at the original game size, shown x4.
"""
import argparse
from pathlib import Path

from PIL import Image

BACKGROUND = (92, 88, 104, 255)  # the game's grey-purple sky
PREVIEW_ZOOM = 4

ap = argparse.ArgumentParser()
ap.add_argument('render_dir')
ap.add_argument('out')
ap.add_argument('--game-px-per-render-px', type=float, default=0.25, help='1 / the --scale used in render.py')
a = ap.parse_args()

d = Path(a.render_dir)
base = Image.open(d / 'base.png').convert('RGBA') if (d / 'base.png').exists() else None
tops = [p for p in (d / f'top_{f}.png' for f in 'nesw') if p.exists()]
frames = []
for p in tops or [None]:
    frame = base.copy() if base else Image.new('RGBA', Image.open(p).size, (0, 0, 0, 0))
    if p:
        frame.alpha_composite(Image.open(p).convert('RGBA'))
        frame.save(d / p.name.replace('top_', 'flat_'))
    frames.append(frame)
w, h = frames[0].size
small = (round(w * a.game_px_per_render_px), round(h * a.game_px_per_render_px))
sheet = Image.new('RGBA', (w * len(frames), h + small[1] * PREVIEW_ZOOM), BACKGROUND)
for i, frame in enumerate(frames):
    sheet.alpha_composite(frame, (i * w, 0))
    tiny = frame.resize(small, Image.LANCZOS).resize((small[0] * PREVIEW_ZOOM, small[1] * PREVIEW_ZOOM), Image.NEAREST)
    sheet.alpha_composite(tiny, (i * w + (w - tiny.width) // 2, h))
sheet.save(a.out)
print('sheet', sheet.size, 'frames', len(frames))
