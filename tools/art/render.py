"""Render a game object from the game camera as transparent PNG layers. Runs inside Blender.

  blender -b -P tools/art/render.py -- MODEL OUT_DIR [--scale 4] [--plain]
  blender -b -P tools/art/render.py -- models/suncannon.py out/     a model built by a script (see below)
  blender -b -P tools/art/render.py -- gun.glb out/ --turn 90       a GLB, e.g. from Ludo image-to-3D

Output, all on one canvas with one anchor, so layers and facings stack and swap without any offsets:
  base.png                      everything parented to BASE (nothing is written if BASE is empty)
  top_n.png top_e.png top_s.png top_w.png   everything parented to TOP, turned to the sim facings 0..3
  sprite.json                   canvas size, anchor in pixels, pixels per cell

Units: 1 Blender unit = 1 ground cell. The camera is orthographic and looks north and down at 43.4 degrees,
so a cell is 16 x 11 game pixels on screen; --scale multiplies that (4 gives 64 x 44).
Light comes from the top-left. Shading is flat steps with an ink outline; --plain gives ordinary shading.

A model script is plain Python run with these names available:
  BASE, TOP                                   parents for the still part and the turning part
  material(texture, tint=(1, 1, 1), tile=1)   textures/<texture>.png, box-projected, `tile` cells per repeat
  flat(name, colour)                          a single-colour material
  cone(parent, mat, r0, r1, z0, z1)           round solid along the parent's z; r0 == r1 is a cylinder
  box(parent, mat, size, at, rotation=(0, 0, 0))
  arc(parent, mat, r_inner, r_outer, z0, z1, start_deg, end_deg)   a piece of a ring wall
  group(parent, at, rotation=(0, 0, 0))       an empty to build tilted parts in (rotation in degrees)
Build the turning part with its front (muzzle) toward -Y and its axis on the origin.
"""
import argparse
import json
import math
import runpy
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

KIT = Path(__file__).resolve().parent
GAME_CELL_PX = 16  # width of a ground cell in the original game's pixels
CELL_DEPTH_RATIO = 11 / 16  # screen depth of a cell over its width: fixes the camera elevation
ELEVATION = math.asin(CELL_DEPTH_RATIO)  # camera angle above the horizon, about 43.4 degrees
ANCHOR = (0.5, 0.7)  # where the object's ground centre sits on the canvas, as a share of its size
CAMERA_DISTANCE = 20.0
FACINGS = {'n': 180, 'e': 90, 's': 0, 'w': 270}  # degrees to turn TOP about the vertical axis
ROUND_SEGMENTS = 64
SUN_FROM = Vector((-1.0, -0.6, 1.4))  # top-left on screen
SUN_ENERGY = 3.0
AMBIENT = 0.6
TOON_AMBIENT = 0.15  # low, so shadowed and hollow parts fall under the steps
# light value -> multiplier of the surface colour: hard steps from deep hollows through cool shadow to full colour
TOON_STEPS = ((0.0, (0.22, 0.19, 0.24, 1)), (0.05, (0.62, 0.57, 0.68, 1)), (0.35, (1, 1, 1, 1)))
OUTLINE_PX_PER_SCALE = 0.2  # ink line thickness in pixels per unit of --scale
CREASE_DEGREES = 120  # edges sharper than this get an ink line
INK = (0.012, 0.008, 0.008)  # linear RGB: comes out as a near-black warm ink
PROJECTION_BLEND = 0.2
MIX_A, MIX_B, MIX_RESULT = 6, 7, 2  # colour sockets of ShaderNodeMix

ap = argparse.ArgumentParser()
ap.add_argument('model')
ap.add_argument('out_dir')
ap.add_argument('--scale', type=int, default=4, help='output pixels per original game pixel')
ap.add_argument('--frame', type=float, default=5.0, help='canvas width and height in cells')
ap.add_argument('--plain', action='store_true', help='ordinary shading, no steps and no outline')
ap.add_argument('--cells', type=float, default=2.0, help='GLB only: scale the model so its largest side is this')
ap.add_argument('--stretch', type=float, default=1.0, help='GLB only: lengthen along the model x axis')
ap.add_argument('--turn', type=float, default=0.0, help='GLB only: degrees to turn it so its front faces -Y')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def group(parent, at=(0, 0, 0), rotation=(0, 0, 0)):
    obj = bpy.data.objects.new('group', None)
    scene.collection.objects.link(obj)
    obj.parent, obj.location, obj.rotation_euler = parent, at, [math.radians(d) for d in rotation]
    return obj


BASE, TOP = group(None), group(None)


def multiply(nodes, links, a, b):
    mix = nodes.new('ShaderNodeMix')
    mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1
    for socket, value in ((mix.inputs[MIX_A], a), (mix.inputs[MIX_B], b)):
        if hasattr(value, 'node'):
            links.new(value, socket)
        else:
            socket.default_value = (*value, 1)
    return mix.outputs[MIX_RESULT]


def material(texture, tint=(1, 1, 1), tile=1.0):
    mat = bpy.data.materials.new(texture)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / tile,) * 3
    image = nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images.load(str(KIT / 'textures' / f'{texture}.png'))
    image.projection, image.projection_blend = 'BOX', PROJECTION_BLEND
    links.new(coords.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], image.inputs['Vector'])
    links.new(multiply(nodes, links, image.outputs['Color'], tint), nodes['Principled BSDF'].inputs['Base Color'])
    return mat


def flat(name, colour):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgb = mat.node_tree.nodes.new('ShaderNodeRGB')
    rgb.outputs[0].default_value = (*colour, 1)
    mat.node_tree.links.new(rgb.outputs[0], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return mat


def place(obj, parent, mat, at, rotation=(0, 0, 0)):
    obj.parent, obj.location, obj.rotation_euler = parent, at, [math.radians(d) for d in rotation]
    obj.data.materials.append(mat)
    return obj


def cone(parent, mat, r0, r1, z0, z1, at=(0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=ROUND_SEGMENTS, radius1=r0, radius2=r1, depth=z1 - z0)
    return place(bpy.context.active_object, parent, mat, (at[0], at[1], (z0 + z1) / 2), rotation)


def box(parent, mat, size, at, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.data.transform(Matrix.Diagonal((*size, 1)))  # real size in the mesh keeps the texture unstretched
    return place(obj, parent, mat, at, rotation)


def arc(parent, mat, r_inner, r_outer, z0, z1, start_deg, end_deg):
    steps = max(2, round(ROUND_SEGMENTS * (end_deg - start_deg) / 360))
    verts, faces = [], []
    for i in range(steps + 1):
        angle = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        c, s = math.cos(angle), math.sin(angle)
        verts += [(r_inner * c, r_inner * s, z0), (r_outer * c, r_outer * s, z0),
                  (r_outer * c, r_outer * s, z1), (r_inner * c, r_inner * s, z1)]
    for i in range(steps):
        a, b = i * 4, i * 4 + 4
        faces += [(a + 1, b + 1, b + 2, a + 2), (a + 3, a + 2, b + 2, b + 3), (a, a + 3, b + 3, b), (a + 1, a, b, b + 1)]
    last = steps * 4
    faces += [(3, 2, 1, 0), (last, last + 1, last + 2, last + 3)]
    mesh = bpy.data.meshes.new('arc')
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('arc', mesh)
    scene.collection.objects.link(obj)
    return place(obj, parent, mat, (0, 0, 0))


def load_glb(path):
    """Import a GLB into TOP: centred on the vertical axis, standing on the ground, largest side = --cells."""
    ours = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    roots = [o for o in scene.objects if o not in ours and o.parent is None]  # often an empty above the meshes
    meshes = [o for o in scene.objects if o.type == 'MESH']
    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector(min(c[i] for c in corners) for i in range(3))
    hi = Vector(max(c[i] for c in corners) for i in range(3))
    k = args.cells / max(hi - lo)
    pivot = group(group(TOP, rotation=(0, 0, args.turn)))
    pivot.scale = (k * args.stretch, k, k)
    pivot.location = (-(lo.x + hi.x) / 2 * k * args.stretch, -(lo.y + hi.y) / 2 * k, -lo.z * k)
    for o in roots:
        o.parent = pivot


def toon(mat):
    """Replace a material's lighting with hard steps over its own colour."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if not bsdf or not output or not bsdf.inputs['Base Color'].links:
        return
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    to_rgb = nodes.new('ShaderNodeShaderToRGB')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    while len(ramp.color_ramp.elements) < len(TOON_STEPS):
        ramp.color_ramp.elements.new(1.0)
    for element, (position, value) in zip(ramp.color_ramp.elements, TOON_STEPS):
        element.position, element.color = position, value
    emission = nodes.new('ShaderNodeEmission')
    links.new(diffuse.outputs[0], to_rgb.inputs[0])
    links.new(to_rgb.outputs[0], ramp.inputs[0])
    links.new(multiply(nodes, links, bsdf.inputs['Base Color'].links[0].from_socket, ramp.outputs[0]), emission.inputs[0])
    links.new(emission.outputs[0], output.inputs['Surface'])


def family(root):
    return [root] + [d for child in root.children for d in family(child)]


def show_only(root):
    for obj in scene.objects:
        if obj.type == 'MESH':
            obj.hide_render = obj not in family(root)


if args.model.endswith('.glb'):
    load_glb(args.model)
else:
    runpy.run_path(args.model, init_globals={
        'BASE': BASE, 'TOP': TOP, 'material': material, 'flat': flat, 'cone': cone, 'box': box, 'arc': arc, 'group': group,
    })

cam_data = bpy.data.cameras.new('cam')
cam_data.type, cam_data.ortho_scale = 'ORTHO', args.frame
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
# aim so that the ground centre lands on ANCHOR: the screen's up direction is (0, sin, cos) in the world
target = Vector((0, math.sin(ELEVATION), math.cos(ELEVATION))) * (ANCHOR[1] - 0.5) * args.frame
cam.location = target + Vector((0, -math.cos(ELEVATION), math.sin(ELEVATION))) * CAMERA_DISTANCE
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = SUN_ENERGY
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (-SUN_FROM).to_track_quat('-Z', 'Y').to_euler()
world = bpy.data.worlds.new('world')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = AMBIENT if args.plain else TOON_AMBIENT
scene.world = world

for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):  # the name differs between Blender versions
    try:
        scene.render.engine = engine
        break
    except TypeError:
        pass
size = round(args.frame * GAME_CELL_PX * args.scale)
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'  # keep the textures' own colours

if not args.plain:
    for mat in bpy.data.materials:
        if mat.use_nodes:
            toon(mat)
    if hasattr(scene.eevee, 'use_raytracing'):
        scene.eevee.use_raytracing = True  # lets hollows lose ambient light
    scene.render.use_freestyle = True
    scene.render.line_thickness = OUTLINE_PX_PER_SCALE * args.scale
    lineset = bpy.context.view_layer.freestyle_settings.linesets.new('ink')
    lineset.select_silhouette = lineset.select_external_contour = lineset.select_crease = True
    lineset.select_border = False
    bpy.context.view_layer.freestyle_settings.crease_angle = math.radians(CREASE_DEGREES)
    lineset.linestyle.color = INK

written = []
if BASE.children:
    show_only(BASE)
    scene.render.filepath = f'{args.out_dir}/base.png'
    bpy.ops.render.render(write_still=True)
    written.append('base')
if TOP.children:
    show_only(TOP)
    for name, degrees in FACINGS.items():
        TOP.rotation_euler = (0, 0, math.radians(degrees))
        scene.render.filepath = f'{args.out_dir}/top_{name}.png'
        bpy.ops.render.render(write_still=True)
        written.append(f'top_{name}')
Path(args.out_dir, 'sprite.json').write_text(json.dumps({
    'size': [size, size], 'anchor': [round(size * ANCHOR[0]), round(size * ANCHOR[1])],
    'pxPerCell': [GAME_CELL_PX * args.scale, GAME_CELL_PX * CELL_DEPTH_RATIO * args.scale], 'layers': written,
}, indent=2) + '\n')
print('rendered', written, 'canvas', size)
