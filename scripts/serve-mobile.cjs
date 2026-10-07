const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function createMobileServer({
  dist = path.resolve(__dirname, '../dist-mobile'),
  port = 5174,
} = {}) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
    '.pdf': 'application/pdf',
  };
  const root = path.resolve(dist);
  const server = http.createServer((req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        return res.end();
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control':
          path.basename(file) === 'sw.js' || path.extname(file) === '.html'
            ? 'no-cache'
            : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(400);
      res.end('Invalid request');
    }
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address()));
    });
  return { server, listen };
}
module.exports = { createMobileServer };
if (require.main === module) {
  const { server, listen } = createMobileServer({ port: Number(process.env.PORT || 5174) });
  listen()
    .then((address) => console.log(`AgentValue 手机网页预览 http://127.0.0.1:${address.port}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
