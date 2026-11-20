"""Artworks for the Synthesis team slides, in the Persona deck style.

Light on ink, transparent background, 1500 x 900 px (shown at about 450 x 270).
Run:  python3 art/team_pieces.py [name ...]   ->  img/<name>.webp
"""

import sys
from pathlib import Path

import numpy as np

from engine import Canvas, CurlNoise, col, contour_lines, finish, gblur, nebula, vignette

ROOT = Path(__file__).resolve().parent.parent
W, H = 1500, 900
IV, TE, GO, AM, CO, VI, CY = (col(n) for n in ("ivory", "teal", "gold", "amber", "coral", "violet", "cyan"))


# ----------------------------------------------------------------- helpers

def curve(p, q, bend=0.0, n=80):
    """Quadratic curve from p to q, bent sideways by `bend` (fraction of length)."""
    p, q = np.asarray(p, float), np.asarray(q, float)
    m = (p + q) / 2
    d = q - p
    nrm = np.array([-d[1], d[0]])
    c = m + nrm * bend
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p + 2 * (1 - t) * t * c + t ** 2 * q


def thick(cv, pts, c, dens, k=6, j=0.6):
    """A glowing line: the same polyline drawn k times with jitter."""
    for _ in range(k):
        cv.polyline(pts + cv.rng.normal(size=2) * j, c, density=dens / k)


def node(cv, x, y, c, r=5.0, core=1.0):
    cv.dot(x, y, r, c * 1.4)
    cv.dot(x, y, r * 0.35, IV * core)


def star(cv, x, y, c, size=60, r=12):
    cv.dot(x, y, r, c * 2.0, n=5000)
    cv.dot(x, y, r * 0.4, IV * 1.6, n=2000)
    for ang in np.linspace(0, np.pi, 4, endpoint=False):
        s = np.linspace(-size, size, 300)
        w = np.exp(-(s / (size * 0.5)) ** 2)[:, None]
        cv.splat(x + s * np.cos(ang), y + s * np.sin(ang), c[None] * w * 0.3)


def dust(cv, n=2200, tint=None, k=0.010):
    rng = cv.rng
    field = CurlNoise(rng, K=8, scale=1 / 260, amp=1.0)
    x, y = rng.uniform(0, cv.W, n), rng.uniform(0, cv.H, n)
    c = (TE * 0.5 + IV * 0.5) if tint is None else tint
    for _ in range(24):
        vx, vy = field(x, y)
        x, y = x + 1.4 * vx, y + 1.4 * vy
        cv.splat(x, y, c * k)
    for sx, sy in rng.uniform([0, 0], [cv.W, cv.H], size=(220, 2)):
        cv.dot(sx, sy, rng.uniform(0.6, 1.4), IV * rng.uniform(0.05, 0.22), n=30)


def save(cv, name, tints=(TE, GO), exposure=1.25, extra=None):
    light = cv.image()
    light += nebula(W, H, cv.rng, list(tints), strength=0.02)
    if extra is not None:
        light += extra
    vig = vignette(W, H, inner=0.60, outer=0.99)
    finish(light, ROOT / "img" / f"{name}.webp", exposure=exposure, vig=vig, alpha=True,
           preview=f"/tmp/prev_{name}.jpg")
    print("wrote", name)


def layout(rng, n, box, min_d):
    """Poisson-ish random points in box=(x0,y0,x1,y1)."""
    pts = []
    tries = 0
    while len(pts) < n and tries < 20000:
        tries += 1
        p = rng.uniform(box[:2], box[2:])
        if all(np.hypot(*(p - q)) > min_d for q in pts):
            pts.append(p)
    return np.array(pts)


# ----------------------------------------------------------------- pieces

def strings():
    """Bathie: a text as rows of glyph-dots; a gold pattern found twice,
    once exactly and once with a mismatch (coral)."""
    cv = Canvas(W, H, seed=21)
    rng = cv.rng
    rows, cols = 7, 34
    x0, x1, y0, y1 = 150, 1350, 190, 720
    xs = np.linspace(x0, x1, cols)
    ys = np.linspace(y0, y1, rows)
    hits = {(2, 9): None, (4, 19): 2, (5, 4): 1}  # row, start col -> mismatch index
    L = 6
    lit = {}
    for (r, c0), mm in hits.items():
        for i in range(L):
            lit[(r, c0 + i)] = "bad" if i == mm else "ok"
    for r, y in enumerate(ys):
        for c, x in enumerate(xs):
            h = 6 + rng.integers(0, 3) * 5  # glyph height varies, like letters
            s = lit.get((r, c))
            if s is None:
                cv.polyline(np.array([[x, y - h], [x, y + 6]]), TE * 0.55 + IV * 0.45, density=0.9)
                cv.dot(x, y + 6, 2.2, IV * 0.7, n=60)
            else:
                cc = GO if s == "ok" else CO
                thick(cv, np.array([[x, y - h], [x, y + 6]]), cc, 1.6, k=5, j=0.5)
                cv.dot(x, y - 2, 9, cc * 0.8)
    # a bracket under each occurrence
    for (r, c0), mm in hits.items():
        a, b = xs[c0] - 12, xs[c0 + L - 1] + 12
        y = ys[r] + 26
        cc = GO if mm is None else GO * 0.6 + CO * 0.4
        thick(cv, np.array([[a, y - 8], [a, y], [b, y], [b, y - 8]]), cc, 1.2, k=4, j=0.4)
    # the pattern itself, floating on top
    px = np.linspace(560, 940, L)
    for i, x in enumerate(px):
        thick(cv, np.array([[x, 70], [x, 108]]), GO, 2.4, k=6, j=0.5)
    star(cv, 750, 89, GO, size=260, r=4)
    dust(cv, 1800)
    save(cv, "strings")


def network():
    """Paulevé: a Boolean network. Nodes are on (gold) or off (dim);
    activations in teal end with a dot, inhibitions in coral end with a bar."""
    cv = Canvas(W, H, seed=5)
    rng = cv.rng
    P = layout(rng, 13, (230, 140, 1270, 760), 190)
    state = rng.random(len(P)) < 0.45
    edges = set()
    for i, p in enumerate(P):
        d = np.hypot(*(P - p).T)
        for j in np.argsort(d)[1:4]:
            if rng.random() < 0.8:
                edges.add((i, int(j)))
    for i, j in edges:
        p, q = P[i], P[j]
        v = (q - p) / np.hypot(*(q - p))
        a, b = p + v * 24, q - v * 30
        inh = rng.random() < 0.33
        c = CO if inh else TE
        pts = curve(a, b, bend=0.12 * (1 if (i + j) % 2 else -1))
        cv.polyline(pts, c * 0.9, density=0.9)
        end = pts[-1]
        tang = pts[-1] - pts[-4]
        tang /= np.hypot(*tang)
        if inh:
            nrm = np.array([-tang[1], tang[0]])
            thick(cv, np.array([end - nrm * 12, end + nrm * 12]), c, 1.6, k=4, j=0.3)
        else:
            cv.dot(*end, 4.5, c * 1.5)
    for (x, y), on in zip(P, state):
        if on:
            cv.dot(x, y, 20, GO * 1.2, n=3000)
            node(cv, x, y, GO, r=9, core=1.4)
        else:
            # an empty ring
            t = np.linspace(0, 2 * np.pi, 120)
            ring = np.c_[x + 13 * np.cos(t), y + 13 * np.sin(t)]
            cv.polyline(ring, IV * 0.7, density=0.9)
    dust(cv, 1600)
    save(cv, "network", tints=(TE, CO))


def landscape():
    """Paulevé: a Waddington landscape seen from above. Cells roll into
    valleys (cell fates); the gold path is a reprogramming that crosses a ridge."""
    cv = Canvas(W, H, seed=8)
    u = np.arange(W)[None, :].astype(np.float32)
    v = np.arange(H)[:, None].astype(np.float32)
    basins = [(380, 560, 170, 1.0), (820, 300, 190, 1.1), (1150, 610, 160, 0.9), (700, 700, 120, 0.5)]
    f = np.zeros((H, W), np.float32)
    for bx, by, r, d in basins:
        f -= d * np.exp(-((u - bx) ** 2 + (v - by) ** 2) / (2 * r * r))
    f += 0.00000035 * ((u - 760) ** 2 + 1.6 * (v - 470) ** 2)
    lines = contour_lines(f, np.linspace(-1.05, 0.25, 22), width=1.0)
    colour = np.stack([TE * 0.6 + VI * 0.4] * 1)[0]
    extra = lines[None] * colour[:, None, None] * 0.55
    # basin glows
    for (bx, by, r, d), c in zip(basins, (TE, VI, CY, TE)):
        cv.dot(bx, by, 26, c * 0.7, n=3000)
    # trajectories: gradient descent from random starts
    gy, gx = np.gradient(gblur(f[None], 3)[0])
    rng = cv.rng

    def roll(x, y, steps=600, h=7000.0):
        out = []
        for _ in range(steps):
            xi, yi = int(np.clip(x, 0, W - 1)), int(np.clip(y, 0, H - 1))
            x, y = x - h * gx[yi, xi], y - h * gy[yi, xi]
            out.append((x, y))
        return np.array(out)

    for _ in range(26):
        x, y = rng.uniform(150, 1350), rng.uniform(120, 800)
        tr = roll(x, y)
        cv.polyline(tr[:220], IV * 0.5, density=0.35)
    # reprogramming: from basin 0 over the ridge into basin 1
    a, b = np.array([380, 560]), np.array([820, 300])
    path = curve(a, b, bend=-0.25, n=120)
    thick(cv, path, GO, 2.4, k=10, j=0.8)
    node(cv, *a, GO, r=8)
    star(cv, *b, GO, size=70, r=11)
    dust(cv, 1200)
    save(cv, "landscape", tints=(TE, VI), extra=extra)


def seeds():
    """Paulevé: seeds of a metabolic network. From a few gold seeds,
    the reachable metabolites light up in waves."""
    cv = Canvas(W, H, seed=14)
    rng = cv.rng
    P = layout(rng, 70, (120, 110, 1380, 790), 70)
    S = [int(np.argmin(np.hypot(*(P - c).T))) for c in ((470, 470), (1000, 380))]
    d = np.full(len(P), np.inf)
    parent = -np.ones(len(P), int)
    for s in S:
        d[s] = 0
    # BFS on a k-nearest-neighbour graph
    nbr = [np.argsort(np.hypot(*(P - p).T))[1:4] for p in P]
    frontier = list(S)
    while frontier:
        nxt = []
        for i in frontier:
            for j in nbr[i]:
                if d[j] == np.inf:
                    d[j] = d[i] + 1
                    parent[j] = i
                    nxt.append(j)
        frontier = nxt
    dmax = np.nanmax(np.where(np.isinf(d), np.nan, d))
    for j, i in enumerate(parent):
        if i >= 0:
            t = d[j] / dmax
            c = GO * (1 - t) + TE * t
            cv.polyline(curve(P[i], P[j], bend=0.1), c * (1.0 - 0.5 * t), density=0.9)
    for k, (x, y) in enumerate(P):
        if k in S:
            continue
        if np.isinf(d[k]):
            node(cv, x, y, IV * 0.25, r=3, core=0.2)
        else:
            t = d[k] / dmax
            node(cv, x, y, GO * (1 - t) + TE * t, r=5 - 2 * t, core=0.8)
    for s in S:
        star(cv, *P[s], GO, size=70, r=13)
        for r in (40, 70):
            t = np.linspace(0, 2 * np.pi, 200)
            cv.polyline(np.c_[P[s][0] + r * np.cos(t), P[s][1] + r * np.sin(t)], GO * 0.5, density=0.5)
    dust(cv, 1600)
    save(cv, "seeds")


def fixpoint():
    """Walukiewicz/Muscholl: a fixpoint. Orbits spiral in towards a gold
    point, with a few automaton states sitting on the spiral."""
    cv = Canvas(W, H, seed=2)
    rng = cv.rng
    cx, cy = 760, 460
    for k in range(5):
        ph = k * 2 * np.pi / 5
        t = np.linspace(0, 5.2 * np.pi, 1400)
        r = 380 * np.exp(-0.17 * t)
        pts = np.c_[cx + 1.35 * r * np.cos(t + ph), cy + r * np.sin(t + ph)]
        c = TE * 0.6 + IV * 0.4 if k else GO
        cv.polyline(pts, c * (1.4 if k == 0 else 0.7), density=0.8)
        for tt in (1.2, 3.0, 5.6, 8.6):
            i = int(tt / (5.2 * np.pi) * len(t))
            node(cv, *pts[i], GO if k == 0 else TE, r=6 if k == 0 else 4)
    # self-loops on two states, as in an automaton
    for (x, y) in ((cx + 1.35 * 380 * np.cos(0.0), cy), (cx - 300, cy - 210)):
        tt = np.linspace(0, 2 * np.pi, 160)
        cv.polyline(np.c_[x + 26 * np.cos(tt), y - 30 + 26 * np.sin(tt)], IV * 0.6, density=0.7)
    star(cv, cx, cy, GO, size=90, r=14)
    dust(cv, 1600)
    save(cv, "fixpoint")


def traces():
    """Walukiewicz/Muscholl: a distributed run. Four processes are
    horizontal timelines; messages are slanted arrows; one causal chain in gold."""
    cv = Canvas(W, H, seed=9)
    rng = cv.rng
    ys = np.array([200, 370, 540, 710])
    x0, x1 = 140, 1360
    for y in ys:
        cv.polyline(np.array([[x0, y], [x1, y]]), IV * 0.6, density=0.9)
        node(cv, x0 - 20, y, TE, r=8)
    msgs = []
    x = 200
    while x < 1250:
        a = rng.integers(0, 4)
        b = (a + rng.choice([-1, 1, 2])) % 4
        dx = rng.uniform(60, 130)
        msgs.append((x, a, x + dx, b))
        x += rng.uniform(55, 110)
    # pick a causal chain greedily
    chain = []
    cur_p, cur_x = 0, 0
    for m in msgs:
        if m[1] == cur_p and m[0] > cur_x:
            chain.append(m)
            cur_p, cur_x = m[3], m[2]
    for m in msgs:
        xa, a, xb, b = m
        on = m in chain
        c = GO if on else TE
        p, q = np.array([xa, ys[a]]), np.array([xb, ys[b]])
        if on:
            thick(cv, np.vstack([p, q]), c, 2.2, k=8, j=0.6)
        else:
            cv.polyline(np.vstack([p, q]), c * 0.8, density=0.8)
        node(cv, *p, c, r=5 if on else 3.5)
        cv.dot(*q, 6 if on else 4, c * 1.6)
    if chain:
        star(cv, chain[-1][2], ys[chain[-1][3]], GO, size=60, r=10)
    dust(cv, 1400)
    save(cv, "traces")


def clock():
    """Walukiewicz/Muscholl: time and data. Concentric dials with ticks,
    data values as beads on the rings, two clock hands."""
    cv = Canvas(W, H, seed=4)
    rng = cv.rng
    cx, cy = 750, 455
    for k, R in enumerate((120, 210, 300, 380)):
        t = np.linspace(0, 2 * np.pi, 600)
        cv.polyline(np.c_[cx + R * np.cos(t), cy + R * np.sin(t)], (TE * 0.6 + VI * 0.4) * (0.9 - 0.12 * k), density=0.8)
        nt = (12, 24, 36, 60)[k]
        for a in np.linspace(0, 2 * np.pi, nt, endpoint=False):
            l = 14 if k == 3 else 8
            cv.polyline(np.array([[cx + (R - l) * np.cos(a), cy + (R - l) * np.sin(a)],
                                  [cx + R * np.cos(a), cy + R * np.sin(a)]]), IV * 0.5, density=0.6)
        for a in rng.uniform(0, 2 * np.pi, 3 + k):
            c = (VI, CY, TE, GO)[rng.integers(0, 4)]
            node(cv, cx + R * np.cos(a), cy + R * np.sin(a), c, r=5)
    for a, R, c in ((-1.15, 330, GO), (0.55, 200, IV)):
        thick(cv, np.array([[cx, cy], [cx + R * np.cos(a), cy + R * np.sin(a)]]), c, 2.0, k=6, j=0.5)
    star(cv, cx, cy, GO, size=50, r=10)
    dust(cv, 1400, tint=VI * 0.5 + IV * 0.5)
    save(cv, "clock", tints=(VI, TE))


def graph2text():
    """Mille: data to text. A knowledge graph on the left; its triples flow
    to the right and become lines of text."""
    cv = Canvas(W, H, seed=31)
    rng = cv.rng
    P = layout(rng, 9, (140, 200, 560, 700), 110)
    E = [(i, int(j)) for i, p in enumerate(P) for j in np.argsort(np.hypot(*(P - p).T))[1:3]]
    for i, j in E:
        cv.polyline(curve(P[i], P[j], 0.08), TE * 0.9, density=0.9)
    for x, y in P:
        node(cv, x, y, TE, r=8)
    # text lines on the right
    lines_y = np.linspace(250, 650, 7)
    for k, y in enumerate(lines_y):
        x = 860
        end = 1360 - rng.uniform(0, 160) if k < 6 else 1100
        while x < end:
            w = rng.uniform(18, 70)
            c = GO if k in (2, 4) else IV * 0.8
            cv.polyline(np.array([[x, y], [x + w, y]]), c, density=1.4 if k in (2, 4) else 0.9)
            x += w + 14
    # flows from triples to the lines
    for k, (i, j) in enumerate(E[:7]):
        m = (P[i] + P[j]) / 2
        tgt = np.array([850, lines_y[k % 7]])
        pts = curve(m, tgt, bend=0.18 * (1 if k % 2 else -1), n=120)
        c = GO if k % 7 in (2, 4) else VI
        cv.polyline(pts, c * 0.55, density=0.6)
    star(cv, 700, 450, GO, size=60, r=7)
    dust(cv, 1500)
    save(cv, "graph2text", tints=(TE, VI))


def leaderboard():
    """Mille: shared tasks. Columns of light, one per system, measured
    against a common benchmark line."""
    cv = Canvas(W, H, seed=12)
    rng = cv.rng
    n = 14
    xs = np.linspace(220, 1280, n)
    hs = np.sort(rng.uniform(0.25, 0.92, n))[::-1]
    rng.shuffle(hs[3:])
    base = 760
    for k, (x, h) in enumerate(zip(xs, hs)):
        top = base - h * 560
        c = GO if k == 0 else (TE if k < 4 else IV * 0.7)
        m = 900
        yy = rng.uniform(top, base, m)
        xx = x + rng.normal(size=m) * 9
        cv.splat(xx, yy, c * 0.035)
        thick(cv, np.array([[x, base], [x, top]]), c, 0.9, k=3, j=0.6)
        cv.dot(x, top, 7 if k else 12, c * 1.6)
    cv.polyline(np.array([[160, base], [1340, base]]), IV * 0.8, density=1.0)
    yb = base - 0.6 * 560
    for x in np.arange(160, 1340, 22):
        cv.polyline(np.array([[x, yb], [x + 11, yb]]), CO * 0.8, density=0.7)
    star(cv, xs[0], base - hs[0] * 560, GO, size=60, r=8)
    dust(cv, 1400)
    save(cv, "leaderboard")


def taxonomy():
    """Mille: a taxonomy of quality criteria, drawn as a radial tree."""
    cv = Canvas(W, H, seed=17)
    rng = cv.rng
    cx, cy = 750, 450
    branches = 6
    cols = (TE, GO, VI, CY, CO, TE)
    for b in range(branches):
        a0 = b * 2 * np.pi / branches + 0.3
        c = cols[b]
        p1 = np.array([cx + 150 * np.cos(a0), cy + 150 * 0.75 * np.sin(a0)])
        cv.polyline(curve((cx, cy), p1, 0.1), c, density=1.0)
        node(cv, *p1, c, r=7)
        k2 = rng.integers(2, 4)
        for i in range(k2):
            a1 = a0 + (i - (k2 - 1) / 2) * 0.32
            p2 = np.array([cx + 290 * np.cos(a1), cy + 290 * 0.75 * np.sin(a1)])
            cv.polyline(curve(p1, p2, 0.12), c * 0.8, density=0.8)
            node(cv, *p2, c, r=5)
            k3 = rng.integers(2, 4)
            for j in range(k3):
                a2 = a1 + (j - (k3 - 1) / 2) * 0.12
                p3 = np.array([cx + 400 * np.cos(a2), cy + 400 * 0.75 * np.sin(a2)])
                cv.polyline(curve(p2, p3, 0.1), c * 0.55, density=0.6)
                node(cv, *p3, c * 0.8, r=3)
    star(cv, cx, cy, GO, size=70, r=12)
    dust(cv, 1400)
    save(cv, "taxonomy", tints=(VI, TE))


def arena():
    """Gimbert: a stochastic game. Circles and squares are the two players,
    diamonds are random moves that split into weighted branches."""
    cv = Canvas(W, H, seed=27)
    rng = cv.rng
    P = layout(rng, 11, (220, 150, 1280, 760), 210)
    kind = np.array((["max", "min", "rand", "max", "min", "max", "rand", "min", "max", "min", "rand"] * 2)[:len(P)])
    for i, p in enumerate(P):
        d = np.hypot(*(P - p).T)
        for j in np.argsort(d)[1:3]:
            q = P[j]
            v = (q - p) / np.hypot(*(q - p))
            pts = curve(p + v * 26, q - v * 30, bend=0.15)
            if kind[i] == "rand":
                cv.polyline(pts, VI * 0.9, density=0.7)
            else:
                cv.polyline(pts, TE * 0.85, density=0.8)
            cv.dot(*pts[-1], 4, (VI if kind[i] == "rand" else TE) * 1.5)
    # a strategy: a few edges in gold
    for i in range(0, len(P) - 1, 2):
        j = int(np.argsort(np.hypot(*(P - P[i]).T))[1])
        thick(cv, curve(P[i], P[j], 0.15)[8:-8], GO, 1.8, k=6, j=0.5)
    for (x, y), k in zip(P, kind):
        if k == "max":
            t = np.linspace(0, 2 * np.pi, 140)
            thick(cv, np.c_[x + 18 * np.cos(t), y + 18 * np.sin(t)], GO, 1.4, k=4, j=0.3)
            cv.dot(x, y, 14, GO * 0.6)
        elif k == "min":
            sq = np.array([[-17, -17], [17, -17], [17, 17], [-17, 17], [-17, -17]]) + [x, y]
            thick(cv, sq, TE, 1.4, k=4, j=0.3)
            cv.dot(x, y, 12, TE * 0.5)
        else:
            dm = np.array([[0, -20], [20, 0], [0, 20], [-20, 0], [0, -20]]) + [x, y]
            thick(cv, dm, VI, 1.4, k=4, j=0.3)
            cv.dot(x, y, 12, VI * 0.6)
    dust(cv, 1500)
    save(cv, "arena", tints=(TE, VI))


def matching():
    """Gimbert: Parcoursup as a matching. Candidates on the left, programmes
    on the right; faint lines are wishes, gold lines are admissions."""
    cv = Canvas(W, H, seed=33)
    rng = cv.rng
    L = np.c_[np.full(16, 330), np.linspace(140, 760, 16)]
    R = np.c_[np.full(7, 1170), np.linspace(190, 710, 7)]
    cap = np.array([3, 2, 3, 2, 2, 3, 1])
    taken = np.zeros(7, int)
    for i, p in enumerate(L):
        wishes = rng.choice(7, size=rng.integers(2, 5), replace=False)
        got = None
        for w in wishes:
            if got is None and taken[w] < cap[w] and rng.random() < 0.8:
                got = w
                taken[w] += 1
        for w in wishes:
            pts = curve(p, R[w], bend=0.0, n=60)
            t = np.linspace(0, 1, 60)[:, None]
            pts = np.c_[p[0] + (R[w][0] - p[0]) * t[:, 0], p[1] + (R[w][1] - p[1]) * (3 * t[:, 0] ** 2 - 2 * t[:, 0] ** 3)]
            if w == got:
                thick(cv, pts, GO, 1.8, k=6, j=0.5)
            else:
                cv.polyline(pts, TE * 0.45 + IV * 0.15, density=0.5)
        node(cv, *p, GO if got is not None else IV * 0.5, r=6)
    for (x, y), c in zip(R, cap):
        h = 18 + 10 * c
        box = np.array([[x - 14, y - h], [x + 14, y - h], [x + 14, y + h], [x - 14, y + h], [x - 14, y - h]])
        thick(cv, box, TE, 1.4, k=4, j=0.3)
        cv.dot(x, y, 16, TE * 0.6)
    dust(cv, 1300)
    save(cv, "matching")


def suggestions():
    """Gimbert/Bathie/Lagarde: MonProjetSup. A student at the centre; ranked
    suggestions fan out, the brightest are the best matches."""
    cv = Canvas(W, H, seed=40)
    rng = cv.rng
    cx, cy = 640, 470
    n = 26
    ang = np.linspace(-1.15, 1.15, n) + rng.normal(size=n) * 0.03
    score = np.clip(rng.beta(2, 3, n), 0.05, 1)
    score[[4, 12, 19]] = [0.95, 1.0, 0.9]
    for a, s in zip(ang, score):
        r = 300 + 380 * (1 - s) + rng.uniform(-30, 30)
        q = np.array([cx + r * np.cos(a), cy + r * np.sin(a) * 0.95])
        c = GO * s + TE * (1 - s)
        pts = curve((cx, cy), q, bend=0.06 * np.sign(a), n=100)
        if s > 0.85:
            thick(cv, pts, c, 1.6 * s, k=6, j=0.5)
            star(cv, *q, GO, size=34, r=6)
        else:
            cv.polyline(pts, c * (0.3 + 0.6 * s), density=0.6)
            node(cv, *q, c, r=3 + 4 * s, core=s)
    for r in (60, 110):
        t = np.linspace(0, 2 * np.pi, 220)
        cv.polyline(np.c_[cx + r * np.cos(t), cy + r * np.sin(t)], IV * 0.35, density=0.5)
    star(cv, cx, cy, IV * 0.6 + GO * 0.4, size=70, r=12)
    dust(cv, 1300)
    save(cv, "suggestions")


PIECES = {f.__name__: f for f in (strings, network, landscape, seeds, fixpoint, traces,
                                  clock, graph2text, leaderboard, taxonomy,
                                  arena, matching, suggestions)}

if __name__ == "__main__":
    for name in (sys.argv[1:] or PIECES):
        PIECES[name]()
