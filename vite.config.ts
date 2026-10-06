import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: {
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
          return 'ui-kit';
        },
      },
    },
  },
});
