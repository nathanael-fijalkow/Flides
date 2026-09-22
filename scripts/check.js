const fs = require('fs');
const path = require('path');
const { ROOT, SOURCE, findDecks } = require('./lib');
const { getMathJax, buildFonts } = require('./vendor');

const flides = fs.readFileSync(SOURCE, 'utf8');
const mathjax = getMathJax();
const fonts = buildFonts();
const decks = findDecks();
const problems = [];

for (const deck of decks) {
    const deckDir = path.join(ROOT, deck);

    const flidesPath = path.join(deckDir, 'js', 'flides.js');
    if (!fs.existsSync(flidesPath) || fs.readFileSync(flidesPath, 'utf8') !== flides) {
        problems.push(`${deck}/js/flides.js is out of sync with lib/flides.js`);
    }

    const mathjaxPath = path.join(deckDir, 'js', 'mathjax', 'tex-svg.js');
    if (!fs.existsSync(mathjaxPath) || !fs.readFileSync(mathjaxPath).equals(mathjax)) {
        problems.push(`${deck}/js/mathjax/tex-svg.js is out of sync with node_modules/mathjax`);
    }

    const fontsCssPath = path.join(deckDir, 'css', 'fonts.css');
    if (!fs.existsSync(fontsCssPath) || fs.readFileSync(fontsCssPath, 'utf8') !== fonts.css) {
        problems.push(`${deck}/css/fonts.css is out of sync`);
    }
    for (const file of fonts.files) {
        const target = path.join(deckDir, 'css', 'fonts', file.filename);
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(file.source))) {
            problems.push(`${deck}/css/fonts/${file.filename} is out of sync`);
        }
    }

    const fontsDir = path.join(deckDir, 'css', 'fonts');
    const expected = new Set(fonts.files.map((file) => file.filename));
    if (fs.existsSync(fontsDir)) {
        for (const name of fs.readdirSync(fontsDir)) {
            if (!expected.has(name)) {
                problems.push(`${deck}/css/fonts/${name} is stale and no longer needed`);
            }
        }
    }
}

if (problems.length > 0) {
    console.error('Vendored assets are out of sync:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nRun `npm run build` to fix, then commit the result.');
    process.exit(1);
}

console.log(`OK: ${decks.length} deck(s) match lib/flides.js, MathJax and the local fonts.`);
