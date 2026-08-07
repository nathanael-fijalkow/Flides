const fs = require('fs');
const path = require('path');
const { ROOT, SOURCE, findDecks } = require('./lib');

const source = fs.readFileSync(SOURCE, 'utf8');
const decks = findDecks();
const outOfSync = [];

for (const deck of decks) {
    const target = path.join(ROOT, deck, 'js', 'flides.js');
    if (fs.readFileSync(target, 'utf8') !== source) {
        outOfSync.push(deck);
    }
}

if (outOfSync.length > 0) {
    console.error('These decks are out of sync with lib/flides.js:');
    for (const deck of outOfSync) console.error(`  - ${deck}/js/flides.js`);
    console.error('\nRun `npm run build` to fix, then commit the result.');
    process.exit(1);
}

console.log(`OK: ${decks.length} deck(s) match lib/flides.js.`);
