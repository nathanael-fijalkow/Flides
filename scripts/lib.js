const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'lib', 'flides.js');
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'scripts']);

// A "deck" is any top-level directory that already has a js/flides.js copy,
// so new decks are picked up automatically the moment someone copies an
// existing deck folder as a template for a new talk.
function findDecks() {
    return fs.readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(ROOT, name, 'js', 'flides.js')));
}

module.exports = { ROOT, SOURCE, findDecks };
