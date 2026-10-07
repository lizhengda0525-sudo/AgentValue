import { defineConfig, loadEnv } from 'vite';
import { createHash } from 'node:crypto';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const project = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL || '')
    ? env.VITE_SUPABASE_URL
    : '';
  const mobile = env.VITE_STANDALONE === 'true';
  return {
    base: './',
    plugins: [
      {
        name: 'agentvalue-offline-shell',
        transformIndexHtml(html) {
          return html.replace(
            "connect-src 'self'",
            `connect-src 'self'${project ? ` ${project} ${project.replace('https:', 'wss:')}` : ''} https://api.github.com https://raw.githubusercontent.com`,
          );
        },
        generateBundle(_options, bundle) {
          if (!mobile) return;
          const files = Object.keys(bundle).map((name) => `./${name}`);
          const assets = [
            './',
            './index.html',
            './icon.png',
            './icon-192.png',
            './icon-512.png',
            './manifest.webmanifest',
            ...files.filter((name) => !name.endsWith('.map')),
          ];
          const revision = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 24);
          const source = `const CACHE='agentvalue-mobile-${revision}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('agentvalue-mobile-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;const relative='./'+url.pathname.slice(new URL('./',self.location.href).pathname.length);if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./index.html',self.location.href))));return;}if(ASSETS.includes(relative))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});`;
          this.emitFile({ type: 'asset', fileName: 'sw.js', source });
        },
      },
    ],
    server: { host: '127.0.0.1' },
    build: {
      outDir: mobile ? 'dist-mobile' : 'dist',
      rollupOptions: {
        onwarn(warning, warn) {
          // React client directives in Ant Design are irrelevant to this client-only app.
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client'))
            return;
          warn(warning);
        },
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/\/(react|react-dom|scheduler)\//.test(id)) return 'react-runtime';
            if (/\/(?:@supabase|idb|fflate)\//.test(id)) return 'cloud-runtime';
            return 'ui-kit';
          },
        },
      },
    },
  };
});
