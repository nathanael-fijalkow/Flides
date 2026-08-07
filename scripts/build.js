const fs = require('fs');
const path = require('path');
const { ROOT, SOURCE, findDecks } = require('./lib');
const { getMathJax, buildFonts } = require('./vendor');

const flides = fs.readFileSync(SOURCE, 'utf8');
const mathjax = getMathJax();
const fonts = buildFonts();
const decks = findDecks();

if (decks.length === 0) {
    console.error('No decks found (looked for <dir>/js/flides.js under the repo root).');
    process.exit(1);
}

for (const deck of decks) {
    const deckDir = path.join(ROOT, deck);

    fs.writeFileSync(path.join(deckDir, 'js', 'flides.js'), flides);

    fs.mkdirSync(path.join(deckDir, 'js', 'mathjax'), { recursive: true });
    fs.writeFileSync(path.join(deckDir, 'js', 'mathjax', 'tex-svg.js'), mathjax);

    // wipe and recreate so stale files from a previous font selection don't linger
    fs.rmSync(path.join(deckDir, 'css', 'fonts'), { recursive: true, force: true });
    fs.mkdirSync(path.join(deckDir, 'css', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(deckDir, 'css', 'fonts.css'), fonts.css);
    for (const file of fonts.files) {
        fs.copyFileSync(file.source, path.join(deckDir, 'css', 'fonts', file.filename));
    }

    console.log(`synced flides.js, MathJax and fonts -> ${deck}/`);
}
