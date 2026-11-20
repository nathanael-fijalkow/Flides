"""Small generative-art engine for the deck.

Everything is drawn as light on a deep ink background: particles are traced
through smooth flow fields and splatted into an additive buffer, then
tone-mapped, bloomed and vignetted so that every image fades exactly to the
page background colour (the slides float seamlessly on the canvas).

Only numpy and Pillow are needed.
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG = np.array([11, 15, 29], dtype=np.float32) / 255.0  # #0b0f1d, same as the CSS

PAL = {
    "gold": (243, 184, 72),
    "amber": (255, 150, 60),
    "teal": (79, 209, 197),
    "cyan": (110, 190, 255),
    "coral": (255, 92, 84),
    "rose": (255, 120, 150),
    "violet": (157, 130, 255),
    "ivory": (239, 232, 218),
    "blue": (70, 110, 230),
}


def col(name, k=1.0):
    return np.array(PAL[name], dtype=np.float32) / 255.0 * k


def lerp(a, b, t):
    t = np.asarray(t, dtype=np.float32)[..., None]
    return a * (1 - t) + b * t


class Canvas:
    def __init__(self, W, H, seed=0):
        self.W, self.H = W, H
        self.acc = np.zeros((3, H * W), dtype=np.float64)
        self.rng = np.random.default_rng(seed)
        self._buf = []  # pending (x, y, rgb*w)
        self._n = 0

    # -- splatting -----------------------------------------------------------
    def splat(self, x, y, rgb):
        """x, y: (N,) pixel coords. rgb: (N,3) or (3,) light to deposit."""
        x = np.asarray(x, dtype=np.float64).ravel()
        y = np.asarray(y, dtype=np.float64).ravel()
        rgb = np.asarray(rgb, dtype=np.float64)
        if rgb.ndim == 1:
            rgb = np.broadcast_to(rgb, (x.size, 3))
        else:
            rgb = rgb.reshape(-1, 3)
        self._buf.append((x, y, rgb))
        self._n += x.size
        if self._n > 6_000_000:
            self.flush()

    def flush(self):
        if not self._buf:
            return
        x = np.concatenate([b[0] for b in self._buf])
        y = np.concatenate([b[1] for b in self._buf])
        rgb = np.concatenate([b[2] for b in self._buf])
        self._buf, self._n = [], 0
        W, H = self.W, self.H
        x0 = np.floor(x).astype(np.int64)
        y0 = np.floor(y).astype(np.int64)
        fx = x - x0
        fy = y - y0
        for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                          (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            xi = x0 + dx
            yi = y0 + dy
            m = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
            idx = yi[m] * W + xi[m]
            wm = w[m]
            for c in range(3):
                self.acc[c] += np.bincount(idx, weights=wm * rgb[m, c], minlength=H * W)

    def polyline(self, pts, rgb, density=1.0):
        """Draw a polyline (M,2) by resampling it at ~0.6 px."""
        pts = np.asarray(pts, dtype=np.float64)
        seg = np.diff(pts, axis=0)
        L = np.hypot(seg[:, 0], seg[:, 1])
        n = np.maximum(1, np.ceil(L / 0.6).astype(int))
        t = np.concatenate([np.arange(k) / k for k in n])
        i = np.repeat(np.arange(len(seg)), n)
        p = pts[i] + seg[i] * t[:, None]
        rgb = np.asarray(rgb, dtype=np.float64)
        if rgb.ndim == 2:  # per-vertex colour
            rgb = rgb[i] * (1 - t[:, None]) + rgb[np.minimum(i + 1, len(rgb) - 1)] * t[:, None]
        self.splat(p[:, 0], p[:, 1], rgb * density * 0.6)

    def dot(self, x, y, r, rgb, n=None):
        """A soft glowing disc made of random splats (gaussian profile)."""
        n = n or int(40 * r * r + 50)
        a = self.rng.normal(size=(n, 2)) * r
        self.splat(x + a[:, 0], y + a[:, 1], np.asarray(rgb) / n * r * r * 6)

    def image(self):
        self.flush()
        return self.acc.reshape(3, self.H, self.W).astype(np.float32)


# -- fields -----------------------------------------------------------------

class CurlNoise:
    """Divergence-free smooth field from a sum of random sinusoids."""

    def __init__(self, rng, K=10, scale=1.0, amp=1.0, kmin=1.0, kmax=4.0):
        ang = rng.uniform(0, 2 * np.pi, K)
        mag = rng.uniform(kmin, kmax, K) * scale
        self.kx = np.cos(ang) * mag
        self.ky = np.sin(ang) * mag
        self.ph = rng.uniform(0, 2 * np.pi, K)
        self.a = amp / mag  # keep velocities comparable across frequencies

    def psi(self, x, y):
        s = np.zeros_like(x)
        for kx, ky, ph, a in zip(self.kx, self.ky, self.ph, self.a):
            s += a * np.sin(kx * x + ky * y + ph)
        return s

    def __call__(self, x, y):
        vx = np.zeros_like(x)
        vy = np.zeros_like(x)
        for kx, ky, ph, a in zip(self.kx, self.ky, self.ph, self.a):
            c = a * np.cos(kx * x + ky * y + ph)
            vx += c * ky
            vy -= c * kx
        return vx, vy


# -- post-processing ----------------------------------------------------------

def gblur(img, s):
    """Gaussian blur of a (..., H, W) array via FFT."""
    H, W = img.shape[-2:]
    ky = np.fft.fftfreq(H)[:, None]
    kx = np.fft.rfftfreq(W)[None, :]
    G = np.exp(-2 * (np.pi * s) ** 2 * (kx ** 2 + ky ** 2))
    return np.fft.irfft2(np.fft.rfft2(img) * G, s=(H, W)).astype(np.float32)


def vignette(W, H, inner=0.80, outer=0.995, cx=0.5, cy=0.5, power=1.0):
    """1 in the middle, 0 at the border (rounded-rectangle shaped)."""
    u = (np.arange(W)[None, :] + 0.5) / W
    v = (np.arange(H)[:, None] + 0.5) / H
    dx = np.abs(u - cx) / max(cx, 1 - cx)
    dy = np.abs(v - cy) / max(cy, 1 - cy)
    d = (dx ** 6 + dy ** 6) ** (1 / 6)  # squircle distance
    m = np.clip((outer - d) / (outer - inner), 0, 1)
    m = m * m * (3 - 2 * m)
    return (m ** power).astype(np.float32)


def nebula(W, H, rng, colors, scale=3.0, strength=0.06, octaves=4):
    """Very soft, very large coloured glows, to give depth to the background."""
    out = np.zeros((3, H, W), dtype=np.float32)
    u = np.arange(W, dtype=np.float32)[None, :]
    v = np.arange(H, dtype=np.float32)[:, None]
    for c in colors:
        f = np.zeros((H, W), np.float32)
        for _ in range(4):
            x0, y0 = rng.uniform(0.1, 0.9) * W, rng.uniform(0.1, 0.9) * H
            r = rng.uniform(0.18, 0.35) * W
            f += rng.uniform(0.4, 1.0) * np.exp(-((u - x0) ** 2 + (v - y0) ** 2) / (2 * r * r))
        out += f[None] * np.asarray(c, dtype=np.float32)[:, None, None]
    return out * strength * 0.45


def finish(light, path, exposure=1.0, bloom=(0.55, 0.35), vig=None, extra=None,
           grain=0.012, quality=90, preview=None, alpha=False):
    """Tone-map an additive light buffer and write it over the ink background.

    With alpha=True the image is written with a transparent background
    instead: alpha is the brightest channel of the light, so the artwork can
    sit on any backdrop (over plain ink it looks the same as before)."""
    C, H, W = light.shape
    L = 1.0 - np.exp(-light * exposure)
    b1 = gblur(L, W / 400) * bloom[0]
    b2 = gblur(L, W / 60) * bloom[1]
    L = L + b1 + b2
    if extra is not None:
        L = L + extra
    if vig is None:
        vig = vignette(W, H)
    L = L * vig[None]
    L = np.clip(L, 0, None)
    L = 1.0 - np.exp(-L * 1.6)  # soft shoulder
    if alpha:
        a = L.max(axis=0)
        rgb = np.clip(L / np.maximum(a, 1e-4)[None], 0, 1)
        rgba = np.concatenate([rgb, a[None]], axis=0)
        arr = (rgba.transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8)
        im = Image.fromarray(arr, "RGBA")
        im.save(path, "WEBP", quality=quality, alpha_quality=100, method=6)
        if preview:
            flat = BG[:, None, None] + L * (1.0 - BG[:, None, None])
            pv = Image.fromarray((np.clip(flat, 0, 1).transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8))
            pv.resize((W // 2, H // 2), Image.LANCZOS).save(preview, "JPEG", quality=85)
        return im
    out = BG[:, None, None] + L * (1.0 - BG[:, None, None])
    rng = np.random.default_rng(1)
    out = out + rng.normal(size=out.shape).astype(np.float32) * grain * vig[None]
    out = np.clip(out, 0, 1)
    arr = (out.transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(arr)
    im.save(path, "WEBP", quality=quality, method=6)
    if preview:
        im.resize((W // 2, H // 2), Image.LANCZOS).save(preview, "JPEG", quality=85)
    return im


# -- masks and contour lines --------------------------------------------------

def text_mask(W, H, text, font_path, size, cx, cy, index=0):
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(font_path, size, index=index)
    d.text((cx, cy), text, font=f, fill=255, anchor="mm")
    return np.asarray(im, dtype=np.float32) / 255.0


def contour_lines(field, levels, width=1.0):
    """Anti-aliased iso-lines of a smooth scalar field (H,W)."""
    gy, gx = np.gradient(field)
    g = np.hypot(gx, gy) + 1e-6
    out = np.zeros_like(field)
    for L in levels:
        d = (field - L) / g
        out += np.exp(-(d / width) ** 2)
    return out
