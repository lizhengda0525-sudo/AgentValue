import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createLocalServer } from '../electron/local-server.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = createLocalServer({
  root: process.env.AGENTVALUE_DATA_DIR || path.join(root, 'data'),
  dist: path.join(root, 'dist'),
  port: 5174,
});
let frontend;
try {
  await api.listen();
  frontend = await createServer({
    root,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:5174',
          changeOrigin: true,
          headers: { Origin: 'http://127.0.0.1:5174' },
        },
      },
    },
  });
  await frontend.listen();
  frontend.printUrls();
  console.log(`数据目录：${api.vault.root}`);
} catch (error) {
  console.error(error.message);
  api.server.close();
  await frontend?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    api.server.close();
    await frontend?.close();
  });
