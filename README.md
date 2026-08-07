# Flides
Flides allows to create sets of slides in HTML5, using javascript

The core visualisation features (zoom in particular) is based on [impress.js](https://github.com/impress/impress.js). I added some features:

* slide steps, allowing to display slides by small bits (using 'right'), with a quick mode ('down')
* navigational shortcuts: 'enter' for going ot the overview and 'backspace' for going to the beginning,
* always visible slides,
* animation using SVG,
* partial overviews, showing what was already seen but not what is coming after,
* clickable / not clickable slides... 

You can check out this basic [demo](https://github.com/nathanael-fijalkow/Flides/tree/master/Demo) I made.
Please find [here](https://github.com/nathanael-fijalkow/Flides/tree/master/2019-01-23-CAALM_Universal_Graphs) and [here](https://github.com/nathanael-fijalkow/Flides/tree/master/2019-06-05-ForMaL-Cachan) two complete sets of slides.

If you have troubles visualising them:
* If you see nothing: you are using a too old browser which did not yet implement the latest HTML5 features used there, or you did not enable javascript. I can do nothing for you.
* If it's slow and laggy: you may want to try Google Chrome, as it's definitely the best browser for this.
* If some parts of the slides do not fit the windows: it's because you use a zoom in your browser, play with it (usually, setting it to between 67% and 100% works just fine).

## Maintaining the shared library

Each deck folder is a self-contained static site — `index.html`, `css/`, `js/flides.js`, `img/` — so you can open one directly in a browser or copy a whole folder as the starting point for a new talk, no build step required.

`js/flides.js` is nonetheless the same file in every deck, so it's kept in one canonical place, [`lib/flides.js`](lib/flides.js), and synced out to each deck by a small Node script:

* `npm install` — one-time setup
* Edit `lib/flides.js` (never edit a deck's `js/flides.js` directly, it will be overwritten)
* `npm run build` — copies `lib/flides.js` into every deck's `js/flides.js`
* `npm run check` — fails if any deck's copy has drifted from `lib/flides.js` (useful before committing)
* `npm start` — serves the whole repo at http://localhost:8080 for local preview

None of this is required to view or host the slides — npm is a dev-time convenience only. New deck folders are picked up automatically as long as they contain a `js/flides.js`.

All comments and questions are most welcome! I'd be very glad to help you making HTML5 slides.

