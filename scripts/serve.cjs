const path = require('node:path');
const { createLocalServer } = require('../electron/local-server.cjs');
const root = path.resolve(__dirname, '..');
const { server, vault, listen } = createLocalServer({
  root: process.env.AGENTVALUE_DATA_DIR || path.join(root, 'data'),
  dist: path.join(root, 'dist'),
  port: Number(process.env.PORT || 5173),
});
listen()
  .then((address) => {
    console.log(`AgentValue http://127.0.0.1:${address.port}\n数据目录：${vault.root}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
    server.close();
  });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
