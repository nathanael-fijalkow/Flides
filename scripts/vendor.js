// Builds the locally-vendored MathJax bundle and self-hosted font CSS from
// the npm packages in node_modules, so decks never fetch either from a CDN.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib');

const MATHJAX_SOURCE = path.join(ROOT, 'node_modules', 'mathjax', 'es5', 'tex-svg.js');

// tex-svg.js draws glyphs as SVG paths with the font data embedded in the
// bundle itself, so (unlike the chtml output) it never triggers a separate
// webfont request - one file, zero extra network calls.
function getMathJax() {
    return fs.readFileSync(MATHJAX_SOURCE);
}

// Only PT Serif is actually rendered: every deck's `.step { font-family:
// 'PT Serif' }` overrides `body { font-family: 'PT Sans' }` for all visible
// slide content (verified with a screenshot), so PT Sans is dead CSS - no
// point shipping ~250KB of unused font files per deck for it.
//
// Only the Latin and Latin Extended-A subsets are needed (the slides are
// English/French text plus Polish/Czech names like "Czerwiński" - no
// Cyrillic, Greek or Vietnamese), at regular/bold, normal/italic.
const FONT_FAMILIES = [
    { pkg: '@fontsource/pt-serif', name: 'PT Serif' },
];
const SUBSETS = ['latin', 'latin-ext'];
const WEIGHTS = ['400', '700'];
const STYLES = [
    { suffix: '', css: 'normal' },
    { suffix: '-italic', css: 'italic' },
];

function buildFonts() {
    const files = [];
    let css = '';

    for (const family of FONT_FAMILIES) {
        const pkgDir = path.join(ROOT, 'node_modules', family.pkg);
        for (const subset of SUBSETS) {
            for (const weight of WEIGHTS) {
                for (const style of STYLES) {
                    const basename = `${subset}-${weight}${style.suffix}`;
                    const cssPath = path.join(pkgDir, `${basename}.css`);
                    const rule = fs.readFileSync(cssPath, 'utf8');

                    // pull the woff2 filename out of the generated @font-face
                    // rule and drop the legacy .woff fallback - every browser
                    // still receiving security updates supports woff2.
                    const match = rule.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
                    if (!match) {
                        throw new Error(`could not find a woff2 url in ${cssPath}`);
                    }
                    const filename = match[1];
                    files.push({
                        filename,
                        source: path.join(pkgDir, 'files', filename),
                    });

                    css += `@font-face {\n`
                        + `  font-family: '${family.name}';\n`
                        + `  font-style: ${style.css};\n`
                        + `  font-weight: ${weight};\n`
                        + `  font-display: swap;\n`
                        + `  src: url(./fonts/${filename}) format('woff2');\n`
                        + `}\n\n`;
                }
            }
        }
    }

    return { css, files };
}

module.exports = { getMathJax, buildFonts };
