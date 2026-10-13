"""Generate NetStorm redraws with Ludo.ai and keep the history next to the result.

Run with a venv that has pillow (python3 -m venv original/generator/.venv && .../pip install pillow):
  original/generator/.venv/bin/python tools/art/ludo.py status
  ... ludo.py gen sunbattery [--brief "..."] [-n 2] [--note "bigger orb"] [--type sprite]
  ... ludo.py gen sunbattery --from v1 --note "make the sails darker"
  ... ludo.py verdict sunbattery v1 "sails too pale" [--status done]

gen        designs a NEW object in the Elemental Isles style (not a copy of the original sprite):
           Ludo "generate with style" with style/anchor.png as the style image and the prompt
           data/ludo_style.txt + the asset's `brief` + faction palette + size hint + --note.
           `brief` = what the object does in the game + the new design idea. Pass it once with --brief;
           it is saved in the manifest.
gen --from edits an earlier version instead: the prompt is --note only, style/anchor.png goes along as the reference.
gen --part base  generates one layer of a layered object (see "Layers" in CLAUDE.md); its brief is kept per part.
texture NAME "..."  makes a tileable material for the 3D models: tools/art/textures/NAME.png (in git).
gen --art-style generates from text alone with a built-in Ludo style (no anchor image).
Every result lands in original/generator/out/NNN_<id>/<id>_vN.png with check_vN.png and a line in log.jsonl.
The API key is read from LUDO_API_KEY or the repo's .env and is never printed or stored.
API spec: https://api.ludo.ai/api-documentation/openapi.json
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

KIT = Path(__file__).resolve().parent  # tools/art, in git
LOCAL = KIT.parent.parent / 'original' / 'generator'  # refs/ and out/: original game art and results, not in git
MANIFEST = KIT / 'data' / 'assets_manifest.json'
STYLE = KIT / 'data' / 'ludo_style.txt'
ANCHOR = KIT / 'style' / 'anchor.png'
API = 'https://api.ludo.ai/api'
TEXTURE_SIZE = 512  # px: textures live in git, and models are rendered small


def api_key():
    key = os.environ.get('LUDO_API_KEY')
    env = KIT.parent.parent / '.env'
    if not key and env.exists():
        m = re.search(r'^LUDO_API_KEY=(.+)$', env.read_text(), re.M)
        key = m and m.group(1).strip().strip('"\'')
    if not key:
        sys.exit('LUDO_API_KEY is not set and not found in ' + str(env))
    return key


def call(path, body=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body else None,
        headers={'Authorization': 'ApiKey ' + api_key(), 'Content-Type': 'application/json'},
    )
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        sys.exit(f'Ludo API {e.code} on {path}: {e.read().decode()[:500]}')


def load_manifest():
    return json.loads(MANIFEST.read_text())


def save_manifest(m):
    MANIFEST.write_text(json.dumps(m, indent=1, ensure_ascii=False))


def find(m, asset_id):
    for a in m:
        if a['id'] == asset_id:
            return a
    sys.exit(f'unknown asset id {asset_id!r}; see data/assets_manifest.json')


def out_dir(a):
    return LOCAL / 'out' / f"{a['no']:03d}_{a['id']}"


def read_log(a):
    p = out_dir(a) / 'log.jsonl'
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()] if p.exists() else []


def append_log(a, entry):
    d = out_dir(a)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / 'log.jsonl', 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')


def stem(a, part=None):
    return a['id'] + (f'_{part}' if part else '')


def next_version(a, part=None):
    nums = [int(m.group(1)) for p in out_dir(a).glob(f'{stem(a, part)}_v*.png') if (m := re.search(r'_v(\d+)\.png$', p.name))]
    # deleted versions keep their number: their verdicts stay in the log
    nums += [int(v[1:]) for e in read_log(a) if e.get('part') == part for v in e.get('versions', [])]
    return max(nums, default=0) + 1


def data_url(path):
    return 'data:image/png;base64,' + base64.b64encode(Path(path).read_bytes()).decode()


def cmd_gen(args):
    m = load_manifest()
    a = find(m, args.id)
    d = out_dir(a)
    if args.src:
        if not args.note:
            sys.exit('--from needs --note: it is the whole edit instruction')
        source = d / f'{stem(a, args.part)}_{args.src}.png'
        prompt = args.note + '\nKeep everything else, the camera, the silhouette and the transparent background unchanged.'
    else:
        source = ANCHOR
        briefs = a.setdefault('parts', {}) if args.part else a
        key = args.part or 'brief'
        if args.brief:
            briefs[key] = args.brief
            save_manifest(m)
        if not briefs.get(key):
            sys.exit(f"no design brief yet: look at original/generator/{a['ref']}, then pass --brief \"what it does in the game + the new design idea\"")
        faction = next((line for line in a['prompt'].splitlines() if line.startswith('Faction:')), '')
        shape = 'wide' if a['w'] > a['h'] * 1.15 else 'tall' if a['h'] > a['w'] * 1.15 else 'about as wide as tall'
        parts = [
            STYLE.read_text().strip(), f"Object: {a['name']} ({a['cat']})" + (f', only its part "{args.part}"' if args.part else '') + f'. {briefs[key]}', faction,
            None if args.part else f"Overall shape: {shape}, width to height about {a['w']}:{a['h']}.", args.note and 'Extra: ' + args.note,
        ]
        prompt = '\n\n'.join(x for x in parts if x)
    if not source.exists():
        sys.exit(f'source image not found: {source}')
    d.mkdir(parents=True, exist_ok=True)

    if args.src:
        job = call('/assets/image/edit', {
            'image': data_url(source), 'reference_image': data_url(ANCHOR), 'prompt': prompt, 'image_type': args.type, 'n': args.n,
        })
    elif args.art_style:
        body = {'image_type': args.type, 'prompt': prompt, 'art_style': args.art_style, 'n': args.n}
        if args.perspective:
            body['perspective'] = args.perspective
        job = call('/assets/image', body)
    else:
        job = call('/assets/image/style', {'style_image': data_url(source), 'prompt': prompt, 'image_type': args.type, 'n': args.n})
    print('job', job['id'], job['status'])
    while job['status'] in ('queued', 'running'):
        time.sleep(job.get('poll_after_ms', 0) / 1000)
        job = call(f"/assets/jobs/{job['id']}?wait=30")
    if job['status'] != 'succeeded':
        sys.exit(f"job {job['status']}: {job.get('error')}")

    # the original frame at game size: check_asset.py compares footprint and readability, not likeness
    orig = d / '_original.png'
    Image.open(LOCAL / a['ref']).resize((a['w'], a['h']), Image.NEAREST).save(orig)
    tile = ['--tile'] if a['cat'] == 'terrain tile' else []
    versions = []
    for r in job['result']:
        v = f'v{next_version(a, args.part)}'
        png = d / f'{stem(a, args.part)}_{v}.png'
        tmp, _ = urllib.request.urlretrieve(r['url'])
        im = Image.open(tmp).convert('RGBA')  # Ludo returns webp
        im.save(png)
        if im.getpixel((0, 0))[3] > 0:
            print('WARNING: corner is not transparent — background was painted in')
        print(f'\n{png.relative_to(KIT.parent.parent)}')
        subprocess.run([sys.executable, str(KIT / 'check_asset.py'), str(png), str(orig), '-o', str(d / f'check_{stem(a, args.part)}_{v}.png')] + tile)
        versions.append(v)
    append_log(a, {
        'at': time.strftime('%Y-%m-%d %H:%M'), 'part': args.part, 'versions': versions, 'from': args.src or (f'text only, {args.art_style}, {args.perspective}' if args.art_style else 'style/anchor.png'), 'type': args.type,
        'job': job['id'], 'credits': job.get('credits_charged'), 'prompt': prompt,
    })
    if a['status'] == 'todo':
        a['status'] = 'in_progress'
        save_manifest(m)
    print(f"\ncredits charged: {job.get('credits_charged')}. Look at the check_*.png files, then record a verdict.")


def cmd_texture(args):
    prompt = (
        'Seamless tileable material texture, flat surface seen straight on, even light, no cast shadows, no perspective, '
        'no objects, no text. Hand-drawn illustration: thin ink linework with flat watercolour washes, natural colours. '
        'Material: ' + args.brief
    )
    job = call('/assets/image', {'image_type': 'texture', 'prompt': prompt, 'art_style': 'Illustration', 'n': 1})
    while job['status'] in ('queued', 'running'):
        time.sleep(job.get('poll_after_ms', 0) / 1000)
        job = call(f"/assets/jobs/{job['id']}?wait=30")
    if job['status'] != 'succeeded':
        sys.exit(f"job {job['status']}: {job.get('error')}")
    tmp, _ = urllib.request.urlretrieve(job['result'][0]['url'])
    out = KIT / 'textures' / f'{args.name}.png'
    out.parent.mkdir(exist_ok=True)
    im = Image.open(tmp).convert('RGB')
    im.thumbnail((TEXTURE_SIZE, TEXTURE_SIZE), Image.LANCZOS)
    im.save(out, optimize=True)
    with open(KIT / 'textures' / 'prompts.jsonl', 'a') as f:
        f.write(json.dumps({'name': args.name, 'at': time.strftime('%Y-%m-%d %H:%M'), 'brief': args.brief}) + '\n')
    print(out.relative_to(KIT.parent.parent), im.size, 'credits', job.get('credits_charged'))


def cmd_verdict(args):
    m = load_manifest()
    a = find(m, args.id)
    if not (out_dir(a) / f'{stem(a, args.part)}_{args.version}.png').exists():
        sys.exit(f'no such version: {args.version}')
    append_log(a, {'at': time.strftime('%Y-%m-%d %H:%M'), 'part': args.part, 'verdict': args.version, 'text': args.text})
    if args.status:
        a['status'] = args.status
        save_manifest(m)


def cmd_status(_args):
    m = load_manifest()
    counts = {}
    for a in m:
        counts[a['status']] = counts.get(a['status'], 0) + 1
    print('assets:', ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))
    print('credits available:', call('/assets/account')['credits']['available'])
    for a in m:
        log = read_log(a)
        if a['status'] == 'todo' and not log:
            continue
        print(f"\n{a['no']:03d} {a['id']} ({a['name']}, {a['cat']}, {a['w']}x{a['h']}) — {a['status']}")
        verdicts = {(e.get('part'), e['verdict']): e['text'] for e in log if 'verdict' in e}
        for e in log:
            for v in e.get('versions', []):
                name = f"{e['part']} {v}" if e.get('part') else v
                print(f"  {name}  from {e['from']}  {e['at']}  — {verdicts.get((e.get('part'), v), 'no verdict yet')}")
    todo = next((a for a in m if a['status'] == 'todo'), None)
    if todo:
        print(f"\nnext todo: {todo['no']:03d} {todo['id']} ({todo['name']})")


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest='cmd', required=True)
g = sub.add_parser('gen')
g.add_argument('id')
g.add_argument('-n', type=int, default=2, help='variations, 1-4 (0.5 credit each)')
g.add_argument('--brief', help='what the object does in the game + the new design idea; saved in the manifest')
g.add_argument('--part', help='generate one layer of the object (base, top_s, ...): own brief, files <id>_<part>_vN.png')
g.add_argument('--note', help='extra instruction for this run')
g.add_argument('--from', dest='src', metavar='vN', help='edit an earlier version instead of designing a new one')
g.add_argument('--art-style', help='use a built-in Ludo style instead of style/anchor.png: Illustration, Hand-Painted, Inked Painterly, ...')
g.add_argument('--perspective', help='with --art-style: Top-Down, High Angle, 2.5D, ...')
g.add_argument('--type', default='sprite', help='Ludo image_type: sprite, tile, sprite-tiling-horizontal, icon, ...')
g.set_defaults(fn=cmd_gen)
v = sub.add_parser('verdict')
v.add_argument('id')
v.add_argument('version', metavar='vN')
v.add_argument('text')
v.add_argument('--part')
v.add_argument('--status', choices=['todo', 'in_progress', 'done'])
v.set_defaults(fn=cmd_verdict)
t = sub.add_parser('texture')
t.add_argument('name')
t.add_argument('brief')
t.set_defaults(fn=cmd_texture)
sub.add_parser('status').set_defaults(fn=cmd_status)
args = ap.parse_args()
args.fn(args)
