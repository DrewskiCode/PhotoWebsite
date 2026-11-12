"""
THE LAP — builds the gallery building, bakes its lighting, exports it for the site.

Run (headless):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      --python tools/build_gallery.py -- [--res 4096] [--samples 512] [--preview] [--nobake]

Outputs:
  public/gallery/world.bin        geometry (quantised positions + lightmap UVs)
  tools/out/lightmap.npy          linear float lightmap (encoded to WebP by tools/build_assets.mjs)
  src/gallery/layout.json         photo anchors, labels, collision, rooms, portals
  tools/out/preview_*.png         optional look-dev renders (--preview)

Coordinates here are Blender's (X east, Y north, Z up, metres). Everything
written for the site is converted to three.js (X, Z-up -> Y, -Y -> Z).
"""
import bpy, math, json, os, sys, struct, random
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'out')
os.makedirs(OUT, exist_ok=True)
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None, cast=str):
    if name in ARGV:
        i = ARGV.index(name)
        if default is None:
            return True
        return cast(ARGV[i + 1])
    return False if default is None else default


RES = arg('--res', 4096, int)
SAMPLES = arg('--samples', 512, int)
PREVIEW = arg('--preview')
NOBAKE = arg('--nobake')
PLAN = arg('--plan')
REF = 4096          # packing is done in reference pixels
PAD = 4             # px of padding around each island at REF
GAP = 0.05          # each room's shell is inset this far from the shared wall line
Z = Vector((0, 0, 1))

# ----------------------------------------------------------------------------
# materials: linear albedo (used for bounce light in the bake and by the site)
# ----------------------------------------------------------------------------
MATS = {
    'plaster':    (0.80, 0.79, 0.77),
    'ceiling':    (0.82, 0.82, 0.80),
    'concrete':   (0.50, 0.49, 0.47),
    'floor':      (0.36, 0.355, 0.35),
    'floor_dark': (0.12, 0.12, 0.125),
    'dark':       (0.07, 0.07, 0.078),
    'steel':      (0.03, 0.03, 0.035),
    'oak':        (0.42, 0.27, 0.15),
    'grass':      (0.12, 0.22, 0.05),
    'path':       (0.50, 0.49, 0.46),
    'plaza':      (0.46, 0.45, 0.43),
    'lane':       (0.76, 0.03, 0.07),
    'line':       (0.88, 0.88, 0.86),
    'frame':      (0.02, 0.02, 0.02),
    'ext':        (0.80, 0.79, 0.77),
    'roof':       (0.70, 0.70, 0.69),
    'trunk':      (0.30, 0.24, 0.18),
    'leaf':       (0.10, 0.22, 0.06),
    'leafdead':   (0.42, 0.34, 0.20),
    'baton':      (0.76, 0.03, 0.07),
}

ISLANDS = []     # baked surfaces
UNB = {}         # (room, mat) -> {'v': [], 't': []}   unbaked, still cast shadows
GLASS = []       # quads [p0..p3] (+room)
COLL = []        # 2D segments ((x,y),(x,y))
SPOTS = []       # (pos, target, energy)
EMIT = []        # emissive quads for the bake (screens)
DECALS = []      # floor decals reuse the floor's lightmap
LABELS = []
PHOTOS = []
SCREENS = []
DOORS = []
WALLI = {}       # (room, edge) -> Island
FLOORI = {}      # room -> Island
CUR = ['ext']


def V2(p):
    return Vector((p[0], p[1]))


def V3(p, z=0.0):
    return Vector((p[0], p[1], z))


class Island:
    def __init__(self, mat, verts, tris, luvs, dens=1.0, frame=None, room=None):
        self.mat, self.verts, self.tris, self.luvs = mat, verts, tris, luvs
        self.dens, self.frame, self.room = dens, frame, room or CUR[0]
        us = [u for u, v in luvs]
        vs = [v for u, v in luvs]
        self.min = (min(us), min(vs))
        self.ext = (max(us) - self.min[0], max(vs) - self.min[1])
        self.px = self.py = 0
        self.scale = 1.0

    def luv_to_uv(self, u, v):
        return ((self.px + PAD + (u - self.min[0]) * self.scale) / REF,
                (self.py + PAD + (v - self.min[1]) * self.scale) / REF)

    def uv(self, p):
        o, e1, e2 = self.frame
        d = p - o
        return self.luv_to_uv(d.dot(e1), d.dot(e2))


def orient(verts, tris, facing):
    out = []
    for a, b, c in tris:
        n = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        if n.length < 1e-9:
            continue
        f = facing((verts[a] + verts[b] + verts[c]) / 3) if callable(facing) else facing
        out.append((a, b, c) if n.dot(f) >= 0 else (a, c, b))
    return out


def unbaked(mat, verts, tris, room=None):
    g = UNB.setdefault((room or CUR[0], mat), {'v': [], 't': []})
    o = len(g['v'])
    g['v'] += [Vector(v) for v in verts]
    g['t'] += [(a + o, b + o, c + o) for a, b, c in tris]


def basis(n):
    if abs(n.z) < 0.999:
        e1 = Vector((-n.y, n.x, 0)).normalized()
    else:
        e1 = Vector((1, 0, 0))
    return e1, n.cross(e1).normalized()


def poly(mat, pts, facing, holes=(), dens=1.0, baked=True, room=None):
    pts = [Vector(p) for p in pts]
    hs = [[Vector(p) for p in h] for h in holes]
    allp = pts + [p for h in hs for p in h]
    tris = orient(allp, [tuple(t) for t in tessellate_polygon([pts] + hs)], facing)
    if not baked:
        unbaked(mat, allp, tris, room)
        return None
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    n.normalize()
    e1, e2 = basis(n)
    o = pts[0]
    isl = Island(mat, allp, tris, [((p - o).dot(e1), (p - o).dot(e2)) for p in allp], dens, (o, e1, e2), room)
    ISLANDS.append(isl)
    return isl


def strip(mat, A, B, facing, dens=1.0, baked=True, luv=None):
    """Quads between two polylines, unrolled into one island."""
    n = len(A)
    verts = list(A) + list(B)
    tris = []
    for i in range(n - 1):
        tris += [(i, i + 1, n + i + 1), (i, n + i + 1, n + i)]
    tris = orient(verts, tris, facing)
    if not baked:
        unbaked(mat, verts, tris)
        return None
    if luv is None:
        cum = [0.0]
        for i in range(1, n):
            cum.append(cum[-1] + ((A[i] - A[i - 1]).length + (B[i] - B[i - 1]).length) / 2)
        luv = [(cum[i], 0.0) for i in range(n)] + [(cum[i], (A[i] - B[i]).length) for i in range(n)]
    isl = Island(mat, verts, tris, luv, dens)
    ISLANDS.append(isl)
    return isl


def obox(mat, c, ex, ey, ez, hx, hy, hz, baked=False, dens=1.0, skip=()):
    for name, n, u, v, hn, hu, hv in (('+x', ex, ey, ez, hx, hy, hz), ('-x', -ex, ey, ez, hx, hy, hz),
                                      ('+y', ey, ex, ez, hy, hx, hz), ('-y', -ey, ex, ez, hy, hx, hz),
                                      ('+z', ez, ex, ey, hz, hx, hy), ('-z', -ez, ex, ey, hz, hx, hy)):
        if name in skip:
            continue
        cc = c + n * hn
        poly(mat, [cc - u * hu - v * hv, cc + u * hu - v * hv, cc + u * hu + v * hv, cc - u * hu + v * hv],
             n, baked=baked, dens=dens)


def box(mat, x, y, z0, z1, lx, ly, rot=0.0, baked=True, dens=1.0, solid=True):
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    ex, ey = Vector((c, s, 0)), Vector((-s, c, 0))
    obox(mat, Vector((x, y, (z0 + z1) / 2)), ex, ey, Z, lx / 2, ly / 2, (z1 - z0) / 2, baked, dens,
         skip=('-z',) if z0 <= 0.001 else ())
    if solid:
        pts = [Vector((x, y, 0)) + ex * sx * lx / 2 + ey * sy * ly / 2 for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
        for i in range(4):
            COLL.append(((pts[i].x, pts[i].y), (pts[(i + 1) % 4].x, pts[(i + 1) % 4].y), 2))


def beam(mat, p0, p1, w, d, side=None, baked=False, dens=0.5):
    a = p1 - p0
    L = a.length
    ex = a / L
    ey = side.copy() if side is not None else Z.cross(ex)
    ey = ey - ex * ey.dot(ex)
    if ey.length < 1e-5:
        ey = Vector((1, 0, 0))
    ey.normalize()
    ez = ex.cross(ey)
    obox(mat, (p0 + p1) / 2, ex, ey, ez, L / 2, w / 2, d / 2, baked, dens)


def cyl(mat, p0, p1, r0, r1, n=8):
    a = (p1 - p0).normalized()
    ex = basis(a)[0]
    ey = a.cross(ex)
    ring = lambda p, r: [p + (ex * math.cos(k * 2 * math.pi / n) + ey * math.sin(k * 2 * math.pi / n)) * r for k in range(n + 1)]
    A, B = ring(p0, r0), ring(p1, r1)
    axis = lambda pc: pc - (p0 + a * (pc - p0).dot(a))
    strip(mat, A, B, axis, baked=False)
    poly(mat, B[:-1], a, baked=False)


# ----------------------------------------------------------------------------
# plan
# ----------------------------------------------------------------------------
CA, CB, CC, CD = (-11, -6), (11, -8), (13, 9), (-9, 7)                       # courtyard ("the infield")
OA, OB, OC, OD = (-26, -21), (27, -23), (29, 24), (-24, 22)                  # outer corners
FA, FB = (-11, -21.566), (11, -22.396)                                       # facade
E9, N13, N9 = (28.362, 9), (13, 23.396), (-9, 22.566)
W7, W6 = (-24.698, 7), (-25.302, -6)
S1, S2 = (-16, -21.377), (-18, -6)
D1, D2, D3, D4, D5 = (-9, 9), (-9, 21), (-18, 21.3), (-23.5, 15.5), (-21, 9)
ROT_C, ROT_R, ROT_H = (21.0, 16.4), 6.3, 11.0

SUN_AZ, SUN_EL = math.radians(30), math.radians(40)   # light travels toward north-north-east
SUN_DIR = Vector((math.sin(SUN_AZ) * math.cos(SUN_EL), math.cos(SUN_AZ) * math.cos(SUN_EL), -math.sin(SUN_EL)))

PORTALS = [
    dict(id='p1',  p=(11, -19.3),   dir=(1, 0), w=4.0, h=5.0, shape='rect', depth=0.9),
    dict(id='p1b', p=(11, -10.4),   dir=(1, 0), w=3.2, h=4.4, shape='rect', depth=0.9),
    dict(id='p2',  p=(21, 9.65),    dir=(0, 1), w=3.6, h=5.6, shape='arch', depth=2.3),
    dict(id='p3',  p=(14.0, 16.4),  dir=(1, 0), w=3.6, h=5.6, shape='arch', depth=2.6),
    dict(id='p4',  p=(-9, 15),      dir=(1, 0), w=2.4, h=3.6, shape='moon', depth=0.9),
    dict(id='p5',  p=(-13, 8),      dir=(0, 1), w=2.6, h=3.4, shape='rect', depth=2.6),
    dict(id='p6',  p=(-21.5, -6),   dir=(0, 1), w=2.8, h=3.6, shape='rect', depth=0.9),
    dict(id='p7',  p=(-14.5, -6),   dir=(0, 1), w=3.0, h=4.4, shape='rect', depth=0.9),
    dict(id='p8',  p=(-16.4, -18.3), dir=(0.992, 0.129), w=2.8, h=3.6, shape='rect', depth=0.9),
    dict(id='p9',  p=(-11, -18.8),  dir=(1, 0), w=4.0, h=5.0, shape='rect', depth=0.9),
    dict(id='p9b', p=(-11, -9.0),   dir=(1, 0), w=3.2, h=4.4, shape='rect', depth=0.9),
]

ROOMS = {}


def room(name, num, title, pts, ceil, edges=None, wall='plaster', floor='floor', ceilmat='ceiling',
         sky=(), spawn=None, look=None):
    ROOMS[name] = dict(name=name, num=num, title=title, poly=[V2(p) for p in pts], ceil=ceil,
                       f=(lambda x, y, c=ceil: c[0] + c[1] * x + c[2] * y), edges=edges or {}, wall=wall,
                       floor=floor, ceilmat=ceilmat, sky=sky, spawn=spawn, look=look)


room('atrium', 0, 'Start / Finish', [FA, FB, CB, CA], (4.18, 0, -0.26),
     {0: dict(kind='glass', bays=7, tilt=1.3), 1: dict(mat='concrete'), 2: dict(kind='glass', bays=7, door=3),
      3: dict(mat='concrete')}, spawn=(-6.2, -18.9), look=(6, -17.2))
room('track', 1, 'On Your Marks', [FB, OB, E9, CC, CB], (5.68, 0.12, 0),
     {3: dict(kind='glass', bays=5, door=2)},
     sky=[[(15.7, -21.5), (17.3, -21.5), (17.3, 0.5), (15.7, 0.5)]], spawn=(17.5, -16.5), look=(24, -6))
room('north', 3, 'After the Line', [CD, CC, N13, N9], (9.52, 0, -0.19),
     {0: dict(kind='glass', bays=7, door=3)}, spawn=(8.5, 15.5), look=(1, 21))
room('dark', 4, 'After Hours', [D1, D2, D3, D4, D5], (4.2, 0, 0), wall='dark', floor='floor_dark',
     ceilmat='dark', spawn=(-12, 15), look=(-22, 16))
room('grads', 5, 'Class Of', [W6, CA, CD, W7], (2.6, -0.24, 0),
     {1: dict(kind='glass', bays=5, door=2), 3: dict(holes=[(0.8, 12.2, 5.3, 7.3)])},
     spawn=(-14, 3.2), look=(-24, 1.5))
room('screening', 6, 'Motion Pictures', [OA, S1, S2, W6], (5.0, 0, 0), wall='dark', floor='floor_dark',
     ceilmat='dark', spawn=(-20.6, -9.5), look=(-26, -13))
room('awards', 7, 'Accolades', [S1, FA, CA, S2], (4.18, 0, -0.26),
     sky=[[(-15.956, -17.84), (-13.377, -17.505), (-14.603, -8.081), (-17.181, -8.416)]], spawn=(-11.55, -10.85), look=(-17.28, -11.55))


def inset(P, d):
    out = []
    n = len(P)
    for i in range(n):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % n]
        d1, d2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((-d1.y, d1.x)), Vector((-d2.y, d2.x))
        a, b = p1 + n1 * d, p1 + n2 * d
        cr = d1.x * d2.y - d1.y * d2.x
        if abs(cr) < 1e-7:
            out.append(a)
        else:
            t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / cr
            out.append(a + d1 * t)
    return out


def edge(rn, i):
    I = ROOMS[rn]['inset']
    a, b = I[i], I[(i + 1) % len(I)]
    d = b - a
    L = d.length
    d = d / L
    return a, b, d, Vector((-d.y, d.x)), L


def profile(shape, w, h):
    if shape == 'rect':
        return [(-w / 2, 0), (-w / 2, h), (w / 2, h), (w / 2, 0)]
    if shape == 'moon':                      # a circle sitting on a chord of width w, height h
        r = (h * h + w * w / 4) / (2 * h)
        zc = h - r
        beta = math.asin(zc / r)
        return [(r * math.cos(math.pi + beta - k * (math.pi + 2 * beta) / 28), zc + r * math.sin(math.pi + beta - k * (math.pi + 2 * beta) / 28)) for k in range(29)]
    r = w / 2
    pts = [(-r, 0)]
    for k in range(13):
        th = math.pi - k * math.pi / 12
        pts.append((r * math.cos(th), h - r + r * math.sin(th)))
    pts.append((r, 0))
    return pts


def portal_cross(P, a, d, L):
    c, pd = V2(P['p']), V2(P['dir']).normalized()
    den = pd.x * d.y - pd.y * d.x
    if abs(den) < 0.3:
        return None
    s = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den
    u = ((a.x - c.x) * pd.y - (a.y - c.y) * pd.x) / den
    if abs(s) <= P['depth'] / 2 + 0.12 and P['w'] / 2 < u < L - P['w'] / 2:
        return u
    return None


def wall(mat, a, b, za, zb, nin, notches=(), holes=(), dens=1.0):
    d = b - a
    L = d.length
    d = d / L
    to3 = lambda u, z: Vector((a.x + d.x * u, a.y + d.y * u, z))
    out = [(0, 0)]
    for nt in sorted(notches, key=lambda k: k[0][0]):
        out += nt
    out += [(L, 0), (L, zb), (0, za)]
    return poly(mat, [to3(u, z) for u, z in out], V3(nin), holes=[[to3(u, z) for u, z in h] for h in holes], dens=dens)


def coll_edge(a, d, L, gaps, kind=0):
    u = 0.0
    for g0, g1 in sorted(gaps):
        if g0 > u:
            COLL.append(((a.x + d.x * u, a.y + d.y * u), (a.x + d.x * g0, a.y + d.y * g0), kind))
        u = g1
    if u < L:
        COLL.append(((a.x + d.x * u, a.y + d.y * u), (a.x + d.x * L, a.y + d.y * L), kind))


def glass_wall(rn, a, b, ta, tb, nin, bays, door=None, door_h=3.0):
    d = b - a
    L = d.length
    d = d / L
    d3, n3 = V3(d), V3(nin)
    bot = lambda u: Vector((a.x + d.x * u, a.y + d.y * u, 0))
    top = lambda u: ta.lerp(tb, u / L)
    at = lambda u, z: bot(u).lerp(top(u), z / top(u).z)
    gaps = []
    for k in range(bays + 1):
        u = L * k / bays
        beam('steel', bot(u), top(u), 0.09, 0.24, side=d3)
    beam('steel', bot(0) + Z * 0.04, bot(L) + Z * 0.04, 0.24, 0.08, side=n3)
    beam('steel', top(0) - Z * 0.05, top(L) - Z * 0.05, 0.24, 0.10, side=n3)
    beam('steel', at(0, door_h), at(L, door_h), 0.20, 0.07, side=n3)
    for k in range(bays):
        u0, u1 = L * k / bays, L * (k + 1) / bays
        z0 = door_h if k == door else 0.0
        GLASS.append(dict(room=rn, q=[at(u0, z0), at(u1, z0), top(u1), top(u0)]))
        if k == door:
            gaps.append((u0 + 0.1, u1 - 0.1))
            m = bot((u0 + u1) / 2)
            DOORS.append(dict(id='door_' + rn, c=V2((m.x, m.y)), d=-nin, w=u1 - u0 - 0.2, h=door_h, depth=0.6, rooms=[rn, 'court']))
            poly('steel', [m - d3 * (u1 - u0) / 2 - n3 * 0.3, m + d3 * (u1 - u0) / 2 - n3 * 0.3,
                           m + d3 * (u1 - u0) / 2 + n3 * 0.3, m - d3 * (u1 - u0) / 2 + n3 * 0.3], Z, dens=0.5)
            ISLANDS[-1].verts = [v + Z * 0.006 for v in ISLANDS[-1].verts]
    coll_edge(a, d, L, gaps, 1)


def build_room(R):
    name = CUR[0] = R['name']
    P, f = R['poly'], R['f']
    I = R['inset'] = inset(P, GAP)
    n = len(P)
    top = [Vector((p.x, p.y, f(p.x, p.y))) for p in I]
    # tilted glass pushes the ceiling edge outward
    for i in range(n):
        es = R['edges'].get(i, {})
        if es.get('tilt'):
            a, b, d, nin, L = edge(name, i)
            for j in (i, (i + 1) % n):
                q = I[j].copy()
                for _ in range(3):
                    off = es['tilt'] * f(q.x, q.y) / 10.0
                    q = I[j] - nin * off
                top[j] = Vector((q.x, q.y, f(q.x, q.y)))
    FLOORI[name] = poly(R['floor'], [V3(p) for p in I], Z)
    sky = [[Vector((x, y, f(x, y))) for x, y in s] for s in R['sky']]
    if not PLAN:
        poly(R['ceilmat'], top, -Z, holes=sky, dens=0.5)
    if not PLAN:
        poly('roof', [Vector((p.x, p.y, f(p.x, p.y) + 0.8)) for p in P], Z, holes=[[p + Z * 0.8 for p in s] for s in sky], baked=False)
    for s in sky:
        cen = sum(s, Vector()) / len(s)
        ring = s + [s[0]]
        strip('plaster', ring, [p + Z * 0.8 for p in ring], lambda pc, cen=cen: Vector((cen.x - pc.x, cen.y - pc.y, 0)), dens=0.5)
    for i in range(n):
        es = R['edges'].get(i, {})
        a, b, d, nin, L = edge(name, i)
        za, zb = f(a.x, a.y), f(b.x, b.y)
        pa, pb = P[i], P[(i + 1) % n]
        if es.get('kind') == 'glass':
            glass_wall(name, a, b, top[i], top[(i + 1) % n], nin, es['bays'], es.get('door'))
            if es.get('tilt'):
                wm = lambda j: R['edges'].get(j, {}).get('mat', R['wall'])
                poly(wm((i - 1) % n), [V3(a), V3(a, za), top[i]], V3(d))
                poly(wm((i + 1) % n), [V3(b), V3(b, zb), top[(i + 1) % n]], -V3(d))
            else:
                poly('ext', [V3(pa, f(*pa)), V3(pb, f(*pb)), V3(pb, f(*pb) + 0.8), V3(pa, f(*pa) + 0.8)], -V3(nin), baked=False)
            continue
        notches, gaps = [], []
        for Pt in PORTALS:
            u = portal_cross(Pt, a, d, L)
            if u is not None:
                notches.append([(u + s, z) for s, z in profile(Pt['shape'], Pt['w'], Pt['h'])])
                gaps.append((u - Pt['w'] / 2, u + Pt['w'] / 2))
        holes = [[(u0, z0), (u1, z0), (u1, z1), (u0, z1)] for u0, u1, z0, z1 in es.get('holes', [])]
        WALLI[(name, i)] = wall(es.get('mat', R['wall']), a, b, za, zb, nin, notches, holes)
        for u0, u1, z0, z1 in es.get('holes', []):
            at = lambda u, z: Vector((a.x + d.x * u, a.y + d.y * u, z)) - V3(nin) * 0.12
            GLASS.append(dict(room=name, q=[at(u0, z0), at(u1, z0), at(u1, z1), at(u0, z1)]))
            k = max(2, round((u1 - u0) / 2.2))
            for j in range(k + 1):
                uu = u0 + (u1 - u0) * j / k
                beam('steel', at(uu, z0), at(uu, z1), 0.07, 0.2, side=V3(d))
            # reveal around the opening
            ring = [at(u0, z0) + V3(nin) * 0.12, at(u1, z0) + V3(nin) * 0.12, at(u1, z1) + V3(nin) * 0.12, at(u0, z1) + V3(nin) * 0.12]
            ring.append(ring[0])
            cen = at((u0 + u1) / 2, (z0 + z1) / 2)
            strip(es.get('mat', R['wall']), ring, [p - V3(nin) * 0.4 for p in ring], lambda pc, cen=cen: cen - pc, dens=0.5)
        coll_edge(a, d, L, gaps)
        if not es.get('holes'):
            poly('ext', [V3(pa, 3.0), V3(pb, 3.0), V3(pb, f(*pb) + 0.8), V3(pa, f(*pa) + 0.8)], -V3(nin), baked=False)


def build_liner(P):
    CUR[0] = 'portal'
    c, d = V2(P['p']), V2(P['dir']).normalized()
    lat = Vector((-d.y, d.x))
    hd, t = P['depth'] / 2, 0.14
    W = lambda s, z, k: Vector((c.x + lat.x * s + d.x * k, c.y + lat.y * s + d.y * k, z))
    inner, outer = profile(P['shape'], P['w'], P['h']), profile(P['shape'], P['w'] + 2 * t, P['h'] + t)
    c3, d3 = Vector((c.x, c.y, P['h'] * 0.45)), V3(d)
    axis = lambda pc: (c3 + d3 * (pc - c3).dot(d3)) - pc
    strip('steel', [W(s, z, -hd) for s, z in inner], [W(s, z, hd) for s, z in inner], axis, dens=0.6)
    strip('steel', [W(s, z, -hd) for s, z in outer], [W(s, z, hd) for s, z in outer], lambda pc: -axis(pc), dens=0.4)
    for k, f in ((-hd, -d3), (hd, d3)):
        strip('steel', [W(s, z, k) for s, z in inner], [W(s, z, k) for s, z in outer], f, dens=0.5)
    w = P['w'] / 2
    isl = poly('steel', [W(-w, 0.006, -hd), W(w, 0.006, -hd), W(w, 0.006, hd), W(-w, 0.006, hd)], Z, dens=0.6)
    P['c'] = c
    P['d'] = d


def build_rotunda():
    CUR[0] = 'rotunda'
    c, r, H, N = V2(ROT_C), ROT_R, ROT_H, 96
    ops = [(-math.pi / 2, PORTALS[2]), (math.pi, PORTALS[3])]
    angs = set(round(k * 2 * math.pi / N, 6) for k in range(N))
    for th0, P in ops:
        da = math.asin((P['w'] / 2) / r)
        for k in range(-6, 7):
            angs.add(round((th0 + da * k / 6) % (2 * math.pi), 6))
    angs = sorted(angs)
    pt = lambda th, z: Vector((c.x + r * math.cos(th), c.y + r * math.sin(th), z))

    def zopen(th):
        for th0, P in ops:
            dth = (th - th0 + math.pi) % (2 * math.pi) - math.pi
            s = r * math.sin(dth)
            if abs(dth) < 1.0 and abs(s) < P['w'] / 2 - 1e-4:
                rr = P['w'] / 2
                return P['h'] - rr + math.sqrt(max(rr * rr - s * s, 0)), True
        return 0.0, False
    verts, tris, luvs = [], [], []
    M = len(angs)
    for k in range(M):
        t0, t1 = angs[k], angs[(k + 1) % M] + (2 * math.pi if k == M - 1 else 0)
        mid_open = zopen((t0 + t1) / 2)[1]
        z0 = zopen(t0 + 1e-5)[0] if mid_open else 0.0
        z1 = zopen(t1 - 1e-5)[0] if mid_open else 0.0
        o = len(verts)
        verts += [pt(t0, z0), pt(t1, z1), pt(t1, H), pt(t0, H)]
        luvs += [(r * t0, z0), (r * t1, z1), (r * t1, H), (r * t0, H)]
        tris += [(o, o + 1, o + 2), (o, o + 2, o + 3)]
        if not mid_open:
            COLL.append(((pt(t0, 0).x, pt(t0, 0).y), (pt(t1, 0).x, pt(t1, 0).y), 0))
    c3 = V3(c)
    tris = orient(verts, tris, lambda pc: Vector((c.x - pc.x, c.y - pc.y, 0)))
    ISLANDS.append(Island('concrete', verts, tris, luvs))
    ring = [pt(k * 2 * math.pi / N, 0) for k in range(N)]
    FLOORI['rotunda'] = poly('floor', ring, Z)
    oc = [Vector((c.x + 2.6 * math.cos(k * 2 * math.pi / 40), c.y + 2.6 * math.sin(k * 2 * math.pi / 40), H)) for k in range(40)]
    if PLAN:
        return rot_room(ring, H)
    poly('ceiling', [p + Z * H for p in ring], -Z, holes=[oc], dens=0.5)
    strip('plaster', oc + [oc[0]], [p + Z * 1.0 for p in oc + [oc[0]]], lambda pc: Vector((c.x - pc.x, c.y - pc.y, 0)), dens=0.5)
    out = [Vector((c.x + (r + 0.3) * math.cos(k * 2 * math.pi / 48), c.y + (r + 0.3) * math.sin(k * 2 * math.pi / 48), 4.0)) for k in range(49)]
    strip('ext', out, [Vector((p.x, p.y, H + 1.0)) for p in out], lambda pc: Vector((pc.x - c.x, pc.y - c.y, 0)), baked=False)
    poly('roof', [Vector((p.x, p.y, H + 1.0)) for p in out[:-1]], Z, holes=[[p + Z * 1.0 for p in oc]], baked=False)
    rot_room(ring, H)


def rot_room(ring, H):
    ROOMS['rotunda'] = dict(name='rotunda', num=2, title='The Moment', poly=[V2((p.x, p.y)) for p in ring[::4]],
                            spawn=(21, 12.2), look=(21, 22), f=lambda x, y: H)


# ----------------------------------------------------------------------------
# hanging, labels, props
# ----------------------------------------------------------------------------
PORTRAIT = {'dsc06236', 'dsc07728', 'bri2', 'bri3'}


def hang_at(pid, room, c, n, w, spot=0.35, ceil=6.0):
    """c = point on the wall surface (photo centre), n = wall normal into the room."""
    h = w / (1 / 1.5 if pid in PORTRAIT else 1.5)
    n3 = Vector((n.x, n.y, 0)).normalized()
    right = Z.cross(n3)
    obox('frame', c + n3 * 0.03, right, n3, Z, w / 2 + 0.035, 0.03, h / 2 + 0.035, baked=False)
    PHOTOS.append(dict(id=pid, room=room, p=c + n3 * 0.066, n=n3, w=w, h=h))
    if spot:
        sz = min(ceil - 0.5, c.z + 3.4)
        sp = Vector((c.x, c.y, sz)) + n3 * 2.6
        SPOTS.append((sp + (c - sp).normalized() * 0.27, c.copy(), spot, max(w, h)))
        beam('steel', sp + Z * 0.16 - right * (w / 2 + 0.6), sp + Z * 0.16 + right * (w / 2 + 0.6), 0.05, 0.05, baked=False)
        cyl('steel', sp + Z * 0.12, sp + (c - sp).normalized() * 0.22, 0.055, 0.07, 8)
    return c


def hang(pid, rn, e, u, zc, w, spot=0.35, cap=True):
    a, b, d, nin, L = edge(rn, e)
    R = ROOMS[rn]
    c = Vector((a.x + d.x * u, a.y + d.y * u, zc))
    h = w / (1 / 1.5 if pid in PORTRAIT else 1.5)
    # a small caption plaque at the lower right of every print
    right = Z.cross(V3(nin))
    side = right.x * d.x + right.y * d.y
    if cap:
        label('cap:' + pid, rn, e, u + side * (w / 2 + 0.26), max(zc - h / 2 + 0.1, 1.12), 0.36, 0.17, **({'glow': 1} if R['wall'] == 'dark' else {}))
    return hang_at(pid, rn, c, nin, w, spot, R['f'](c.x, c.y))


def label(lid, rn, e, u, zc, w, h, **kw):
    a, b, d, nin, L = edge(rn, e)
    c = Vector((a.x + d.x * u, a.y + d.y * u, zc)) + V3(nin) * 0.012
    LABELS.append(dict(id=lid, room=rn, p=c, n=V3(nin), w=w, h=h, isl=WALLI[(rn, e)], **kw))


def screen(sid, rn, e, u, zc, w):
    a, b, d, nin, L = edge(rn, e)
    h = w * 9 / 16
    n3 = V3(nin)
    c = Vector((a.x + d.x * u, a.y + d.y * u, zc))
    right = Z.cross(n3)
    obox('frame', c + n3 * 0.04, right, n3, Z, w / 2 + 0.05, 0.04, h / 2 + 0.05, baked=False)
    cc = c + n3 * 0.086
    EMIT.append([cc - right * w / 2 - Z * h / 2, cc + right * w / 2 - Z * h / 2, cc + right * w / 2 + Z * h / 2, cc - right * w / 2 + Z * h / 2])
    SCREENS.append(dict(id=sid, room=rn, p=cc, n=n3, w=w, h=h))


def fillet(pts, r, seg=8):
    pts = [V2(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        A, B, C = pts[i - 1], pts[i], pts[i + 1]
        d1, d2 = (A - B).normalized(), (C - B).normalized()
        th = d1.angle(d2)
        t = r / math.tan(th / 2)
        T1, T2 = B + d1 * t, B + d2 * t
        cen = B + (d1 + d2).normalized() * (r / math.sin(th / 2))
        a1 = math.atan2(T1.y - cen.y, T1.x - cen.x)
        a2 = math.atan2(T2.y - cen.y, T2.x - cen.x)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for k in range(seg + 1):
            a = a1 + da * k / seg
            out.append(Vector((cen.x + r * math.cos(a), cen.y + r * math.sin(a))))
    out.append(pts[-1])
    return out


def decal(mat, rn, pts, width, z=0.005):
    pts = [V2(p) for p in pts]
    L, Rr = [], []
    for i, p in enumerate(pts):
        d0 = (p - pts[i - 1]).normalized() if i > 0 else None
        d1 = (pts[i + 1] - p).normalized() if i < len(pts) - 1 else None
        d = ((d0 or d1) + (d1 or d0)).normalized()
        nrm = Vector((-d.y, d.x))
        k = 1.0 / max(0.5, nrm.dot(Vector((-(d0 or d1).y, (d0 or d1).x))))
        L.append(Vector((p.x + nrm.x * width / 2 * k, p.y + nrm.y * width / 2 * k, z)))
        Rr.append(Vector((p.x - nrm.x * width / 2 * k, p.y - nrm.y * width / 2 * k, z)))
    n = len(pts)
    tris = []
    for i in range(n - 1):
        tris += [(i, i + 1, n + i + 1), (i, n + i + 1, n + i)]
    verts = L + Rr
    DECALS.append(dict(mat=mat, room=rn, verts=verts, tris=orient(verts, tris, Z), isl=FLOORI[rn]))


def palm(x, y, h, lean, seed, room='ext'):
    CUR[0] = room
    rnd = random.Random(seed)
    segs = 7
    pts = []
    for k in range(segs + 1):
        t = k / segs
        pts.append(Vector((x + lean[0] * t * t, y + lean[1] * t * t, h * t)))
    for k in range(segs):
        r0 = 0.34 - 0.14 * (k / segs) + (0.1 if k == 0 else 0)
        r1 = 0.34 - 0.14 * ((k + 1) / segs)
        n = 8
        a = (pts[k + 1] - pts[k]).normalized()
        ex = basis(a)[0]
        ey = a.cross(ex)
        A = [pts[k] + (ex * math.cos(j * 2 * math.pi / n) + ey * math.sin(j * 2 * math.pi / n)) * r0 for j in range(n + 1)]
        B = [pts[k + 1] + (ex * math.cos(j * 2 * math.pi / n) + ey * math.sin(j * 2 * math.pi / n)) * r1 for j in range(n + 1)]
        strip('trunk', A, B, lambda pc, p=pts[k]: Vector((pc.x - p.x, pc.y - p.y, 0)), baked=False)
    COLL.extend([((x - .35, y - .35), (x + .35, y - .35), 2), ((x + .35, y - .35), (x + .35, y + .35), 2),
                 ((x + .35, y + .35), (x - .35, y + .35), 2), ((x - .35, y + .35), (x - .35, y - .35), 2)])
    topp = pts[-1]
    for k in range(30):
        az = rnd.uniform(0, 2 * math.pi)
        el = math.radians(rnd.uniform(-55, 78))
        dead = el < math.radians(-18)
        dirv = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        side = dirv.cross(Z).normalized()
        upv = side.cross(dirv)
        stem = rnd.uniform(0.9, 1.5)
        O = topp + dirv * stem
        R0 = rnd.uniform(1.25, 1.7) * (0.8 if dead else 1.0)
        verts, tris = [topp, O, O + side * 0.04], [(0, 1, 2)]
        for j in range(13):
            ph = math.radians(-78 + j * 13)
            for dph in (-0.055, 0.055):
                pp = ph + dph
                tip = O + (dirv * math.cos(pp) + side * math.sin(pp)) * R0 * (0.82 + 0.18 * math.cos(ph)) \
                    + upv * (0.18 * math.cos(ph * 1.2)) - Z * (0.35 * (1 - math.cos(ph)) + (0.5 if dead else 0.12))
                verts.append(tip)
            o = len(verts)
            tris.append((1, o - 2, o - 1))
        unbaked('leafdead' if dead else 'leaf', verts, tris)


def build_all():
    for R in list(ROOMS.values()):
        build_room(R)
    build_rotunda()
    for P in PORTALS:
        build_liner(P)

    # ---- courtyard: the infield
    CUR[0] = 'court'
    FLOORI['court'] = poly('grass', [V3(p) for p in (CA, CB, CC, CD)], Z)
    ROOMS['court'] = dict(name='court', num=8, title='The Infield', poly=[V2(p) for p in (CA, CB, CC, CD)], spawn=(1, 0.5), look=(2, 8), f=lambda x, y: 30)
    for a, b in (((0.0, -7.0), (2.03, 8.0)), ((-10.0, 0.5), (12.0, 0.5))):
        a, b = V2(a), V2(b)
        d = (b - a).normalized()
        nrm = Vector((-d.y, d.x))
        q = [a + nrm * 1.1, b + nrm * 1.1, b - nrm * 1.1, a - nrm * 1.1]
        poly('path', [V3(p, 0.03) for p in q], Z)
    box('concrete', 5.8, -3.6, 0, 0.32, 2.8, 0.8, rot=-12)
    ca, sa = math.cos(math.radians(-12)), math.sin(math.radians(-12))
    ring_c, ex = Vector((5.8, -3.6, 0.32 + 1.62)), Vector((ca, sa, 0))
    for k in range(40):                      # "The Lap": a red ring, visible from every room around the infield
        a0, a1 = k * 2 * math.pi / 40, (k + 1) * 2 * math.pi / 40
        p0 = ring_c + (ex * math.cos(a0) + Z * math.sin(a0)) * 1.55
        p1 = ring_c + (ex * math.cos(a1) + Z * math.sin(a1)) * 1.55
        cyl('baton', p0, p1, 0.1, 0.1, 10)
    for x, y, h, lean, s in ((-5.6, 3.0, 11.5, (0.5, 0.3), 3), (-3.6, -2.6, 13.5, (-0.6, 0.2), 4), (6.6, 4.2, 12.3, (0.4, -0.5), 5)):
        palm(x, y, h, lean, s, 'court')

    # ---- outside
    CUR[0] = 'ext'
    poly('plaza', [(-18, -36, 0), (18, -36, 0), (18, -22.6, 0), (11.2, -22.45, 0), (-11.2, -21.6, 0), (-18, -21.4, 0)], Z, dens=0.6)
    for x, y, h, lean, s in ((-9.4, -27.4, 13.0, (0.5, -0.4), 11), (-3.2, -28.6, 15.0, (-0.3, 0.3), 12),
                             (3.6, -27.2, 12.4, (0.6, 0.2), 13), (9.8, -28.9, 14.2, (-0.4, -0.3), 14),
                             (-15.5, -30, 13.5, (0.2, 0.4), 15), (15.4, -31, 15.5, (0.3, 0.2), 16)):
        palm(x, y, h, lean, s, 'ext')

    # ---- atrium: ceiling fins line up with the facade mullions; reception desk; start / finish
    CUR[0] = 'atrium'
    f = ROOMS['atrium']['f']
    for k in range(1, 7):
        x = -11 + 22 * k / 7
        y0, y1 = -21.9 - 0.04 * x, -7.15 - 0.09 * x
        beam('plaster', Vector((x, y0, f(x, y0) - 0.42)), Vector((x, y1, f(x, y1) - 0.42)), 0.26, 0.86, baked=True, dens=0.5)
    box('concrete', -7.3, -13.4, 0, 1.06, 1.0, 4.4)
    hang('start3', 'atrium', 3, 6.3, 1.8, 3.0, spot=0.35, cap=False)
    decal('lane', 'atrium', [(-10.5, -18.81), (10.5, -19.29)], 0.14)
    decal('line', 'atrium', [(-4.0, -17.2), (-4.0, -20.6)], 0.10)

    # ---- 01 track hall: the home straight
    CUR[0] = 'track'
    for pid, u in (('dsc00763', 4.0), ('dsc00858', 10.0), ('dsc00847', 16.0), ('dsc04620', 22.0), ('dsc02454', 28.0)):
        hang(pid, 'track', 1, u, 1.85, 3.6)
    hang('nocompetition', 'track', 0, 9.2, 2.45, 6.0, spot=0.6)
    decal('lane', 'track', fillet([(11.5, -19.3), (21, -19.3), (21, 8.5)], 3.0), 0.14)
    for y in (-11.5, 0.0):
        box('oak', 22.5, y, 0, 0.45, 0.62, 2.7)
    ft = ROOMS['track']['f']
    for k in range(10):                                  # baffles in the skylight: "hurdles of light"
        y = -19.4 + k * 2.2
        beam('plaster', Vector((15.7, y, ft(16.5, y) + 0.36)), Vector((17.3, y, ft(16.5, y) + 0.36)), 0.14, 0.86, baked=True, dens=0.4)

    # ---- 02 rotunda
    CUR[0] = 'rotunda'
    c = V2(ROT_C)
    for pid, ang in (('dsc00968', 45), ('relayanchor', 135), ('dsc01327-2', -135), ('dsc00626-2', -45)):
        a = math.radians(ang)
        n = Vector((-math.cos(a), -math.sin(a)))
        rr = ROT_R - 0.42
        hang_at(pid, 'rotunda', Vector((c.x + rr * math.cos(a), c.y + rr * math.sin(a), 1.9)), n, 3.6, spot=0.6, ceil=7.0)
        # stand-off panel so the flat print floats off the curved wall
        ex = Z.cross(V3(n))
        obox('frame', Vector((c.x + (rr + 0.2) * math.cos(a), c.y + (rr + 0.2) * math.sin(a), 1.9)), ex, V3(n), Z, 1.2, 0.2, 0.7, baked=False)
    box('concrete', c.x, c.y, 0, 0.5, 1.0, 1.0, rot=20)
    cyl('baton', Vector((c.x - 0.12, c.y, 0.5)), Vector((c.x + 0.22, c.y + 0.1, 2.25)), 0.085, 0.085, 16)
    arc = [(21, 10.6), (21, 12.9)] + [(c.x + 3.5 * math.cos(math.radians(a)), c.y + 3.5 * math.sin(math.radians(a))) for a in range(-80, 181, 10)] + [(15.2, 16.4)]
    decal('lane', 'rotunda', arc, 0.14)

    # ---- 03 north hall
    CUR[0] = 'north'
    for pid, u, w in (('dsc07721', 2.6, 3.0), ('dsc06236', 6.5, 2.0), ('dsc05438', 11.0, 4.5), ('dsc07728', 15.5, 2.0), ('dsc01498', 19.4, 3.0)):
        hang(pid, 'north', 2, u, 1.85, w)
    hang('dsc02884', 'north', 1, 2.8, 1.8, 3.0)
    hang('dsc03287', 'north', 3, 3.0, 1.8, 3.0)
    decal('lane', 'north', [(12.5, 16.4), (-8.5, 15.03)], 0.14)
    box('oak', 2.0, 12.6, 0, 0.45, 2.9, 0.62)

    # ---- 04 dark room
    CUR[0] = 'dark'
    hang('goldenboy', 'dark', 1, 4.5, 1.7, 3.0, spot=0.2)
    hang('finale', 'dark', 2, 4.0, 1.7, 3.0, spot=0.2)
    hang('starfield', 'dark', 3, 3.5, 1.7, 3.0, spot=0.2)
    hang('hunt', 'dark', 4, 3.6, 1.7, 3.0, spot=0.2)
    decal('lane', 'dark', fillet([(-9.5, 15), (-13, 15), (-13, 9.5)], 1.6), 0.14)

    # ---- 05 grads
    CUR[0] = 'grads'
    for pid, u in (('bri3', 6.35), ('bri4', 8.3), ('bri5', 10.55), ('bri1', 12.8), ('bri2', 14.75)):
        hang(pid, 'grads', 2, u, 1.65, 1.2 if pid in PORTRAIT else 1.8, spot=0.22)
    for k, pid in enumerate(('jesse5', 'jesse3', 'jesse4', 'jesse6', 'jesse1', 'jesse2', 'jesse7', 'jesse8')):
        hang(pid, 'grads', 3, 3.1 + (k % 4) * 2.25, 2.72 if k < 4 else 1.18, 1.9, spot=0.25 if k < 4 else 0, cap=False)
    decal('lane', 'grads', fillet([(-13, 6.5), (-13, 2.5), (-21.5, -2.5), (-21.5, -5.5)], 2.0), 0.14)
    box('oak', -19.6, 3.4, 0, 0.45, 0.62, 2.7)

    # ---- 06 screening room
    CUR[0] = 'screening'
    for k, u in enumerate((2.4, 5.8, 9.2, 12.6)):
        screen('film%d' % (k + 1), 'screening', 3, u, 1.8, 2.9)
    a, b, d, nin, L = edge('screening', 1)
    for t, (hh, dep) in enumerate(((1.35, 0.9), (0.9, 1.8), (0.45, 2.7))):
        u = 9.2
        cc = a + d * u + nin * (dep / 2)
        box('dark', cc.x, cc.y, 0, hh, 7.0, dep, rot=math.degrees(math.atan2(d.y, d.x)), solid=(t == 2))
    decal('lane', 'screening', fillet([(-21.5, -6.5), (-21.5, -18.75), (-16.95, -18.37)], 1.5), 0.14)

    # ---- 07 awards
    CUR[0] = 'awards'
    for y, hh in ((-12.45, 0.7), (-13.7, 1.0), (-14.95, 0.5)):
        box('concrete', -11.7, y, 0, hh, 1.2, 1.25)
    decal('lane', 'awards', [(-15.85, -18.25), (-11.5, -18.77)], 0.14)

    # ---- wall graphics (text is drawn by the site; these are the anchors)
    # Real galleries keep the walls quiet: one modest vinyl title per room, small plaques, nothing else.
    label('title', 'atrium', 1, 7.85, 1.72, 3.4, 0.62)
    label('t_track', 'track', 4, 6.7, 1.72, 3.6, 0.5)
    label('t_rotunda', 'track', 2, 11.9, 1.72, 3.6, 0.5)
    label('t_north', 'north', 1, 11.9, 1.72, 3.6, 0.5)
    label('t_dark', 'north', 3, 12.0, 1.72, 3.6, 0.5)
    label('t_grads', 'grads', 0, 7.25, 1.72, 3.0, 0.5)
    label('t_films', 'screening', 0, 5.0, 1.72, 3.6, 0.5, glow=1)
    label('t_awards', 'awards', 3, 2.2, 2.35, 3.6, 0.5)
    label('bri', 'grads', 2, 8.3, 2.72, 1.8, 0.16)
    label('jesse', 'grads', 3, 3.1, 3.58, 1.8, 0.16)
    for k in range(11):                      # accolades: a row of small engraved plates at eye level
        label('aw:%d' % k, 'awards', 3, 1.25 + k * 0.82, 1.56, 0.6, 0.34, action='awards')
    for k, s in enumerate(SCREENS):
        label('film%dcap' % (k + 1), 'screening', 3, (2.4, 5.8, 9.2, 12.6)[k] - 0.85, 0.8, 1.2, 0.2, glow=1)
    # things you can walk up to and use (no graphics, just a place to press E)
    LABELS.append(dict(id='contact', room='atrium', p=Vector((-7.3 + 0.512, -13.4, 0.75)), n=Vector((1, 0, 0)), w=4.4, h=1.5, isl=None, action='contact', ghost=1))
    a3, b3, d3, n3, L3 = edge('atrium', 3)
    LABELS.append(dict(id='about', room='atrium', p=Vector((a3.x + d3.x * 6.3, a3.y + d3.y * 6.3, 1.8)) + V3(n3) * 0.07, n=V3(n3), w=3.0, h=2.0, isl=None, action='about', ghost=1))


# ----------------------------------------------------------------------------
# packing
# ----------------------------------------------------------------------------
def pack():
    dens = 40.0
    while True:
        items = []
        for isl in ISLANDS:
            isl.scale = dens * isl.dens
            w = int(math.ceil(isl.ext[0] * isl.scale)) + 2 * PAD
            h = int(math.ceil(isl.ext[1] * isl.scale)) + 2 * PAD
            w, h = (w + 7) // 8 * 8, (h + 7) // 8 * 8
            items.append((h, w, isl))
        items.sort(key=lambda t: (-t[0], -t[1]))
        x = y = rowh = 0
        ok = True
        free = []
        for h, w, isl in items:
            if w > REF:
                ok = False
                break
            if x + w > REF:
                y += rowh
                x = rowh = 0
            if rowh == 0:
                rowh = h
            isl.px, isl.py = x, y
            x += w
            if y + h > REF:
                ok = False
                break
        if ok:
            used = sum(h * w for h, w, _ in items) / REF / REF
            print('PACK density %.1f px/m, %d islands, rows end at %d, fill %.0f%%' % (dens, len(items), y + rowh, used * 100))
            return dens
        dens -= 1.0


# ----------------------------------------------------------------------------
# blender scene
# ----------------------------------------------------------------------------
def bmat(name, emit=None, glass=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if emit:
        sh = nt.nodes.new('ShaderNodeEmission')
        sh.inputs[0].default_value = (*emit[:3], 1)
        sh.inputs[1].default_value = emit[3]
    elif glass:
        sh = nt.nodes.new('ShaderNodeBsdfTransparent')
        sh.inputs[0].default_value = (0.9, 0.95, 0.93, 1)
    else:
        sh = nt.nodes.new('ShaderNodeBsdfDiffuse')
        sh.inputs[0].default_value = (*MATS[name], 1)
    nt.links.new(sh.outputs[0], out.inputs[0])
    return m


def mesh_obj(name, verts, tris, mats, midx, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], tris)
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', midx)
    if uvs is not None:
        uvl = me.uv_layers.new(name='lm')
        flat = []
        for t in tris:
            for i in t:
                flat += uvs[i]
        uvl.data.foreach_set('uv', flat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    pr = bpy.context.preferences.addons['cycles'].preferences
    pr.compute_device_type = 'METAL'
    pr.get_devices()
    for dv in pr.devices:
        dv.use = dv.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 6
    sc.cycles.sample_clamp_indirect = 12
    sc.cycles.use_denoising = True
    sc.cycles.use_adaptive_sampling = False
    names = sorted(MATS)
    bm = {n: bmat(n) for n in names}
    # baked
    verts, tris, uvs, midx = [], [], [], []
    for isl in ISLANDS:
        o = len(verts)
        verts += isl.verts
        uvs += [isl.luv_to_uv(u, v) for u, v in isl.luvs]
        tris += [(a + o, b + o, c + o) for a, b, c in isl.tris]
        midx += [names.index(isl.mat)] * len(isl.tris)
    baked = mesh_obj('Baked', verts, tris, [bm[n] for n in names], midx, uvs)
    # casters
    verts, tris, midx = [], [], []
    for (rn, mat), g in UNB.items():
        o = len(verts)
        verts += g['v']
        tris += [(a + o, b + o, c + o) for a, b, c in g['t']]
        midx += [names.index(mat)] * len(g['t'])
    verts += [Vector((-400, -400, -0.04)), Vector((400, -400, -0.04)), Vector((400, 400, -0.04)), Vector((-400, 400, -0.04))]
    tris += [(len(verts) - 4, len(verts) - 3, len(verts) - 2), (len(verts) - 4, len(verts) - 2, len(verts) - 1)]
    midx += [names.index('plaza')] * 2
    mesh_obj('Casters', verts, tris, [bm[n] for n in names], midx)
    # screens glow
    if EMIT:
        ev, et = [], []
        for q in EMIT:
            o = len(ev)
            ev += q
            et += [(o, o + 1, o + 2), (o, o + 2, o + 3)]
        mesh_obj('Screens', ev, et, [bmat('emit', emit=(0.75, 0.85, 1.0, 2.2))], [0] * len(et))
    # glass (look-dev renders only)
    gv, gt = [], []
    for g in GLASS:
        o = len(gv)
        gv += g['q']
        gt += [(o, o + 1, o + 2), (o, o + 2, o + 3)]
    gl = mesh_obj('Glass', gv, gt, [bmat('glass', glass=True)], [0] * len(gt))
    gl.hide_render = True
    # sun + sky
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 20.0
    sun.color = (1.0, 0.93, 0.82)
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = (-SUN_DIR).to_track_quat('Z', 'Y').to_euler()
    sc.collection.objects.link(so)
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.50, 0.68, 1.0, 1)
    bg.inputs[1].default_value = 1.3
    sc.world = w
    for i, (sp, tg, en, size) in enumerate(SPOTS):
        l = bpy.data.lights.new('Spot%d' % i, 'SPOT')
        l.energy = 900 * en
        l.color = (1.0, 0.95, 0.88)
        l.spot_size = min(math.radians(80), 2 * math.atan((size * 0.66) / (sp - tg).length))
        l.spot_blend = 0.55
        l.shadow_soft_size = 0.06
        o = bpy.data.objects.new('Spot%d' % i, l)
        o.location = sp
        o.rotation_euler = (sp - tg).to_track_quat('Z', 'Y').to_euler()
        sc.collection.objects.link(o)
    return baked, bm


def bake(baked, bm):
    sc = bpy.context.scene
    img = bpy.data.images.new('lm', RES, RES, alpha=False, float_buffer=True, is_data=True)
    for m in baked.data.materials:
        nd = m.node_tree.nodes.new('ShaderNodeTexImage')
        nd.image = img
        m.node_tree.nodes.active = nd
    bpy.context.view_layer.objects.active = baked
    for o in sc.objects:
        o.select_set(o == baked)
    sc.render.bake.margin = max(2, PAD * RES // REF)
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    print('BAKING %dpx @ %d spp ...' % (RES, SAMPLES))
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=sc.render.bake.margin, margin_type='EXTEND', use_clear=True)
    px = np.empty(RES * RES * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(RES, RES, 4)[::-1, :, :3].copy()        # row 0 = top (v = 1)
    np.save(os.path.join(OUT, 'lightmap_raw.npy'), px)
    px = denoise(px)
    np.save(os.path.join(OUT, 'lightmap.npy'), px)
    return px


def denoise(px, iters=2):
    """Firefly clamp + edge-preserving (bilateral) smoothing in texture space.
    Shadow edges are large jumps in log-luminance, so they survive."""
    mask = (px.sum(axis=2) > 1e-6).astype(np.float32)
    lum = px.mean(axis=2)
    stack = np.stack([np.roll(lum, (dy, dx), axis=(0, 1)) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    med = np.median(stack, axis=0)
    del stack
    hot = lum > med * 1.8 + 0.01
    px = np.where(hot[..., None], px * (med / np.maximum(lum, 1e-6))[..., None], px).astype(np.float32)
    print('DENOISE fireflies %d' % int(hot.sum()))
    for it in range(iters):
        ll = np.log(px.mean(axis=2) + 0.015)
        acc = np.zeros_like(px)
        ws = np.zeros(mask.shape, np.float32)
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                w = (math.exp(-(dx * dx + dy * dy) / (2 * 1.4 ** 2))
                     * np.exp(-((np.roll(ll, (dy, dx), axis=(0, 1)) - ll) ** 2) / (2 * 0.32 ** 2))
                     * np.roll(mask, (dy, dx), axis=(0, 1))).astype(np.float32)
                acc += np.roll(px, (dy, dx), axis=(0, 1)) * w[..., None]
                ws += w
        px = (acc / np.maximum(ws, 1e-6)[..., None] * mask[..., None]).astype(np.float32)
    return px


def sample_stats(px):
    """Mean baked light per material/room for calibration."""
    stats = {}
    for isl in ISLANDS:
        w = int(isl.ext[0] * isl.scale * RES / REF)
        h = int(isl.ext[1] * isl.scale * RES / REF)
        if w < 6 or h < 6:
            continue
        x0 = int((isl.px + PAD) * RES / REF) + 1
        y0 = int((isl.py + PAD) * RES / REF) + 1
        blk = px[RES - (y0 + h) + 1:RES - y0 - 1, x0:x0 + w - 2]
        if blk.size:
            lum = blk.mean(axis=2)
            stats.setdefault((isl.room, isl.mat), []).append((float(np.median(lum)), float(lum.max()), blk.size))
    for k in sorted(stats):
        v = stats[k]
        tot = sum(s for _, _, s in v)
        print('STAT %-22s median %.3f  max %.2f' % ('%s/%s' % k, sum(m * s for m, _, s in v) / tot, max(mx for _, mx, _ in v)))


# ----------------------------------------------------------------------------
# export
# ----------------------------------------------------------------------------
def T3(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def T2(p):
    return [round(p[0], 3), round(-p[1], 3)]


def export():
    Q = 500.0
    bufs, groups = [], []

    def pos16(vs):
        a = np.array([[v.x, v.z, -v.y] for v in vs], dtype=np.float64) * Q
        return np.clip(np.round(a), -32767, 32767).astype('<i2')

    def emit(key, verts, tris, uvs, baked):
        if not tris:
            return
        p = pos16(verts)
        idx = np.array(tris, dtype='<u4').reshape(-1)
        if uvs is not None:
            u = np.clip(np.round(np.array([[a, 1.0 - b] for a, b in uvs]) * 65535), 0, 65535).astype('<u2')
            comb = np.concatenate([p.view('<u2'), u], axis=1)
        else:
            comb = p.view('<u2')
        uniq, inv = np.unique(comb, axis=0, return_inverse=True)
        idx = inv.reshape(-1)[idx].astype('<u4')
        g = dict(key=key, verts=int(len(uniq)), tris=int(len(idx) // 3), lm=uvs is not None)
        bufs.append(uniq[:, :3].astype('<u2').tobytes())
        if uvs is not None:
            bufs.append(uniq[:, 3:].astype('<u2').tobytes())
        bufs.append(idx.tobytes())
        groups.append(g)

    by = {}
    for isl in ISLANDS:
        g = by.setdefault('%s|%s' % (isl.room, isl.mat), dict(v=[], t=[], u=[]))
        o = len(g['v'])
        g['v'] += isl.verts
        g['u'] += [isl.luv_to_uv(u, v) for u, v in isl.luvs]
        g['t'] += [(a + o, b + o, c + o) for a, b, c in isl.tris]
    for k in sorted(by):
        emit(k, by[k]['v'], by[k]['t'], by[k]['u'], True)
    dec = {}
    for dc in DECALS:
        g = dec.setdefault('%s|%s' % (dc['room'], dc['mat']), dict(v=[], t=[], u=[]))
        o = len(g['v'])
        g['v'] += dc['verts']
        g['u'] += [dc['isl'].uv(Vector((v.x, v.y, 0))) for v in dc['verts']]
        g['t'] += [(a + o, b + o, c + o) for a, b, c in dc['tris']]
    for k in sorted(dec):
        emit('decal:' + k, dec[k]['v'], dec[k]['t'], dec[k]['u'], True)
    for (rn, mat) in sorted(UNB):
        g = UNB[(rn, mat)]
        emit('unlit:%s|%s' % (rn, mat), g['v'], g['t'], None, False)
    head = json.dumps(dict(q=Q, groups=groups)).encode()
    head += b' ' * ((4 - len(head) % 4) % 4)
    os.makedirs(os.path.join(ROOT, 'public', 'gallery'), exist_ok=True)
    with open(os.path.join(ROOT, 'public', 'gallery', 'world.bin'), 'wb') as fh:
        fh.write(struct.pack('<I', len(head)))
        fh.write(head)
        for b in bufs:
            fh.write(b)
            fh.write(b'\0' * ((4 - len(b) % 4) % 4))
    print('WORLD verts %d tris %d groups %d' % (sum(g['verts'] for g in groups), sum(g['tris'] for g in groups), len(groups)))

    def quad_uv(l):
        right = Z.cross(l['n'])
        cs = [l['p'] - right * l['w'] / 2 - Z * l['h'] / 2, l['p'] + right * l['w'] / 2 - Z * l['h'] / 2,
              l['p'] + right * l['w'] / 2 + Z * l['h'] / 2, l['p'] - right * l['w'] / 2 + Z * l['h'] / 2]
        if l['isl'] is None:
            return None
        return [[round(a, 5), round(1 - b, 5)] for a, b in (l['isl'].uv(c) for c in cs)]

    def rooms_of(P):
        res = []
        for sgn in (-1, 1):
            q = P['c'] + P['d'] * sgn * (P['depth'] / 2 + 0.6)
            for R in ROOMS.values():
                if R['name'] != 'court' and inside(q, R['poly']):
                    res.append(R['name'])
                    break
            else:
                res.append(None)
        return res
    doors = []
    for g in GLASS:
        pass
    lay = dict(
        sun=T3(-SUN_DIR),
        mats={k: [round(c, 4) for c in v] for k, v in MATS.items()},
        rooms=[dict(id=R['name'], num=R['num'], title=R['title'], poly=[T2(p) for p in R['poly']],
                    spawn=T2(R['spawn']), look=T2(R['look'])) for R in sorted(ROOMS.values(), key=lambda r: r['num'])],
        portals=[dict(id=P['id'], p=T2(P['c']), d=T2(P['d']), w=P['w'], h=P['h'], depth=P['depth'], rooms=rooms_of(P)) for P in PORTALS]
        + [dict(id=D['id'], p=T2(D['c']), d=T2(D['d']), w=round(D['w'], 3), h=D['h'], depth=D['depth'], rooms=D['rooms']) for D in DOORS],
        coll=[[*T2(a), *T2(b), k] for a, b, k in COLL],
        photos=[dict(id=p['id'], room=p['room'], p=T3(p['p']), n=T3(p['n']), w=round(p['w'], 3), h=round(p['h'], 3)) for p in PHOTOS],
        screens=[dict(id=s['id'], room=s['room'], p=T3(s['p']), n=T3(s['n']), w=round(s['w'], 3), h=round(s['h'], 3)) for s in SCREENS],
        labels=[dict(id=l['id'], room=l['room'], p=T3(l['p']), n=T3(l['n']), w=l['w'], h=l['h'], uv=quad_uv(l),
                     **{k: l[k] for k in ('action', 'glow', 'ghost') if l.get(k)}) for l in LABELS],
        glass=[dict(room=g['room'], q=[T3(p) for p in g['q']]) for g in GLASS],
    )
    os.makedirs(os.path.join(ROOT, 'src', 'gallery'), exist_ok=True)
    with open(os.path.join(ROOT, 'src', 'gallery', 'layout.json'), 'w') as fh:
        json.dump(lay, fh, separators=(',', ':'))
    print('LAYOUT photos %d labels %d coll %d glass %d' % (len(PHOTOS), len(LABELS), len(COLL), len(GLASS)))


def inside(p, poly_):
    c = False
    n = len(poly_)
    for i in range(n):
        a, b = poly_[i], poly_[(i + 1) % n]
        if (a.y > p.y) != (b.y > p.y) and p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x:
            c = not c
    return c


def previews():
    sc = bpy.context.scene
    bpy.data.objects['Glass'].hide_render = False
    sc.cycles.samples = 96
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = -0.4
    cam = bpy.data.cameras.new('cam')
    cam.lens = 16
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    views = dict(atrium=((-6.2, -18.9, 1.65), (6, -17.2, 2.6)), track=((17.5, -18.5, 1.65), (22.5, 0, 2.8)),
                 rotunda=((21, 11.6, 1.65), (21, 22, 4.5)), north=((10, 14, 1.65), (-3, 19, 2.5)),
                 dark=((-11, 15, 1.65), (-22, 16, 1.9)), grads=((-12, 2.5, 1.65), (-24, 2.5, 2.6)),
                 screening=((-19.5, -8.5, 1.65), (-26, -14, 2.0)), awards=((-13, -8.5, 1.65), (-14.5, -19, 2.4)),
                 court=((1, -3, 1.65), (3, 10, 4.5)))
    only = arg('--views', '', str)
    for k, (p, t) in views.items():
        if only and k not in only.split(','):
            continue
        co.location = p
        co.rotation_euler = (Vector(p) - Vector(t)).to_track_quat('Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, 'preview_%s.png' % k)
        bpy.ops.render.render(write_still=True)
    if PLAN:
        cam.type = 'ORTHO'
        cam.ortho_scale = 70
        co.location = (1.5, 0.5, 60)
        co.rotation_euler = (0, 0, 0)
        sc.render.resolution_x, sc.render.resolution_y = 1400, 1200
        sc.render.filepath = os.path.join(OUT, 'preview_plan.png')
        bpy.ops.render.render(write_still=True)


build_all()
DENS = pack()
baked, bm = make_scene()
export()
if PREVIEW or PLAN:
    previews()
elif not NOBAKE:
    px = bake(baked, bm)
    sample_stats(px)
print('DONE')
