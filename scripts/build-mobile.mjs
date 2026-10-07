import { loadEnv } from 'vite';
import { spawnSync } from 'node:child_process';
const env = loadEnv('production', process.cwd(), 'VITE_');
if (
  !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL || '') ||
  !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY || '')
) {
  console.error('手机网页需要 Supabase 项目地址和公开 key。请配置 .env.local 或构建环境变量。');
  process.exit(1);
}
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env, VITE_STANDALONE: 'true' },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
