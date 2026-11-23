const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const inlineStyleMarker = /<style id="plugin-inline-styles">[\s\S]*?<\/style>/i;
const inlineLogoMarker = /(<!-- plugin-brand-logo -->)[\s\S]*?(<!-- \/plugin-brand-logo -->)/;

const manifest = JSON.parse(read('manifest.json'));
const sourceUi = read('ui.html');
const lineEnding = sourceUi.match(/\r?\n/)?.[0] ?? '\n';
let ui = sourceUi;

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
  .join(lineEnding);
if (!inlineStyleMarker.test(ui)) {
  throw new Error('ui.html must include the plugin-inline-styles marker.');
}
ui = ui.replace(inlineStyleMarker, `<style id="plugin-inline-styles">${inlineStyles}</style>`);

if (!inlineLogoMarker.test(ui)) {
  throw new Error('ui.html must include the plugin-brand-logo marker.');
}
const inlineLogo = read('img/logo.svg').trim().replace(/^<svg\b/, '<svg class="brand__mark" aria-hidden="true"');
ui = ui.replace(inlineLogoMarker, (_match, start, end) => {
  const indentedLogo = inlineLogo.split(/\r?\n/).map(line => `        ${line}`).join(lineEnding);
  return [start, indentedLogo, `        ${end}`].join(lineEnding);
});
if (ui !== sourceUi) {
  fs.writeFileSync(path.join(root, 'ui.html'), ui, 'utf8');
}

if (!ui.includes(inlineStyles)) {
  throw new Error('ui.html must contain the inlined plugin styles.');
}

if (!fs.existsSync(path.join(root, 'code.js'))) {
  throw new Error('code.js is required by manifest.json.');
}

if (fs.existsSync(path.join(root, 'dist'))) {
  throw new Error('dist/ must not exist in the direct-ui build layout.');
}

console.log('Build complete. CSS and the brand logo were inlined into ui.html; no dist/ output is generated.');
