const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const inlineStyleMarker = /<style id="plugin-inline-styles">[\s\S]*?<\/style>/i;

const manifest = JSON.parse(read('manifest.json'));
let ui = read('ui.html');

if (manifest.ui !== 'ui.html') {
  throw new Error('manifest.json must point directly to ui.html.');
}

for (const stylesheet of ['css/common.css', 'css/ui.css']) {
  const href = stylesheet.replace('.', '\\.' );
  const link = new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\./)?${href}["'][^>]*>`, 'i');
  if (!link.test(ui)) {
    throw new Error(`ui.html must link ${stylesheet}.`);
  }
}

const inlineStyles = ['css/common.css', 'css/ui.css']
  .map(stylesheet => read(stylesheet))
  .join('\n');
if (!inlineStyleMarker.test(ui)) {
  throw new Error('ui.html must include the plugin-inline-styles marker.');
}
ui = ui.replace(inlineStyleMarker, `<style id="plugin-inline-styles">${inlineStyles}</style>`);
fs.writeFileSync(path.join(root, 'ui.html'), ui, 'utf8');

if (!ui.includes(inlineStyles)) {
  throw new Error('ui.html must contain the inlined plugin styles.');
}

if (!fs.existsSync(path.join(root, 'code.js'))) {
  throw new Error('code.js is required by manifest.json.');
}

if (fs.existsSync(path.join(root, 'dist'))) {
  throw new Error('dist/ must not exist in the direct-ui build layout.');
}

console.log('Build complete. CSS was inlined into ui.html; no dist/ output is generated.');
