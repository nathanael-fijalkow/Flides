# Flides
Flides allows to create sets of slides in HTML5, using javascript

The core visualisation features (zoom in particular) is based on [impress.js](https://github.com/impress/impress.js). I added some features:

* slide steps, allowing to display slides by small bits (using 'right'), with a quick mode ('enter')
* navigational shortcuts: 'shift' for going to the overview and 'backspace' for going to the beginning,
* always visible slides,
* animation using SVG,
* partial overviews, showing what was already seen but not what is coming after,
* clickable / not clickable slides... 

You can check out this basic [demo](https://github.com/nathanael-fijalkow/Flides/tree/master/Demo) I made — it doubles as a tour of every feature above.
Please find [here](https://github.com/nathanael-fijalkow/Flides/tree/master/2019-01-23-CAALM_Universal_Graphs) and [here](https://github.com/nathanael-fijalkow/Flides/tree/master/2019-06-05-ForMaL-Cachan) two complete sets of slides.

Starting a new talk? [`starter-kit/`](starter-kit) is a minimal, heavily-commented template — copy it (or run `npm run new-deck -- <folder-name> "Talk Title"` to do that for you and populate the shared assets in one step) and edit away.

If you have troubles visualising them:
* If you see nothing: you are using a too old browser which did not yet implement the latest HTML5 features used there, or you did not enable javascript. I can do nothing for you.
* If it's slow and laggy: you may want to try Google Chrome, as it's definitely the best browser for this.
* If some parts of the slides do not fit the windows: it's because you use a zoom in your browser, play with it (usually, setting it to between 67% and 100% works just fine).

## Maintaining the shared library

Each deck folder is a self-contained static site — `index.html`, `css/`, `js/flides.js`, `img/` — so you can open one directly in a browser or copy a whole folder as the starting point for a new talk, no build step required.

`js/flides.js` is nonetheless the same file in every deck, so it's kept in one canonical place, [`lib/flides.js`](lib/flides.js), and synced out to each deck by a small Node script. The same script also vendors MathJax (math rendering) and the PT Serif webfont from npm into each deck, so slides never fetch either from a CDN at view time - they render identically online or fully offline:

* `npm install` — one-time setup, also downloads the MathJax and font packages used for vendoring
* Edit `lib/flides.js` (never edit a deck's `js/flides.js` directly, it will be overwritten)
* `npm run build` — copies `lib/flides.js`, MathJax, and the fonts into every deck (`js/flides.js`, `js/mathjax/`, `css/fonts.css` + `css/fonts/`)
* `npm run check` — fails if any deck has drifted from the source files, or if `npm update` bumped a vendored package and the deck copies weren't rebuilt (useful before committing)
* `npm run new-deck -- <folder-name> ["Talk Title"]` — scaffolds a new deck from `starter-kit/` and runs the build for you
* `npm start` — serves the whole repo at http://localhost:8080 for local preview

None of this is required to view or host the slides — npm is a dev-time convenience only. New deck folders are picked up automatically as long as they contain an `index.html`.

All comments and questions are most welcome! I'd be very glad to help you making HTML5 slides.

