import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packager } from '@electron/packager';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = process.env.AGENTVAULT_PACKAGE_OUT || path.join(root, 'release');
const stage = path.join(root, 'release', 'app-source');
fs.mkdirSync(stage, { recursive: true });
await build({
  entryPoints: [path.join(root, 'electron/main.cjs')],
  outfile: path.join(stage, 'electron/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: false,
  minify: false,
});
fs.copyFileSync(path.join(root, 'electron/preload.cjs'), path.join(stage, 'electron/preload.cjs'));
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'agent-vault',
      productName: 'AgentVault',
      version: manifest.version,
      main: 'electron/main.cjs',
      author: 'AgentVault',
      description: 'Local AI asset library',
    },
    null,
    2,
  ),
);
fs.copyFileSync(path.join(root, 'README.md'), path.join(stage, 'README.md'));
const licenses = ['react', 'react-dom', 'lucide-react', 'yaml']
  .map((name) => {
    const folder = path.join(root, 'node_modules', name);
    const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((f) =>
      fs.existsSync(path.join(folder, f)),
    );
    return `## ${name}\n\n${file ? fs.readFileSync(path.join(folder, file), 'utf8') : 'See the upstream package for license terms.'}`;
  })
  .join('\n\n');
fs.writeFileSync(path.join(stage, 'THIRD_PARTY_LICENSES.md'), licenses);
const icon = path.join(root, 'assets', 'icon.ico');
const outputs = await packager({
  dir: stage,
  name: 'AgentVault',
  platform: 'win32',
  arch: 'x64',
  electronVersion: manifest.devDependencies.electron,
  electronZipDir: undefined,
  out: output,
  overwrite: true,
  prune: false,
  asar: true,
  icon: fs.existsSync(icon) ? icon : undefined,
  win32metadata: {
    CompanyName: 'AgentVault',
    FileDescription: 'AgentVault - Local AI asset library',
    ProductName: 'AgentVault',
    InternalName: 'AgentVault',
  },
  appCopyright: 'AgentVault 2026',
});
console.log('Packaged:', outputs.join('\n'));
