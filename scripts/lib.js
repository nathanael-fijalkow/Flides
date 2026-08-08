const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'lib', 'flides.js');
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'scripts']);

// A "deck" is any top-level directory with an index.html, so brand new
// decks (including one just scaffolded from starter-kit/, which has no
// js/flides.js of its own yet) are picked up automatically.
function findDecks() {
    return fs.readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(ROOT, name, 'index.html')));
}

module.exports = { ROOT, SOURCE, findDecks };
