# Sun Cannon: a heavy gun on a turntable that fires straight north, east, south or west.
# Footprint 3 x 3 cells. Units are cells. See render.py for the helpers.
sandstone = material('sandstone', tile=1.0)
iron = material('iron', tint=(0.6, 0.62, 0.7), tile=1.5)
bronze = material('bronze', tint=(1.0, 0.8, 0.52), tile=1.5)
oak = material('oak', tint=(0.85, 0.72, 0.62), tile=0.8)
black = flat('bore', (0.01, 0.008, 0.008))

FLOOR = 0.22  # top of the stone platform
PLATFORM_R = 1.45
WALL_INNER_R, WALL_TOP = 1.2, 0.5
GAP_HALF_DEG = 16  # half-width of each of the four openings the gun fires through
TABLE_R, TABLE_TOP = 1.0, 0.27

# --- base: platform, parapet with four openings, turntable -------------------------------------------------
cone(BASE, sandstone, PLATFORM_R, PLATFORM_R, 0, FLOOR)
for quarter in range(4):  # wall segments between the openings at east, north, west, south
    start = quarter * 90 + GAP_HALF_DEG
    arc(BASE, sandstone, WALL_INNER_R, PLATFORM_R, FLOOR, WALL_TOP, start, start + 90 - 2 * GAP_HALF_DEG)
cone(BASE, iron, TABLE_R, TABLE_R, FLOOR, TABLE_TOP)
TEETH = 40
for i in range(TEETH):  # toothed ring: the table is turned by a gear
    spoke = group(BASE, rotation=(0, 0, 360 * i / TEETH))
    box(spoke, iron, (0.08, 0.07, TABLE_TOP - FLOOR), (TABLE_R + 0.03, 0, (FLOOR + TABLE_TOP) / 2))
crank = group(BASE, rotation=(0, 0, -52))  # hand crank at the lower right, its gear on the toothed ring
box(crank, iron, (0.07, 0.07, 0.3), (TABLE_R + 0.11, 0, FLOOR + 0.15))
cone(crank, iron, 0.1, 0.1, -0.02, 0.02, at=(TABLE_R + 0.11, 0), rotation=(0, 90, 0)).location.z = FLOOR + 0.32

# --- top: carriage and barrel, muzzle toward -Y ------------------------------------------------------------
BED_TOP = TABLE_TOP + 0.1
CHEEK_TOP = BED_TOP + 0.34
box(TOP, oak, (0.8, 1.2, 0.1), (0, 0, TABLE_TOP + 0.05))
for side in (-1, 1):
    box(TOP, oak, (0.14, 1.0, 0.34), (side * 0.3, 0, BED_TOP + 0.17))  # cheek
    for y in (-0.3, 0.3):
        box(TOP, iron, (0.17, 0.1, 0.37), (side * 0.3, y, BED_TOP + 0.18))  # strap that binds the cheek
box(TOP, oak, (0.22, 0.26, 0.12), (0, 0.42, BED_TOP + 0.06))  # wedge under the breech sets the elevation
PIVOT_Z = CHEEK_TOP + 0.02
cone(TOP, bronze, 0.07, 0.07, -0.43, 0.43, rotation=(0, 90, 0)).location = (0, 0, PIVOT_Z)  # trunnions

ELEVATION_DEG = 12
barrel = group(TOP, at=(0, 0, PIVOT_Z), rotation=(90 - ELEVATION_DEG, 0, 0))  # local z runs breech -> muzzle
cone(barrel, bronze, 0.07, 0.09, -0.86, -0.76)  # knob to haul the gun back
cone(barrel, bronze, 0.19, 0.27, -0.76, -0.66)  # breech
cone(barrel, bronze, 0.26, 0.22, -0.66, 0.2)  # reinforced rear half, thick where the charge burns
cone(barrel, bronze, 0.22, 0.17, 0.2, 0.9)  # chase
cone(barrel, bronze, 0.17, 0.25, 0.9, 1.04)  # flared muzzle
for z, r in ((-0.6, 0.29), (-0.15, 0.275), (0.2, 0.25), (0.55, 0.215), (1.04, 0.265)):  # reinforcing rings
    cone(barrel, bronze, r, r, z - 0.03, z + 0.03)
cone(barrel, black, 0.13, 0.13, 1.07, 1.075)  # bore
