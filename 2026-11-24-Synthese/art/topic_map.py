"""Intro slide: a constellation of the topics of the Synthesis team.

Writes the artwork img/topics.webp AND the labels of the first slide of
index.html (between the map:start / map:end markers), from the same
coordinates, so labels always sit on their stars. Edit TOPICS / PEOPLE and rerun:
    python3 art/topic_map.py
Coordinates are in slide pixels (1600 x 900).
"""

import html
from pathlib import Path

import numpy as np

from engine import Canvas, col, finish, nebula, vignette
from team_pieces import curve, dust, node, star, thick

ROOT = Path(__file__).resolve().parent.parent
S = 1.5                     # artwork pixels per slide pixel
Y0 = 250                    # the artwork covers the slide from y = Y0 down
W, H = int(1600 * S), int((900 - Y0) * S)
CENTER = (800, 585)

# key: (label, subtitle, colour, x, y, label side)
TOPICS = {
    "P": ("Programmes", "synthèse, génération de code", "gold", 640, 352, "above"),
    "A": ("Apprentissage", "réseaux de neurones, interprétabilité", "cyan", 330, 470, "left"),
    "L": ("Langue naturelle", "génération de texte, évaluation", "rose", 250, 712, "below"),
    "V": ("Modèles du vivant", "réseaux booléens, biologie, écologie", "teal", 560, 755, "below"),
    "R": ("Contrôleurs", "systèmes réactifs et distribués", "violet", 1010, 765, "below"),
    "J": ("Jeux et stratégies", "théorie algorithmique des jeux", "amber", 1255, 640, "right"),
    "D": ("Décision et choix social", "Parcoursup, MonProjetSup", "coral", 1170, 395, "above"),
}
CSS_COLOUR = {"gold": "#f3b848", "cyan": "#7cc4ff", "rose": "#ff8fa8", "teal": "#4fd1c5",
              "violet": "#a594ff", "amber": "#ff9a4a", "coral": "#ff6a5c"}

# name: (topics, x, y, label side)
PEOPLE = {
    "Nathanaël Fijalkow": ("APJ", 705, 520, "below"),
    "Guillaume Lagarde": ("APD", 800, 448, "right"),
    "Gabriel Bathie": ("PD", 935, 380, "right"),
    "Hugo Gimbert": ("DJR", 1105, 590, "left"),
    "Igor Walukiewicz": ("JR", 1175, 745, "right"),
    "Anca Muscholl": ("RJ", 930, 675, "left"),
    "Loïc Paulevé": ("VA", 470, 620, "left"),
    "Simon Mille": ("LA", 205, 590, "above"),
}


def art():
    cv = Canvas(W, H, seed=50)
    to = lambda x, y: (x * S, (y - Y0) * S)
    cx, cy = to(*CENTER)
    # spokes from the centre to each topic
    for k, (_, _, c, x, y, _) in TOPICS.items():
        hx, hy = to(x, y)
        cv.polyline(curve((cx, cy), (hx, hy), 0.05, n=120), col(c) * 0.35 + col("ivory") * 0.1, density=0.55)
    # people: links to their topics
    for name, (tops, x, y, _) in PEOPLE.items():
        px, py = to(x, y)
        for t in tops:
            _, _, c, hx, hy, _ = TOPICS[t]
            hx, hy = to(hx, hy)
            thick(cv, curve((px, py), (hx, hy), 0.08, n=120), col(c) * 0.9, 1.1, k=4, j=0.5)
    # topic hubs: a glow and two rings
    for k, (_, _, c, x, y, _) in TOPICS.items():
        hx, hy = to(x, y)
        cv.dot(hx, hy, 34, col(c) * 0.9, n=6000)
        node(cv, hx, hy, col(c), r=11, core=1.3)
        for r in (26, 40):
            t = np.linspace(0, 2 * np.pi, 260)
            cv.polyline(np.c_[hx + r * np.cos(t), hy + r * np.sin(t)], col(c) * 0.6, density=0.6)
    # people: small ivory stars
    for name, (tops, x, y, _) in PEOPLE.items():
        px, py = to(x, y)
        cv.dot(px, py, 10, col("ivory") * 0.7, n=1500)
        node(cv, px, py, col("ivory"), r=5, core=1.4)
    star(cv, cx, cy, col("gold"), size=110, r=20)
    dust(cv, 2600)
    light = cv.image()
    light += nebula(W, H, cv.rng, [col("teal"), col("violet"), col("gold")], strength=0.02)
    vig = vignette(W, H, inner=0.70, outer=0.995)
    finish(light, ROOT / "img" / "topics.webp", exposure=1.2, vig=vig, alpha=True,
           preview="/tmp/prev_topics.jpg")


def label_style(x, y, side, gap):
    if side == "above":
        return f"left:{x}px; top:{y - gap}px; transform:translate(-50%,-100%); text-align:center"
    if side == "below":
        return f"left:{x}px; top:{y + gap}px; transform:translate(-50%,0); text-align:center"
    if side == "left":
        return f"left:{x - gap}px; top:{y}px; transform:translate(-100%,-50%); text-align:right"
    return f"left:{x + gap}px; top:{y}px; transform:translate(0,-50%); text-align:left"


def page():
    labels = []
    for k, (lab, sub, c, x, y, side) in TOPICS.items():
        labels.append(
            f'<div class="topic" style="{label_style(x, y, side, 46)}; --c:{CSS_COLOUR[c]}">'
            f'<div class="t">{html.escape(lab)}</div><div class="s">{html.escape(sub)}</div></div>')
    for name, (_, x, y, side) in PEOPLE.items():
        labels.append(f'<div class="person" style="{label_style(x, y, side, 14)}">{html.escape(name)}</div>')
    cx, cy = CENTER
    labels.append(f'<div class="core" style="left:{cx}px; top:{cy + 30}px">logique · automates<br/>algorithmique</div>')
    labels.insert(0, '<img src="img/topics.webp" alt="" />')
    body = "\n            ".join(labels)
    index = ROOT / "index.html"
    doc = index.read_text()
    start = doc.index("<!-- map:start")
    start = doc.index("-->", start) + 3
    end = doc.index("<!-- map:end -->")
    doc = doc[:start] + "\n            " + body + "\n        " + doc[end:]
    index.write_text(doc)


if __name__ == "__main__":
    art()
    page()
    print("wrote img/topics.webp and the map in index.html")
