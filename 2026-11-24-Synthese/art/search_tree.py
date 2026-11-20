"""Artwork for the Synthesis slide: a program search tree.

Same visual language as the Persona deck (art/engine.py): light on ink,
transparent background. The tree of candidate programs is drawn in faint
ivory and teal; one path from the root to a leaf, the program that meets the
specification, glows in gold.

Run:  python3 art/search_tree.py   ->  img/search_tree.webp
"""

from pathlib import Path

import numpy as np

from engine import Canvas, CurlNoise, col, finish, nebula, vignette

ROOT = Path(__file__).resolve().parent.parent
W, H = 1500, 900


def main():
    cv = Canvas(W, H, seed=11)
    rng = cv.rng

    # --- build a random tree, layer by layer -------------------------------
    depth = 6
    top, bottom = 90, H - 110
    levels = [[(W * 0.5, top, None)]]  # (x, y, parent index)
    for d in range(1, depth + 1):
        y = top + (bottom - top) * d / depth
        prev = levels[-1]
        layer = []
        for i, (px, py, _) in enumerate(prev):
            k = rng.choice([2, 3, 3, 4]) if d < 3 else rng.choice([1, 2, 2, 3])
            if d >= 4 and rng.random() < 0.25:
                k = 0  # pruned branch
            for _ in range(k):
                layer.append([px, y, i])
        if not layer:
            break
        # spread the layer evenly, keeping children near their parents
        layer.sort(key=lambda t: t[0])
        n = len(layer)
        margin = 70
        span = (W - 2 * margin) * min(1.0, 0.25 + 0.16 * d)
        xs = np.linspace(W / 2 - span / 2, W / 2 + span / 2, n) if n > 1 else np.array([W / 2])
        for t, x in zip(layer, xs):
            t[0] = 0.55 * x + 0.45 * t[0] + rng.normal() * 6
        levels.append([tuple(t) for t in layer])

    # --- pick the golden path: a deepest leaf ---------------------------------
    last = levels[-1]
    j = int(np.argmin([abs(x - W * 0.66) for x, _, _ in last]))
    gold_nodes = set()
    d = len(levels) - 1
    while d >= 0:
        gold_nodes.add((d, j))
        j = levels[d][j][2] if levels[d][j][2] is not None else 0
        d -= 1

    def edge(p, q, c, dens, wobble=0.0):
        t = np.linspace(0, 1, 60)[:, None]
        # a gentle S curve, like a cable hanging between two layers
        x = p[0] + (q[0] - p[0]) * (3 * t ** 2 - 2 * t ** 3)
        y = p[1] + (q[1] - p[1]) * t
        if wobble:
            x = x + wobble * np.sin(t * np.pi) * rng.normal()
        cv.polyline(np.hstack([x, y]), c, density=dens)

    ivory = col("ivory")
    teal = col("teal")
    gold = col("gold")
    amber = col("amber")

    # faint edges first
    for d in range(1, len(levels)):
        for j, (x, y, pi) in enumerate(levels[d]):
            px, py, _ = levels[d - 1][pi]
            on = (d, j) in gold_nodes and (d - 1, pi) in gold_nodes
            if on:
                continue
            fade = 1.0 - 0.10 * d
            c = ivory * 0.55 + teal * 0.45
            edge((px, py), (x, y), c, 0.38 * fade)

    # nodes
    for d, layer in enumerate(levels):
        for j, (x, y, _) in enumerate(layer):
            if (d, j) in gold_nodes:
                continue
            c = teal * 0.7 + ivory * 0.3
            cv.dot(x, y, 3.2, c * 0.9)
            cv.dot(x, y, 1.2, ivory * 0.6)

    # golden path, drawn several times with jitter for a thick glowing cable
    path = sorted(gold_nodes)
    pts = [levels[d][j][:2] for d, j in path]
    for _ in range(14):
        for a, b in zip(pts[:-1], pts[1:]):
            jitter = rng.normal(size=2) * 0.7
            edge(np.add(a, jitter), np.add(b, jitter), gold, 0.32)
    for k, (x, y) in enumerate(pts):
        cv.dot(x, y, 6.5, gold * 1.6)
        cv.dot(x, y, 2.2, col("ivory") * 1.2)

    # the found program: a bright star at the leaf
    lx, ly = pts[-1]
    cv.dot(lx, ly, 15, amber * 1.6, n=7000)
    cv.dot(lx, ly, 9, gold * 3.0, n=5000)
    for ang in np.linspace(0, np.pi, 4, endpoint=False):
        r = np.linspace(-70, 70, 400)
        w = np.exp(-(r / 38) ** 2)[:, None]
        cv.splat(lx + r * np.cos(ang), ly + r * np.sin(ang), gold[None] * w * 0.35)

    # dust drifting along a curl-noise field, for texture
    field = CurlNoise(rng, K=8, scale=1 / 260, amp=1.0)
    n = 2600
    x = rng.uniform(0, W, n)
    y = rng.uniform(0, H, n)
    for _ in range(26):
        vx, vy = field(x, y)
        x, y = x + 1.4 * vx, y + 1.4 * vy
        cv.splat(x, y, (teal * 0.5 + ivory * 0.5) * 0.010)
    stars = rng.uniform([0, 0], [W, H], size=(260, 2))
    for sx, sy in stars:
        cv.dot(sx, sy, rng.uniform(0.6, 1.4), ivory * rng.uniform(0.05, 0.25), n=30)

    light = cv.image()
    light += nebula(W, H, rng, [col("teal"), col("gold")], strength=0.022)
    vig = vignette(W, H, inner=0.62, outer=0.99)
    out = ROOT / "img" / "search_tree.webp"
    finish(light, out, exposure=1.25, vig=vig, alpha=True,
           preview="/tmp/search_tree_preview.jpg")
    print("wrote", out)


if __name__ == "__main__":
    main()
