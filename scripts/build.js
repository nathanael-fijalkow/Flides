const fs = require('fs');
const path = require('path');
const { ROOT, SOURCE, findDecks } = require('./lib');

const source = fs.readFileSync(SOURCE, 'utf8');
const decks = findDecks();

if (decks.length === 0) {
    console.error('No decks found (looked for <dir>/js/flides.js under the repo root).');
    process.exit(1);
}

for (const deck of decks) {
    const target = path.join(ROOT, deck, 'js', 'flides.js');
    fs.writeFileSync(target, source);
    console.log(`synced lib/flides.js -> ${deck}/js/flides.js`);
}
