"""The artworks of the deck. Run:  python3 art/pieces.py [name ...]

Every piece is 2400 x 1654 px (the 900 x 620 slide at 2.67x), drawn as light
on the ink background, so they all share one visual language.
"""

import sys
import time
from pathlib import Path

import numpy as np

from engine import (BG, Canvas, CurlNoise, col, contour_lines, finish, gblur,
                    lerp, nebula, text_mask, vignette)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img"
import os
PREV = Path(os.environ.get("ART_PREVIEW", "/tmp/art_preview"))
W, H = 2400, 1654

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_I = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
DIDOT = "/System/Library/Fonts/Supplemental/Didot.ttc"
SYMBOLS = "/System/Library/Fonts/Apple Symbols.ttf"


def save(light, name, **kw):
    """Slide artworks have a transparent background, so the global backdrop
    shows through them; the backdrop itself is opaque (alpha=False)."""
    OUT.mkdir(exist_ok=True)
    PREV.mkdir(exist_ok=True)
    kw.setdefault("alpha", True)
    finish(light, OUT / f"{name}.webp", preview=PREV / f"{name}.jpg", **kw)


def gradient3(t, a, b, c):
    t = np.clip(t, 0, 1)
    lo = lerp(a, b, np.clip(t * 2, 0, 1))
    hi = lerp(b, c, np.clip(t * 2 - 1, 0, 1))
    return np.where((t < 0.5)[..., None], lo, hi)


def trace(cv, x, y, field, steps, h=0.8, keep=None):
    """Integrate particles through a velocity field; return the trajectories."""
    xs = np.empty((steps, x.size))
    ys = np.empty((steps, x.size))
    for i in range(steps):
        vx, vy = field(x, y)
        n = np.hypot(vx, vy) + 1e-9
        x = x + h * vx / n
        y = y + h * vy / n
        xs[i], ys[i] = x, y
    return xs, ys


# ---------------------------------------------------------------------------
# 1. Title: the residual stream flowing through the layers
# ---------------------------------------------------------------------------

def stream_field(rng, center, spread_pull=0.0007, amp=0.30):
    noise = CurlNoise(rng, K=9, scale=1 / 520, amp=amp, kmin=1.0, kmax=3.2)
    fine = CurlNoise(rng, K=9, scale=1 / 170, amp=0.16, kmin=1.0, kmax=2.5)

    def f(x, y):
        nx, ny = noise(x, y)
        fx, fy = fine(x, y)
        cy = center(x)
        return 1.0 + nx + fx, ny + fy + (cy - y) * spread_pull
    return f


def title():
    cv = Canvas(W, H, seed=3)
    rng = cv.rng
    center = lambda x: H * (0.70 + 0.05 * np.sin(x / W * 2 * np.pi * 0.9 + 0.6))
    field = stream_field(rng, center)
    n = 1500
    y0 = H * 0.70 + rng.normal(size=n) * H * 0.10
    x0 = rng.uniform(-300, -20, n)
    xs, ys = trace(cv, x0, y0, field, steps=3600, h=0.85)
    t = np.clip(xs / W, 0, 1)
    c = gradient3(t, col("teal"), col("violet"), col("gold"))
    bright = rng.lognormal(0, 0.7, n)[None, :, None] * 0.019
    cv.splat(xs, ys, (c * bright).reshape(-1, 3))
    light = cv.image()
    # the layers: faint vertical planes of light
    layers = np.zeros((H, W), np.float32)
    u = np.arange(W)[None, :]
    v = (np.arange(H)[:, None] / H)
    for k in range(8):
        xk = W * (0.14 + k * 0.105)
        prof = np.exp(-((u - xk) / 2.2) ** 2) * np.exp(-((v - 0.68) / 0.2) ** 2)
        layers += prof
    light += layers[None] * col("ivory")[:, None, None] * 0.05
    # sparks where strands cross a layer
    sp = Canvas(W, H, seed=4)
    for k in range(8):
        xk = W * (0.14 + k * 0.105)
        j = np.argmin(np.abs(xs - xk), axis=0)
        sel = rng.random(n) < 0.012
        for i in np.nonzero(sel)[0]:
            yy = ys[j[i], i]
            sp.dot(xk, yy, rng.uniform(1.2, 3), col("ivory") * rng.uniform(0.4, 1.0))
    light += sp.image() * 1.2
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.012, scale=1.6)
    save(light, "title", exposure=1.3, vig=vignette(W, H, inner=0.6, outer=0.98))




# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

import json

ANCHOR_FILE = Path(__file__).resolve().parent / "anchors.json"


def anchor(key, value):
    data = json.loads(ANCHOR_FILE.read_text()) if ANCHOR_FILE.exists() else {}
    data[key] = value
    ANCHOR_FILE.write_text(json.dumps(data, indent=1))


def grid_uv():
    u = np.arange(W, dtype=np.float32)[None, :]
    v = np.arange(H, dtype=np.float32)[:, None]
    return u, v


def seg_dist(p0, p1):
    u, v = grid_uv()
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    t = np.clip(((u - x0) * dx + (v - y0) * dy) / L2, 0, 1)
    return np.hypot(u - (x0 + t * dx), v - (y0 + t * dy)), t


def layer(mono, rgb):
    return mono[None].astype(np.float32) * np.asarray(rgb, np.float32)[:, None, None]


def stars(cv, x, y, r, rgb, k=48):
    """Vectorised soft stars: each star is k gaussian samples of radius r."""
    x = np.repeat(np.asarray(x, float), k)
    y = np.repeat(np.asarray(y, float), k)
    rr = np.repeat(np.asarray(r, float), k)
    rgb = np.asarray(rgb, float)
    if rgb.ndim == 1:
        rgb = np.broadcast_to(rgb, (len(x) // k, 3))
    e = np.repeat(rgb, k, axis=0) * (rr * rr * 6.0 / k)[:, None]
    off = cv.rng.normal(size=(len(x), 2)) * rr[:, None]
    cv.splat(x + off[:, 0], y + off[:, 1], e)


def hero_star(cx, cy, rgb, core=6.0, halo=60.0, spikes=420.0, k=1.0):
    u, v = grid_uv()
    d = np.hypot(u - cx, v - cy)
    m = np.exp(-(d / core) ** 2) * 3.0 + np.exp(-(d / halo) ** 2) * 0.35
    m += np.exp(-(d / (halo * 3)) ** 2) * 0.08
    sp = (np.exp(-((v - cy) / 1.4) ** 2) * np.exp(-np.abs(u - cx) / spikes) +
          np.exp(-((u - cx) / 1.4) ** 2) * np.exp(-np.abs(v - cy) / (spikes * 0.7)))
    m += sp * 0.9
    return layer(m * k, rgb)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def x_fade(x, a, b, lo=0.15):
    """Brightness ramp so that the text side of a slide stays quiet."""
    return lo + (1 - lo) * smooth((x - a) / (b - a))


# ---------------------------------------------------------------------------
# 2. Mechanistic interpretability: a lens that turns chaos into structure
# ---------------------------------------------------------------------------

def lens(seed=11, name="lens"):
    cv = Canvas(W, H, seed=seed)
    rng = cv.rng
    cx, cy, R = 0.69 * W, 0.50 * H, 0.36 * H
    turb = CurlNoise(rng, K=12, scale=1 / 260, amp=0.75, kmin=1, kmax=3.5)
    bands = cy + np.array([-0.56, -0.19, 0.19, 0.56]) * R
    bcol = np.stack([col("teal"), col("gold"), col("violet"), col("rose")])
    grey = col("blue", 0.55) * 0.6 + col("ivory", 0.4) * 0.4
    n, steps = 1700, 3600
    x = rng.uniform(-250, -5, n)
    y = rng.uniform(0.04 * H, 0.96 * H, n)
    jitter = rng.normal(size=n) * 0.045 * R
    b = -np.ones(n, int)
    XS = np.empty((steps, n)); YS = np.empty((steps, n)); WS = np.empty((steps, n))
    for i in range(steps):
        r = np.hypot(x - cx, y - cy)
        w = smooth((R - r) / (0.22 * R))
        new = (w > 0) & (b < 0)
        if new.any():
            b[new] = np.argmin(np.abs(y[new, None] - bands[None, :]), axis=1)
        tgt = np.where(b >= 0, bands[np.maximum(b, 0)] + jitter, y)
        vx, vy = turb(x, y)
        ux = (1 - w) * (1.0 + vx) + w * 1.0
        uy = (1 - w) * vy + w * (tgt - y) * 0.010
        nn = np.hypot(ux, uy) + 1e-9
        x = x + 0.85 * ux / nn
        y = y + 0.85 * uy / nn
        XS[i], YS[i], WS[i] = x, y, w
        if i % 400 == 0:
            b[(w == 0) & (x > cx + R)] = b[(w == 0) & (x > cx + R)]
    bc = bcol[np.maximum(b, 0)][None, :, :]
    c = lerp(np.broadcast_to(grey, bc.shape), bc, WS) if False else (
        grey[None, None, :] * (1 - WS[..., None]) + bc * WS[..., None])
    bright = (0.013 + 0.010 * WS) * x_fade(XS, 0.25 * W, 0.50 * W, 0.18)
    bright = bright * rng.lognormal(0, 0.5, n)[None, :]
    cv.splat(XS, YS, (c * bright[..., None]).reshape(-1, 3))
    light = cv.image()
    u, v = grid_uv()
    r = np.hypot(u - cx, v - cy)
    ring = np.exp(-((r - R) / 2.6) ** 2) * 0.55 + np.exp(-((r - R * 1.035) / 1.6) ** 2) * 0.18
    ang = np.arctan2(v - cy, u - cx)
    glint = np.exp(-((r - R * 0.93) / 9) ** 2) * np.exp(-((ang + 2.25) / 0.28) ** 2) * 0.25
    glass = smooth((R - r) / 40) * 0.025
    light += layer(ring + glint, col("ivory")) + layer(glass, col("cyan"))
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, name, exposure=1.4)


# ---------------------------------------------------------------------------
# 3. Concepts are directions: a cloud of activations and a beam through it
# ---------------------------------------------------------------------------

def directions():
    cv = Canvas(W, H, seed=21)
    rng = cv.rng
    cx, cy = 0.68 * W, 0.52 * H
    a = np.radians(-16)
    d = np.array([np.cos(a), np.sin(a)])
    nrm = np.array([-d[1], d[0]])
    n = 5200
    s = rng.normal(size=n) * 0.20 * W
    p = rng.normal(size=n) * 0.17 * H
    x = cx + s * d[0] + p * nrm[0]
    y = cy + s * d[1] + p * nrm[1]
    t = smooth(s / (0.5 * W) + 0.5)
    c = gradient3(t, col("teal"), col("ivory", 0.8), col("gold"))
    near = np.exp(-(p / (0.05 * H)) ** 2)
    rad = rng.lognormal(0.2, 0.45, n) * (1 + near * 0.8)
    en = (0.12 + 0.5 * near) * rng.lognormal(0, 0.5, n) * x_fade(x, 0.3 * W, 0.5 * W, 0.2)
    stars(cv, x, y, rad, c * en[:, None])
    light = cv.image()
    L = 0.46 * W
    dist, tt = seg_dist((cx - L * d[0], cy - L * d[1]), (cx + L * d[0], cy + L * d[1]))
    fade = np.sin(np.pi * tt) ** 0.7
    beam = (np.exp(-(dist / 2.0) ** 2) * 0.9 + np.exp(-(dist / 14) ** 2) * 0.12) * fade
    tcol = gradient3(tt, col("teal"), col("ivory"), col("gold"))
    light += beam[None] * np.moveaxis(tcol, -1, 0)
    tip = (cx + L * 0.86 * d[0], cy + L * 0.86 * d[1])
    light += hero_star(*tip, col("gold"), core=4, halo=36, spikes=160, k=0.8)
    anchor("directions_tip", [tip[0] / W, tip[1] / H])
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "directions", exposure=1.3)


# ---------------------------------------------------------------------------
# 4. Games: a chess knight in contour lines, an Othello board of light
# ---------------------------------------------------------------------------

def games():
    cv = Canvas(W, H, seed=31)
    rng = cv.rng
    m = text_mask(W, H, "♞", SYMBOLS, 800, 0.26 * W, 0.50 * H)
    bm = 0.55 * gblur(m, 8) + 0.45 * gblur(m, 48)
    lines = contour_lines(bm, np.linspace(0.05, 0.95, 18), width=1.1)
    lines *= smooth(bm * 8)  # only around/inside the shape
    light = layer(lines * 0.6, col("gold"))
    # Othello board in perspective
    bx0, by0 = 0.72 * W, 0.47 * H
    tilt = np.radians(57)
    f, D = 1250.0, 14.0

    def proj(X, Z):
        Y = Z * np.sin(tilt)
        Zc = Z * np.cos(tilt) + D
        return bx0 + f * X / Zc, by0 - f * Y / Zc

    q = np.linspace(-4, 4, 400)
    for k in range(9):
        e = k - 4
        w = 0.55 if k in (0, 8) else 0.3
        for X, Z in ((np.full_like(q, e), q), (q, np.full_like(q, e))):
            px_, py_ = proj(X, Z)
            cv.polyline(np.stack([px_, py_], 1), col("ivory") * w * 0.34)
    board = ["........",
             "...g....",
             "..gggt..",
             "..tgtt..",
             "..tgg...",
             "...ttg..",
             "....t...",
             "........"]
    th = np.linspace(0, 2 * np.pi, 160)
    for i, row in enumerate(board):
        for j, ch in enumerate(row):
            if ch == ".":
                continue
            X = j - 3.5
            Z = 3.5 - i
            c = col("teal") if ch == "t" else col("gold")
            for rr in (0.36, 0.30):
                px_, py_ = proj(X + rr * np.cos(th), Z + rr * np.sin(th))
                cv.polyline(np.stack([px_, py_], 1), c * 0.85)
            # filled glow
            k = 4000
            rr = 0.34 * np.sqrt(rng.random(k))
            aa = rng.uniform(0, 2 * np.pi, k)
            px_, py_ = proj(X + rr * np.cos(aa), Z + rr * np.sin(aa))
            cv.splat(px_, py_, c * 0.45 * 900 / k)
    light += cv.image()
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "games", exposure=1.3)


# ---------------------------------------------------------------------------
# 5. Sudoku: a grid of light, constraints flowing into one cell
# ---------------------------------------------------------------------------

def sudoku_board(rng):
    base = np.array([[(3 * (r % 3) + r // 3 + c) % 9 for c in range(9)] for r in range(9)])
    perm = rng.permutation(9) + 1
    sol = perm[base]
    return sol


def sudoku():
    cv = Canvas(W, H, seed=41)
    rng = np.random.default_rng(7)
    sol = sudoku_board(rng)
    tr, tc = 4, 3  # target cell (row 5, column 4)
    clues = np.zeros((9, 9), bool)
    clues[rng.random((9, 9)) < 0.30] = True
    clues[tr, tc] = False

    def cands():
        seen = set(sol[tr, clues[tr]]) | set(sol[clues[:, tc], tc])
        br, bc = 3 * (tr // 3), 3 * (tc // 3)
        seen |= set(sol[br:br + 3, bc:bc + 3][clues[br:br + 3, bc:bc + 3]])
        return set(range(1, 10)) - seen
    # make the target a naked single
    unit = [(tr, c) for c in range(9)] + [(r, tc) for r in range(9)] + \
           [(3 * (tr // 3) + a, 3 * (tc // 3) + b) for a in range(3) for b in range(3)]
    for (r, c) in unit:
        if len(cands()) == 1:
            break
        if (r, c) != (tr, tc) and sol[r, c] in cands() and sol[r, c] != sol[tr, tc]:
            clues[r, c] = True
    assert cands() == {sol[tr, tc]}, cands()
    S = 0.74 * H
    cx, cy = 0.70 * W, 0.50 * H
    x0, y0, cs = cx - S / 2, cy - S / 2, S / 9
    q = np.linspace(0, S, 800)
    for k in range(10):
        thick = k % 3 == 0
        for off in ((-1.2, 0, 1.2) if thick else (0,)):
            e = k * cs + off
            w = 0.08 if thick else 0.03
            cv.polyline(np.stack([x0 + np.full_like(q, e), y0 + q], 1), col("ivory") * w)
            cv.polyline(np.stack([x0 + q, y0 + np.full_like(q, e)], 1), col("ivory") * w)
    light = cv.image()
    # digits
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(im)
    font = ImageFont.truetype(DIDOT, int(cs * 0.62))
    hi = Image.new("L", (W, H), 0)
    dh = ImageDraw.Draw(hi)
    units = set(unit)
    for r in range(9):
        for c in range(9):
            if clues[r, c]:
                tgt = dh if (r, c) in units else dr
                tgt.text((x0 + (c + 0.5) * cs, y0 + (r + 0.53) * cs), str(sol[r, c]),
                         font=font, fill=255, anchor="mm")
    dm = np.asarray(im, np.float32) / 255
    dhm = np.asarray(hi, np.float32) / 255
    light += layer(dm * 0.5 + gblur(dm, 5) * 0.4, col("ivory"))
    light += layer(dhm * 0.7 + gblur(dhm, 6) * 0.6, col("teal"))
    # threads from the constraining clues into the target cell
    th = Canvas(W, H, seed=42)
    tx, ty = x0 + (tc + 0.5) * cs, y0 + (tr + 0.5) * cs
    for (r, c) in unit:
        if not clues[r, c]:
            continue
        sx, sy = x0 + (c + 0.5) * cs, y0 + (r + 0.5) * cs
        for _ in range(26):
            mx = (sx + tx) / 2 + rng.normal() * cs * 0.35
            my = (sy + ty) / 2 + rng.normal() * cs * 0.35
            t = np.linspace(0.12, 0.9, 120)[:, None]
            P = ((1 - t) ** 2) * np.array([sx, sy]) + 2 * (1 - t) * t * np.array([mx, my]) + t * t * np.array([tx, ty])
            cc = lerp(col("teal"), col("gold"), t[:, 0])
            th.polyline(P, cc * 0.07)
    light += th.image()
    light += hero_star(tx, ty, col("gold"), core=6, halo=cs * 0.32, spikes=cs * 0.6, k=0.7)
    u, v = grid_uv()
    sq = np.maximum(np.abs(u - tx), np.abs(v - ty))
    light += layer(np.exp(-((sq - cs * 0.42) / 2.0) ** 2) * 0.6, col("gold"))
    anchor("sudoku_cell", {"x": tx / W, "y": ty / H, "cell": cs / W, "digit": int(sol[tr, tc]),
                           "row": tr + 1, "col": tc + 1})
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "sudoku", exposure=1.3)


def cell_zoom():
    """Close-up of the target cell: eight candidates eliminated, one left."""
    cv = Canvas(W, H, seed=43)
    rng = cv.rng
    a = json.loads(ANCHOR_FILE.read_text())["sudoku_cell"]
    digit = a["digit"]
    cx, cy = 0.5 * W, 0.5 * H
    S = 0.62 * H
    u, v = grid_uv()
    sq = np.maximum(np.abs(u - cx), np.abs(v - cy))
    light = layer(np.exp(-((sq - S / 2) / 2.5) ** 2) * 0.5 + np.exp(-((sq - S / 2) / 30) ** 2) * 0.05,
                  col("gold"))
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(DIDOT, int(S / 3 * 0.55))
    dim = Image.new("L", (W, H), 0)
    hot = Image.new("L", (W, H), 0)
    for d in range(1, 10):
        r, c = (d - 1) // 3, (d - 1) % 3
        px_, py_ = cx + (c - 1) * S / 3, cy + (r - 1) * S / 3 + S * 0.01
        ImageDraw.Draw(hot if d == digit else dim).text((px_, py_), str(d), font=font, fill=255, anchor="mm")
        if d == digit:
            hx, hy = px_, py_
    dm = np.asarray(dim, np.float32) / 255
    hm = np.asarray(hot, np.float32) / 255
    light += layer(dm * 0.16 + gblur(dm, 4) * 0.1, col("blue") * 0.6 + col("ivory") * 0.4)
    light += layer(hm * 1.0 + gblur(hm, 8) * 1.2 + gblur(hm, 40) * 0.6, col("gold"))
    # elimination: faint coral strokes through the eight dead candidates
    for d in range(1, 10):
        if d == digit:
            continue
        r, c = (d - 1) // 3, (d - 1) % 3
        px_, py_ = cx + (c - 1) * S / 3, cy + (r - 1) * S / 3
        L = S / 3 * 0.30
        for _ in range(14):
            o = rng.normal(size=4) * 3
            cv.polyline(np.array([[px_ - L + o[0], py_ + L * 0.55 + o[1]],
                                  [px_ + L + o[2], py_ - L * 0.55 + o[3]]]), col("coral") * 0.035)
    # the neuron firing: rays from the surviving candidate
    k = 260
    ang = rng.uniform(0, 2 * np.pi, k)
    for aa in ang:
        L = rng.uniform(0.10, 0.34) * S
        t = np.linspace(0.05, 1, 200)
        wob = np.sin(t * rng.uniform(4, 9) + rng.uniform(0, 6)) * rng.uniform(4, 16) * t
        px_ = hx + np.cos(aa) * L * t - np.sin(aa) * wob
        py_ = hy + np.sin(aa) * L * t + np.cos(aa) * wob
        cc = lerp(col("gold"), col("amber") * 0.3, t)
        cv.polyline(np.stack([px_, py_], 1), cc * 0.025)
    light += cv.image()
    save(light, "cell_zoom", exposure=1.2)


# ---------------------------------------------------------------------------
# 6. The alignment problem: one stream, two destinations
# ---------------------------------------------------------------------------

def fork():
    cv = Canvas(W, H, seed=61)
    rng = cv.rng
    noise = CurlNoise(rng, K=9, scale=1 / 260, amp=0.28, kmin=1, kmax=3)
    star = np.array([0.86 * W, 0.27 * H])
    sink = np.array([0.90 * W, 0.80 * H])
    sx = 0.52 * W
    n, steps = 1300, 3400
    x = rng.uniform(-250, -5, n)
    y = 0.74 * H + rng.normal(size=n) * 0.07 * H
    branch = (rng.random(n) < 0.5)
    ox = rng.normal(size=n) * 0.02 * H
    oy = rng.normal(size=n) * 0.05 * H
    XS = np.empty((steps, n)); YS = np.empty((steps, n)); WS = np.empty((steps, n))
    for i in range(steps):
        nx, ny = noise(x, y)
        w = smooth((x - sx) / (0.12 * W))
        tx = np.where(branch, star[0], sink[0]) + ox * smooth((x - sx) / (0.25 * W)) * 0 + ox
        ty = np.where(branch, star[1], sink[1]) + oy
        dx, dy = tx - x, ty - y
        dn = np.hypot(dx, dy) + 1e-6
        ux = (1 - w) * (1 + nx) + w * (dx / dn + 0.4 * nx)
        uy = (1 - w) * (ny + (0.74 * H - y) * 0.004) + w * (dy / dn + 0.4 * ny)
        nn = np.hypot(ux, uy) + 1e-9
        x = x + 0.85 * ux / nn
        y = y + 0.85 * uy / nn
        XS[i], YS[i], WS[i] = x, y, w
    base = lerp(col("teal"), col("ivory", 0.8), 0.3)
    tgt = np.where(branch[None, :, None], col("gold")[None, None], col("coral")[None, None])
    c = base[None, None] * (1 - WS[..., None]) + tgt * WS[..., None]
    dstar = np.hypot(XS - np.where(branch, star[0], sink[0])[None], YS - np.where(branch, star[1], sink[1])[None])
    alive = smooth(dstar / 140)
    bright = 0.010 * rng.lognormal(0, 0.5, n)[None] * x_fade(XS, 0.12 * W, 0.42 * W, 0.25) * alive
    cv.splat(XS, YS, (c * bright[..., None]).reshape(-1, 3))
    light = cv.image()
    light += hero_star(*star, col("gold"), core=6, halo=50, spikes=110, k=1.0)
    light += hero_star(*sink, col("coral"), core=10, halo=80, spikes=1, k=0.6)
    anchor("fork_star", [star[0] / W, star[1] / H])
    anchor("fork_sink", [sink[0] / W, sink[1] / H])
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "fork", exposure=1.3)


# ---------------------------------------------------------------------------
# 7. Helpful, Honest, Harmless: three woven rings of light
# ---------------------------------------------------------------------------

def rings():
    """Helpful, Honest, Harmless: three strands braided into one rope of light."""
    cv = Canvas(W, H, seed=71)
    rng = cv.rng
    cy = 0.52 * H
    A = 0.13 * H
    X = np.linspace(0.40 * W, 1.02 * W, 4200)
    om = 2 * np.pi / (0.27 * W)
    env = smooth((X - 0.43 * W) / (0.20 * W))
    fadein = smooth((X - 0.40 * W) / (0.10 * W))
    names = [("helpful", "gold"), ("honest", "teal"), ("harmless", "rose")]
    for k, (key, cname) in enumerate(names):
        ph = 2 * np.pi * k / 3
        y = cy + A * np.sin(om * X + ph) * env
        z = np.sin(2 * (om * X + ph))  # depth: which strand is on top at a crossing
        depth = 0.35 + 0.65 * (z + 1) / 2
        for _ in range(160):
            off = rng.normal() * 0.022 * H * (0.6 + 0.4 * env)
            wob = rng.uniform(2, 8) * np.sin(om * X * rng.uniform(2, 5) + rng.uniform(0, 6.3))
            P = np.stack([X, y + off + wob], 1)
            cv.polyline(P, col(cname)[None] * (depth * fadein * 0.024 * rng.lognormal(0, 0.4))[:, None])
        anchor(f"ring_{key}", [float(X[0] / W), float(y[0] / H)])
    light = cv.image()
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "rings", exposure=1.2)


# ---------------------------------------------------------------------------
# 8. Emergent misalignment: a narrow source that turns the whole stream
# ---------------------------------------------------------------------------

def contagion():
    cv = Canvas(W, H, seed=81)
    rng = cv.rng
    field = stream_field(rng, lambda x: H * 0.55, spread_pull=0.0, amp=0.22)
    n, steps = 1700, 3500
    x = rng.uniform(-250, -5, n)
    y = rng.uniform(0.08 * H, 0.96 * H, n)
    xs, ys = trace(cv, x, y, field, steps=steps, h=0.85)
    S = np.array([0.57 * W, 0.70 * H])
    spread = 0.03 * H + np.clip(xs - S[0], 0, None) * np.tan(np.radians(34))
    I = np.clip(1.3 - np.abs(ys - S[1]) / spread, 0, 1) ** 0.4 * smooth((xs - S[0]) / 160)
    I = np.maximum.accumulate(I, axis=0)  # once touched, a strand stays touched
    base = np.where((rng.random(n) < 0.5)[None, :, None], col("teal", 0.8)[None, None], col("gold", 0.75)[None, None])
    c = base * (1 - I[..., None]) + col("coral")[None, None] * I[..., None]
    bright = 0.010 * rng.lognormal(0, 0.5, n)[None] * x_fade(xs, 0.15 * W, 0.40 * W, 0.22)
    cv.splat(xs, ys, (c * bright[..., None]).reshape(-1, 3))
    # the source: a small tight knot
    t = np.linspace(0, 1, 3000)
    for _ in range(40):
        ph = rng.uniform(0, 6.3)
        rr = 26 * (1 - t) * (1 + 0.2 * rng.normal())
        P = np.stack([S[0] + rr * np.cos(t * 30 + ph), S[1] + rr * np.sin(t * 30 + ph)], 1)
        cv.polyline(P, col("coral") * 0.03)
    light = cv.image()
    light += hero_star(*S, col("coral"), core=6, halo=60, spikes=1, k=1.0)
    anchor("contagion_source", [S[0] / W, S[1] / H])
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "contagion", exposure=1.3)


# ---------------------------------------------------------------------------
# 9. Personas: masks drawn as contour lines
# ---------------------------------------------------------------------------

def mask_shape(cx, cy, s, rot=0.0, smile=0.0, brow=0.0, box=None):
    """Anti-aliased full-face mask (1 inside), in a local window. Returns (mask, (y0,y1,x0,x1))."""
    half = int(s * 0.95)
    x0, x1 = int(max(cx - half, 0)), int(min(cx + half, W))
    y0, y1 = int(max(cy - half, 0)), int(min(cy + half, H))
    u = (np.arange(x0, x1, dtype=np.float32)[None, :] - cx) / s
    v = (np.arange(y0, y1, dtype=np.float32)[:, None] - cy) / s
    cr, sr = np.cos(rot), np.sin(rot)
    X = cr * u + sr * v
    Y = -sr * u + cr * v
    aa = 1.5 / s
    wv = 0.47 * (1 - 0.30 * np.clip(Y, 0, None) / 0.7) * (1 - 0.05 * np.clip(-Y, 0, None) / 0.7)
    face = np.sqrt((X / wv) ** 2 + (Y / 0.70) ** 2) - 1
    m = smooth(0.5 - face / (aa * 4))
    for sgn in (-1, 1):
        ex, ey = sgn * 0.185, -0.10
        t = sgn * brow
        EX = np.cos(t) * (X - ex) + np.sin(t) * (Y - ey)
        EY = -np.sin(t) * (X - ex) + np.cos(t) * (Y - ey)
        eye = np.sqrt((EX / 0.115) ** 2 + (EY / (0.048 * (1 - (EX / 0.115) ** 2 * 0.3))) ** 2) - 1
        m = m * smooth(0.5 + eye / (aa * 8))
    my = 0.36 - smile * (X / 0.16) ** 2 * 0.06 + smile * 0.03
    mouth = np.maximum(np.abs(Y - my) - 0.016 * (1 - (X / 0.17) ** 2), np.abs(X) - 0.17)
    m = m * smooth(0.5 + mouth / (aa * 4))
    return m, (y0, y1, x0, x1)


def masks():
    light = np.zeros((3, H, W), np.float32)
    rng = np.random.default_rng(91)
    cast = [  # (u, v, size/H, rotation, smile, brow, colour, brightness)
        (0.50, 0.24, 0.17, -0.25, 1.0, 0.25, "teal", 0.40),
        (0.47, 0.74, 0.16, 0.20, -1.0, -0.3, "coral", 0.40),
        (0.92, 0.22, 0.16, 0.30, 0.0, -0.35, "violet", 0.40),
        (0.93, 0.76, 0.17, -0.18, 1.2, 0.0, "cyan", 0.40),
        (0.71, 0.50, 0.36, 0.0, 0.5, 0.0, "gold", 1.0),
    ]
    for (u, v, sz, rot, smile, brow, cname, br) in cast:
        s = sz * H
        m, (y0, y1, x0, x1) = mask_shape(u * W, v * H, s, rot, smile, brow)
        full = np.zeros((H, W), np.float32)
        full[y0:y1, x0:x1] = m
        if cname == "gold":
            # the main mask hides whatever is behind it
            light *= 1 - gblur(full, 6)[None] * 0.92
        bm = 0.5 * gblur(full, max(3.0, s * 0.012)) + 0.5 * gblur(full, max(8.0, s * 0.07))
        nl = 16 if s > 300 else 9
        lines = contour_lines(bm, np.linspace(0.08, 0.92, nl), width=1.05) * smooth(bm * 5)
        light += layer(lines * 0.5 * br + gblur(full, 2) * 0.03 * br, col(cname))
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.01, scale=1.6)
    save(light, "masks", exposure=1.3)


# ---------------------------------------------------------------------------
# 10/11. The Assistant Axis: a constellation of characters, and drift
# ---------------------------------------------------------------------------

AX_A = np.array([0.85 * W, 0.34 * H])  # the Assistant
AX_F = np.array([0.13 * W, 0.83 * H])  # the far, theatrical end

LABELS = [("consultant", 0.86), ("coach", 0.80), ("teacher", 0.73), ("detective", 0.56),
          ("pirate", 0.47), ("poet", 0.38), ("ghost", 0.20), ("oracle", 0.12), ("mystic", 0.05)]


def constellation_layer(cv, dim=1.0):
    rng = np.random.default_rng(51)
    d = (AX_A - AX_F) / np.linalg.norm(AX_A - AX_F)
    nrm = np.array([-d[1], d[0]])
    Lax = np.linalg.norm(AX_A - AX_F)
    n = 275
    s = np.clip(rng.beta(2.0, 1.6, n), 0.02, 0.97)
    p = rng.normal(size=n) * (0.035 + 0.07 * np.sin(np.pi * s)) * H
    P = AX_F[None] + s[:, None] * Lax * d[None] + p[:, None] * nrm[None]
    c = gradient3(s, col("violet"), col("cyan"), col("gold"))
    stars(cv, P[:, 0], P[:, 1], rng.lognormal(1.0, 0.3, n), c * 0.9 * dim, k=80)
    # dust
    m = 4500
    sd = rng.uniform(-0.1, 1.1, m)
    pd = rng.normal(size=m) * 0.16 * H
    Q = AX_F[None] + sd[:, None] * Lax * d[None] + pd[:, None] * nrm[None]
    cd = gradient3(np.clip(sd, 0, 1), col("violet"), col("blue"), col("gold"))
    stars(cv, Q[:, 0], Q[:, 1], rng.lognormal(0, 0.3, m), cd * 0.12 * dim, k=16)
    labels = {}
    used = set()
    for name, target in LABELS:
        cand = np.argsort(np.abs(s - target) + np.abs(p) / H * 0.6)
        i = next(j for j in cand if j not in used)
        used.add(i)
        labels[name] = [P[i, 0] / W, P[i, 1] / H]
        stars(cv, [P[i, 0]], [P[i, 1]], [2.6], c[i:i + 1] * 1.6 * dim, k=200)
    return d, nrm, Lax, labels


def axis_beam(d, Lax, k=1.0):
    p0 = AX_F - d * 0.06 * Lax
    p1 = AX_A + d * 0.04 * Lax
    dist, tt = seg_dist(p0, p1)
    beam = (np.exp(-(dist / 1.6) ** 2) * 0.5 + np.exp(-(dist / 16) ** 2) * 0.05) * np.sin(np.pi * tt) ** 0.5
    tcol = gradient3(tt, col("violet"), col("cyan"), col("gold"))
    return beam[None] * np.moveaxis(tcol, -1, 0) * k


def axis():
    cv = Canvas(W, H, seed=52)
    d, nrm, Lax, labels = constellation_layer(cv)
    light = cv.image() + axis_beam(d, Lax)
    light += hero_star(*AX_A, col("gold"), core=7, halo=70, spikes=170, k=1.2)
    anchor("axis_labels", labels)
    anchor("axis_assistant", [AX_A[0] / W, AX_A[1] / H])
    light += nebula(W, H, np.random.default_rng(5), [col("blue"), col("violet")], strength=0.012, scale=1.6)
    save(light, "axis", exposure=1.3)


def catmull(P, k=60):
    P = np.vstack([P[0], P, P[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t = np.linspace(0, 1, k, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 +
                          (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2][None])
    return np.vstack(out)


def drift():
    cv = Canvas(W, H, seed=53)
    d, nrm, Lax, labels = constellation_layer(cv, dim=0.45)
    rng = np.random.default_rng(54)
    light = cv.image() + axis_beam(d, Lax, k=0.5)
    light += hero_star(*AX_A, col("gold"), core=7, halo=70, spikes=150, k=1.0)
    cap_s = 0.70
    # drifting conversation (coral): eight turns sliding down the axis
    s = np.array([1.0, 0.95, 0.9, 0.78, 0.66, 0.52, 0.40, 0.30, 0.22])
    p = np.array([0, 0.04, -0.03, 0.05, -0.02, 0.06, 0.0, -0.05, 0.03]) * H
    P = AX_F[None] + s[:, None] * Lax * d[None] + p[:, None] * nrm[None]
    tr = Canvas(W, H, seed=55)
    curve = catmull(P)
    for _ in range(24):
        jit = rng.normal(size=curve.shape) * 0.0 + rng.normal(size=2) * 2.5
        tr.polyline(curve + jit, col("coral") * 0.03)
    stars(tr, P[1:, 0], P[1:, 1], np.full(len(P) - 1, 5.0), np.tile(col("coral"), (len(P) - 1, 1)) * 1.5, k=300)
    # held conversation (gold): wanders, bounces on the cap
    s2 = np.array([1.0, 0.93, 0.86, 0.79, 0.73, 0.76, 0.82, 0.77, 0.84])
    p2 = np.array([0, -0.05, -0.02, -0.07, -0.04, -0.09, -0.06, -0.10, -0.07]) * H
    P2 = AX_F[None] + s2[:, None] * Lax * d[None] + p2[:, None] * nrm[None]
    curve2 = catmull(P2)
    for _ in range(24):
        tr.polyline(curve2 + rng.normal(size=2) * 2.5, col("gold") * 0.03)
    stars(tr, P2[1:, 0], P2[1:, 1], np.full(len(P2) - 1, 5.0), np.tile(col("gold"), (len(P2) - 1, 1)) * 1.5, k=300)
    light += tr.image()
    # the cap: a soft curtain across the axis
    C = AX_F + cap_s * Lax * d
    u, v = grid_uv()
    along = (u - C[0]) * d[0] + (v - C[1]) * d[1]
    across = (u - C[0]) * nrm[0] + (v - C[1]) * nrm[1]
    curtain = (np.exp(-(along / 1.6) ** 2) * 0.12 + np.exp(-(along / 30) ** 2) * 0.05) * np.exp(-(across / (0.16 * H)) ** 2)
    light += layer(curtain, col("ivory"))
    anchor("drift_cap", [C[0] / W, C[1] / H])
    anchor("drift_end", [P[-1, 0] / W, P[-1, 1] / H])
    light += nebula(W, H, np.random.default_rng(5), [col("blue"), col("violet")], strength=0.012, scale=1.6)
    save(light, "drift", exposure=1.3)


# ---------------------------------------------------------------------------
# 12. Sleep clinic: a night sky over brain waves
# ---------------------------------------------------------------------------

def sleep():
    cv = Canvas(W, H, seed=121)
    rng = cv.rng
    m = 1400
    x = rng.uniform(0, W, m)
    y = (rng.random(m) ** 1.6) * H * 0.62
    stars(cv, x, y, rng.lognormal(0, 0.35, m), np.tile(col("ivory"), (m, 1)) * rng.lognormal(-1.6, 0.7, m)[:, None], k=16)
    X = np.linspace(-40, W + 40, 5200)
    tt = X / W
    bands = [  # (centre v, colour, kind)
        (0.63, "violet", "alpha"), (0.71, "cyan", "spindle"), (0.79, "teal", "delta"),
        (0.87, "gold", "kcomplex"), (0.94, "blue", "delta")]
    for vc, cname, kind in bands:
        base = np.zeros_like(X)
        if kind == "alpha":
            base = 9 * np.sin(2 * np.pi * 34 * tt) * (0.6 + 0.4 * np.sin(2 * np.pi * 2.2 * tt))
        if kind == "spindle":
            env = sum(np.exp(-((tt - c0) / 0.035) ** 2) for c0 in (0.52, 0.71, 0.9))
            base = 6 * np.sin(2 * np.pi * 9 * tt) + 26 * env * np.sin(2 * np.pi * 70 * tt)
        if kind == "delta":
            base = 34 * np.sin(2 * np.pi * 3.2 * tt + 1) + 14 * np.sin(2 * np.pi * 5.1 * tt)
        if kind == "kcomplex":
            base = 8 * np.sin(2 * np.pi * 7 * tt)
            for c0 in (0.58, 0.81):
                base += -70 * np.exp(-((tt - c0) / 0.012) ** 2) + 40 * np.exp(-((tt - c0 - 0.025) / 0.016) ** 2)
        for _ in range(30):
            jit = rng.normal() * 5 + 4 * np.sin(2 * np.pi * rng.uniform(0.5, 1.5) * tt + rng.uniform(0, 6))
            Y = vc * H + base * (1 + 0.08 * rng.normal()) + jit
            P = np.stack([X, Y], 1)
            fade = x_fade(X, 0.0, 0.45 * W, 0.45)[:, None]
            cv.polyline(P, np.tile(col(cname), (len(X), 1)) * 0.035 * fade)
    light = cv.image()
    # crescent moon
    u, v = grid_uv()
    mx, my, r = 0.83 * W, 0.22 * H, 0.075 * H
    d1 = np.hypot(u - mx, v - my)
    d2 = np.hypot(u - mx - 0.38 * r, v - my + 0.22 * r)
    moon = smooth((r - d1) / 2.5) * smooth((d2 - r * 0.92) / 2.5)
    light += layer(moon * 0.9 + gblur(moon, 30) * 0.5, col("gold") * 0.8 + col("ivory") * 0.2)
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.014, scale=1.6)
    save(light, "sleep", exposure=1.3)


# ---------------------------------------------------------------------------
# 13. Finale: many threads gathered by one star
# ---------------------------------------------------------------------------

def finale():
    cv = Canvas(W, H, seed=131)
    rng = cv.rng
    sx, sy = 0.66 * W, 0.47 * H
    n = 900
    X = np.linspace(-30, W + 30, 3000)
    y0 = rng.uniform(0.02, 0.98, n) * H
    y1 = rng.uniform(0.0, 1.0, n) * H
    noise = CurlNoise(rng, K=8, scale=1 / 300, amp=1.0)
    for i in range(n):
        left = X < sx
        a = np.clip(X / sx, 0, 1)
        b = np.clip((X - sx) / (W - sx), 0, 1)
        Y = np.where(left, y0[i] + (sy - y0[i]) * a ** 1.8, sy + (y1[i] - sy) * b ** 1.4)
        ph1, ph2, f1 = rng.uniform(0, 6.3), rng.uniform(0, 6.3), rng.uniform(140, 320)
        Y = Y + (26 * np.sin(X / f1 + ph1) + 10 * np.sin(X / 70 + ph2)) * np.where(left, (1 - a), b)
        t = np.clip(X / W, 0, 1)
        c = gradient3(t, col("teal"), col("gold"), col("violet"))
        fade = x_fade(X, 0.05 * W, 0.40 * W, 0.25)[:, None]
        cv.polyline(np.stack([X, Y], 1), c * 0.010 * fade * rng.lognormal(0, 0.4))
    light = cv.image()
    light += hero_star(sx, sy, col("gold"), core=8, halo=80, spikes=200, k=1.3)
    anchor("finale_star", [sx / W, sy / H])
    light += nebula(W, H, rng, [col("blue"), col("violet")], strength=0.012, scale=1.6)
    save(light, "finale", exposure=1.2)


# ---------------------------------------------------------------------------
# The global backdrop: one image under the whole canvas
# ---------------------------------------------------------------------------
#
# Positions below are in canvas units and must match index.html: the centre
# of each section (part origin + (500, 360)), the title and the finale. The
# image covers BD_RECT and is placed there by #backdrop in css/style.css.

BD_RECT = (-2300, -3000, 10400, 6400)        # x0, y0, width, height
BD_K = 0.4                                   # image pixels per canvas unit
BD_TITLE, BD_FINALE = (2900, -1350), (2900, 1750)
BD_SECTIONS = [((500, 360), "teal", "cyan"),
               ((2900, 360), "coral", "rose"),
               ((5300, 360), "violet", "blue")]


def backdrop():
    x0, y0, bw, bh = BD_RECT
    Wb, Hb = int(bw * BD_K), int(bh * BD_K)
    cv = Canvas(Wb, Hb, seed=2026)
    rng = cv.rng
    P = lambda p: ((p[0] - x0) * BD_K, (p[1] - y0) * BD_K)
    u = np.arange(Wb, dtype=np.float32)[None, :]
    v = np.arange(Hb, dtype=np.float32)[:, None]

    # 1. a soft coloured glow under each section, gold under title and finale
    glow = np.zeros((3, Hb, Wb), np.float32)

    def blob(c, sx, sy, rgb, k):
        cx, cy = P(c)
        g = np.exp(-((u - cx) / (sx * BD_K)) ** 2 - ((v - cy) / (sy * BD_K)) ** 2)
        glow[:] += g[None] * rgb[:, None, None] * k

    for (c, c1, c2) in BD_SECTIONS:
        blob(c, 1400, 1000, col(c1), 0.11)
        blob((c[0] + 350, c[1] - 300), 700, 520, col(c2), 0.06)
    blob(BD_TITLE, 1200, 520, col("gold"), 0.045)
    blob(BD_FINALE, 1200, 520, col("gold"), 0.045)

    # 2. the stream: it leaves the title, splits into the three sections and
    #    joins again at the finale
    top = np.array([BD_TITLE[0], BD_TITLE[1] + 520.0])
    bot = np.array([BD_FINALE[0], BD_FINALE[1] - 520.0])
    for (c, c1, _), side in zip(BD_SECTIONS, (-1, 0, 1)):
        c = np.array(c, float)
        if side == 0:
            ctrl = np.array([top, c, bot])
        else:
            ctrl = np.array([top,
                             c + [-side * 250, -950],
                             c,
                             c + [-side * 250, 950],
                             bot])
        path = catmull(ctrl, k=220)
        d = np.gradient(path, axis=0)
        nrm = np.stack([-d[:, 1], d[:, 0]], 1) / (np.hypot(d[:, 0], d[:, 1])[:, None] + 1e-9)
        t = np.linspace(0, 1, len(path))
        spread = 110 + 460 * np.sin(np.pi * t) ** 1.2
        cmid = col(c1)
        cg = col("gold")
        w = np.clip(np.abs(t - 0.5) * 2.6 - 0.3, 0, 1)[:, None]  # gold at both ends
        colour = cmid * (1 - w) + cg * w
        for i in range(260):
            o = rng.normal() * 0.5
            ph, f = rng.uniform(0, 6.3), rng.uniform(5, 11)
            off = spread * (o + 0.10 * np.sin(f * np.pi * t + ph))
            pts = path + nrm * off[:, None]
            pp = np.stack(P(pts.T), 1)
            cv.polyline(pp, colour * 0.020 * rng.lognormal(0, 0.5))
    light = cv.image()

    # 3. star dust
    st = Canvas(Wb, Hb, seed=7)
    n = 2600
    sx, sy = rng.uniform(0, Wb, n), rng.uniform(0, Hb, n)
    tint = lerp(col("ivory"), col("cyan"), rng.random(n))
    stars(st, sx, sy, rng.uniform(0.6, 1.6, n), tint * rng.lognormal(-1.2, 0.8, n)[:, None])
    light += st.image() * 0.8

    light += glow
    finish(light, OUT / "backdrop.webp", exposure=1.0, bloom=(0.4, 0.5),
           vig=vignette(Wb, Hb, inner=0.45, outer=0.97), grain=0.0, quality=86,
           preview=PREV / "backdrop.jpg")


PIECES = {f.__name__: f for f in [title, lens, directions, games, sudoku, cell_zoom, fork,
                                  rings, contagion, masks, axis, drift, sleep, finale,
                                  backdrop]}

if __name__ == "__main__":
    names = sys.argv[1:] or list(PIECES)
    if names == ['lensseeds']:
        for sd in (11, 12, 13, 15, 16, 17):
            lens(sd, f'lens_{sd}')
        sys.exit()
    for nm in names:
        t0 = time.time()
        PIECES[nm]()
        print(f"{nm}: {time.time() - t0:.1f}s", flush=True)
