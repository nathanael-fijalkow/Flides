// Scaffolds a new deck folder from starter-kit/, then builds it so it's
// immediately viewable (js/flides.js, MathJax and fonts populated).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./lib');

const [, , folderName, title] = process.argv;

if (!folderName) {
    console.error('Usage: npm run new-deck -- <folder-name> ["Talk Title"]');
    console.error('Example: npm run new-deck -- 2026-08-08-My-Talk-Title "My Talk Title"');
    process.exit(1);
}

const source = path.join(ROOT, 'starter-kit');
const target = path.join(ROOT, folderName);

if (fs.existsSync(target)) {
    console.error(`${folderName}/ already exists - refusing to overwrite it.`);
    process.exit(1);
}

fs.cpSync(source, target, { recursive: true });

if (title) {
    const indexPath = path.join(target, 'index.html');
    const withTitle = fs.readFileSync(indexPath, 'utf8').split('My Talk Title').join(title);
    fs.writeFileSync(indexPath, withTitle);
}

execFileSync('node', [path.join(__dirname, 'build.js')], { stdio: 'inherit' });

console.log(`\nCreated ${folderName}/ - edit ${folderName}/index.html, then \`npm start\` to preview.`);
