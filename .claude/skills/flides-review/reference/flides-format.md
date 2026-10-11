# The Flides format

Flides is a fork of impress.js. A deck is a folder with one HTML file (usually `index.html`), a stylesheet (`css/style.css`), the engine (`js/flides.js`), figures (`img/`) and, in recent decks, local copies of MathJax (`js/mathjax/`) and of the fonts (`css/fonts.css`). Each deck carries its own copy of the engine and stylesheet, so decks differ slightly: check the deck's own files before relying on a detail below.

In the Flides repository, the engine's source is `lib/flides.js`, and `npm run build` copies it into every deck. Never edit a deck's `js/flides.js` there, since the next build overwrites it. A deck outside that repository owns its copy.

## Skeleton

```html
<div id="flides">
    <div id="title" class="step" data-x="-1000" data-y="0">
        <h2>Title</h2>
        <div class="slide_step">Shown on the first key press</div>
    </div>
    <div class="part" data-x="0" data-y="1500">
        <div id="first" class="step" data-x="-500" data-y="0">...</div>
        <div id="second" class="step" data-x="500" data-y="0">...</div>
    </div>
    <div id="backup" class="step" data-fixed="1" data-x="0" data-y="800">...</div>
    <div id="overview" class="step" data-x="0" data-y="650" data-scale="3"></div>
</div>
<div id="backup-links"><a href="#backup">Backup</a></div>
<script src="js/flides.js"></script>
<script>flides().init();</script>
```

Every element with class `step` inside the root `#flides` is a slide, including those inside a `.part`. Slides are visited in document order, so moving a slide in the talk means moving its element in the file. Its place on the canvas is independent of that order.

## Slide attributes

| Attribute | Effect |
|---|---|
| `id` | Name of the slide, used in links (`href="#id"`), in the address (`#/id`), in CSS (`#id img {...}`) and in the body class `flides-on-id` set while the slide is shown. Slides without an id get `step-N` at runtime. |
| `data-x`, `data-y`, `data-z` | Position of the slide's centre on the canvas, in pixels (relative to the enclosing parts, if any). |
| `data-scale` | Size of the slide on the canvas (default 1). The camera zooms so that the active slide fills the window whatever its scale. |
| `data-rotate`, `data-rotate-x`, `data-rotate-y`, `data-rotate-z` | Rotation in degrees. |
| `data-duration` | Length in milliseconds of the camera move to this slide (default 1000). `0` jumps without the zoom effect. |
| `data-fixed="1"` | Backup slide, see below. |
| class `unclickable` | Clicking the slide in an overview does not jump to it. |

## Special slides

flides.js and the stylesheets give three kinds of slides a special role. The review dashboard shows them apart from ordinary slides, and tickets name their kind.

- **Backup slides** (`data-fixed="1"`) are outside the main flow: the arrow keys skip them, they are reached through a link or a click, and they stay visible. The starter kit uses them for material kept in reserve, linked from `#backup-links`, a menu shown in a corner of the screen during the final overview.
- **The partial overview** is the slide with id `overview_intermediate`. It is an empty slide with a large scale, inside the flow, and the rules `.flides-on-overview_intermediate .step.seen { opacity: 1 }` make it show only the slides seen so far.
- **The final overview** is the slide with id `overview`, an empty slide with a large scale, normally the last one (Shift jumps to the last slide). The rules `.flides-on-overview .step { opacity: 1 }` show every slide.

Recent versions of flides.js number the slides in a corner (`3/12`, added at runtime as `span.flides-slide-number`), skipping these three kinds. The dashboard uses the same numbers, so "slide 3" in a ticket is the slide showing `3/12`.

Older decks may have other overview slides under other ids (for instance `overview_int`, styled through `.flides-on-overview_int`), and several of them may share an id on purpose. Do not rename them.

## Geometry

- flides.js scales the canvas to the window, never above 1 for the default design size of 1024 by 768 (`data-width`, `data-height`), then zooms on the active slide by a factor set in the deck's `js/flides.js`: look for `scale: 1.5 / step.scale` (1.5 in the current version, 1 in old copies).
- A slide is a box `900px` wide with `40px` padding (see `.step` in the stylesheet), so text runs over about 820 pixels, and its height follows its content. Nothing scrolls.
- With a factor of 1.5, the window shows its own size divided by 1.5, in slide pixels: about 1000 by 650 on a laptop screen of 1512 by 982, 1280 by 720 on a Full HD projector, and 680 by 510 on a 1024 by 768 projector, where even the 900 pixel box is cut on both sides. Each ticket says on which screen size the reviewer saw the slide. To make a slide fit, shorten the text, split it into reveals or into two slides, shrink a figure, or use a smaller heading.
- On the canvas, a slide of scale `s` covers about `900 * s` by `700 * s` pixels around its position. Slides of scale 1 are typically 1000 pixels apart; a small slide can sit inside a larger one, which gives a zoom effect (the demo nests slides of scale 0.05 inside a figure).
- **Parts.** Inside `<div class="part" data-x="..." data-y="..." data-scale="...">`, the coordinates of the slides are relative to the part: positions are added (multiplied by the part's scale) and scales multiplied. Parts can be nested and are never slides themselves. To move a whole section, edit its part only.
- When adding a slide, copy the spacing pattern of its neighbours (inside the same part if they are in one), check that it does not overlap another slide's area, and give it a unique id. When splitting a slide, put the new one next to the original, in the same row or column as the surrounding slides.

## Reveals and animations

- `<div class="slide_step">` parts of a slide are uncovered one at a time with the right arrow. Hidden ones are drawn faintly or not at all, depending on the stylesheet (`.slide_step_hidden`).
- Elements with class `token`, usually `<g class="token">` groups inside an inline `<svg>`, are animation frames: the space bar shows them one at a time, in order, and starts over after the last.

## Content conventions

- Headings `h2` (very large, titles), `h3` and `h4`. Decks define their own extras in the stylesheet, such as `h25`, color tags (`<red>`, `<blue>`, `<green>`, `<orange>`), or layout classes (`.row`, `.box` with `data-label`). Reuse what the deck already has before adding CSS.
- `img` defaults to `width: 100%`. Figures are resized per slide in the stylesheet (`#slide_id img { width: 45%; }`), with a `width` attribute, or with an inline `style`.
- Mathematics uses MathJax: `$...$` inline and `$$...$$` displayed, configured at the end of `index.html`. When a ticket points at a formula, it shows the formula's LaTeX source.
- Figures are often SVG files generated from TikZ (`img/*.tex` next to `img/*.svg`). If a ticket requires changing such a figure, edit the `.tex` source only if you can rebuild the SVG; otherwise ask with `block`.

## Keys (current flides.js)

Right, Down, Page Down: next reveal, or next slide. Left, Up, Page Up: hide the reveals, or previous slide. Enter: uncover every reveal of the slide. Space: next animation frame. Backspace: first slide. Shift: last slide (the final overview).
