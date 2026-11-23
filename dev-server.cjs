const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 5500);
const clients = new Set();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const liveReloadScript = `<script>(function(){const source=new EventSource('/__livereload');source.onmessage=function(){location.reload()};source.onerror=function(){source.close()}})();</script>`;

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(root + path.sep);
}

function sendReload() {
  for (const response of clients) response.write('data: reload\n\n');
}

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
  if (requestPath === '/__livereload') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  const relativePath = requestPath === '/' ? '/preview.html' : requestPath;
  const filePath = path.resolve(root, `.${relativePath}`);
  if (!isInsideRoot(filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  if (extension !== '.html') {
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  response.end(html.replace('</body>', `${liveReloadScript}</body>`));
});

let reloadTimer;
fs.watch(root, { recursive: true }, (eventType, filename) => {
  if (!filename || filename.includes('node_modules')) return;
  if (!/\.(html|css|js|cjs)$/i.test(filename)) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(sendReload, 80);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Live server running at http://127.0.0.1:${port}/`);
  console.log('Watching HTML, CSS, JS, and CJS files for changes.');
});
