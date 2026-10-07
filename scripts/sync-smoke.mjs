import { chromium, _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { createLocalServer } = require('../electron/local-server.cjs');
const { createMobileServer } = require('./serve-mobile.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-sync-ui-'));
const desktop = createLocalServer({
  root: path.join(root, 'data'),
  dist: path.resolve('dist'),
  port: 0,
});
const mobile = createMobileServer({ port: 0 });
const native = process.env.AGENTVALUE_SYNC_NATIVE === '1';
const artifacts = path.resolve(native ? 'artifacts/sync-native' : 'artifacts/sync');
fs.mkdirSync(artifacts, { recursive: true });
fs.rmSync(path.join(artifacts, 'results.json'), { force: true });
const errors = [],
  records = new Map(),
  receipts = new Map();
let seq = 0,
  browser,
  electronApp;
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'sync-ui@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const jwt = [
  { alg: 'HS256', typ: 'JWT' },
  {
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
  'test-only-signature',
]
  .map((v, i) => (i === 2 ? v : Buffer.from(JSON.stringify(v)).toString('base64url')))
  .join('.');
async function mock(context) {
  await context.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const reply = (value) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/auth/v1/token')
      return reply({
        access_token: jwt,
        refresh_token: 'ui-test-only',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user,
      });
    if (url.pathname === '/auth/v1/user') return reply(user);
    if (url.pathname === '/auth/v1/logout') return reply({});
    if (url.pathname === '/rest/v1/rpc/agentvalue_push') {
      const { mutation: m } = request.postDataJSON();
      if (receipts.has(m.operationId)) return reply(receipts.get(m.operationId));
      const key = `${m.kind}:${m.id}`,
        old = records.get(key);
      if ((old?.version || 0) !== m.baseVersion) return reply({ status: 'conflict', record: old });
      const record = {
        kind: m.kind,
        record_id: m.id,
        data: m.data,
        deleted: m.deleted,
        version: (old?.version || 0) + 1,
        change_seq: ++seq,
        updated_at: new Date().toISOString(),
      };
      records.set(key, record);
      const result = { status: 'applied', record };
      receipts.set(m.operationId, result);
      return reply(result);
    }
    if (url.pathname === '/rest/v1/rpc/agentvalue_pull') {
      const { after_seq: cursor } = request.postDataJSON();
      return reply(
        [...records.values()]
          .filter((r) => r.change_seq > cursor)
          .sort((a, b) => a.change_seq - b.change_seq)
          .slice(0, 200),
      );
    }
    errors.push(`Unexpected test cloud request: ${url.pathname}`);
    return route.abort();
  });
}
async function login(page, desktop = false) {
  if (desktop) await page.getByRole('button', { name: '本机空间', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(user.email);
  await page.getByLabel('账号密码', { exact: true }).fill('UI-test-password');
  await page.getByRole('button', { name: '登录云空间', exact: true }).click();
  await page.getByRole('heading', { name: '今天', exact: true }).waitFor();
}
async function sync(page) {
  await page.locator('.av-sync-control').click();
  const button = page.getByRole('button', { name: '立即同步', exact: true });
  await button.waitFor();
  await button.click();
  await page.getByText('正在同步', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('已与云端同步', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
}
async function add(page, title) {
  const input = page.getByRole('textbox', { name: '快速记录事项' });
  await input.fill(title);
  await input.press('Enter');
  await page.getByText(title, { exact: true }).first().waitFor();
  await page
    .getByText('正在保存', { exact: false })
    .waitFor({ state: 'hidden' })
    .catch(() => {});
}
async function rename(page, oldName, newName) {
  await page.getByText(oldName, { exact: true }).first().click();
  const input = page.locator('input[name=title]');
  await input.fill(newName);
  await input.press('Enter');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.waitForFunction(async (title) => {
    const databases = await indexedDB.databases();
    const name = databases.find((db) => db.name?.startsWith('AgentValue-cloud-v1-'))?.name;
    if (!name) return false;
    return new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('records');
        const rows = tx.objectStore('records').getAll();
        rows.onsuccess = () => {
          db.close();
          resolve(rows.result.some((row) => row.kind === 'task' && row.data.title === title));
        };
      };
    });
  }, newName);
}
try {
  const da = await desktop.listen(),
    ma = await mobile.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  if (native) {
    const env = { ...process.env, AGENTVALUE_DATA_DIR: path.join(root, 'native-data') };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath: process.env.AGENTVALUE_EXECUTABLE || undefined,
      args: process.env.AGENTVALUE_EXECUTABLE ? [] : [path.resolve('.')],
      cwd: path.resolve('.'),
      env,
      timeout: 60000,
    });
  }
  const pc = native
      ? electronApp.context()
      : await browser.newContext({ viewport: { width: 1365, height: 900 } }),
    phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  await mock(pc);
  await mock(phone);
  const a = native ? await electronApp.firstWindow() : await pc.newPage(),
    b = await phone.newPage();
  a.setDefaultTimeout(15000);
  b.setDefaultTimeout(15000);
  for (const page of [a, b]) {
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  if (!native) await a.goto(`http://127.0.0.1:${da.port}/`);
  else {
    await a.getByRole('heading', { name: '今天', exact: true }).waitFor();
    await add(a, '本机保留事项');
  }
  await b.goto(`http://127.0.0.1:${ma.port}/`);
  await b.screenshot({ path: path.join(artifacts, 'mobile-login.png'), fullPage: true });
  await login(a, true);
  if (native) {
    await a.locator('.av-sync-control').click();
    await a.getByRole('button', { name: '备份并导入本机数据', exact: true }).click();
    await a.getByRole('button', { name: '备份并导入', exact: true }).click();
    await a.getByText('本机保留事项', { exact: true }).first().waitFor();
    await a.getByRole('button', { name: '关闭', exact: true }).last().click();
    const original = await a.evaluate(() => window.vault.call('assistantState'));
    assert.equal(original.tasks.length, 1);
    assert.equal(original.tasks[0].title, '本机保留事项');
  }
  await login(b);
  await a.screenshot({ path: path.join(artifacts, 'desktop-cloud.png'), fullPage: true });
  await add(a, '电脑创建的事项');
  await sync(a);
  await sync(b);
  await b.getByText('电脑创建的事项', { exact: true }).first().waitFor();
  assert.equal(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'phone page must not overflow the viewport',
  );
  await b.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await phone.setOffline(true);
  await add(b, '手机离线记录');
  await b.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('AgentValue-auth-'));
    const session = JSON.parse(localStorage.getItem(key));
    session.expires_at = Math.floor(Date.now() / 1000) - 1;
    localStorage.setItem(key, JSON.stringify(session));
  });
  await b.reload();
  await b.getByText('手机离线记录', { exact: true }).first().waitFor();
  await b.screenshot({ path: path.join(artifacts, 'mobile-offline.png'), fullPage: true });
  await phone.setOffline(false);
  await sync(b);
  await sync(a);
  await a.getByText('手机离线记录', { exact: true }).first().waitFor();
  // Keep both clients offline while editing the same already-synced record.
  await pc.setOffline(true);
  await phone.setOffline(true);
  await rename(a, '电脑创建的事项', '电脑修改');
  await rename(b, '电脑创建的事项', '手机修改');
  await pc.setOffline(false);
  await sync(a);
  await phone.setOffline(false);
  await b.locator('.av-sync-control').click();
  await b.getByRole('button', { name: '立即同步', exact: true }).click();
  await b.getByRole('button', { name: '保留本机版本', exact: true }).waitFor();
  await b.getByText('1 条记录存在同步冲突', { exact: true }).waitFor();
  await b.screenshot({ path: path.join(artifacts, 'mobile-conflict.png'), fullPage: true });
  await b.getByRole('button', { name: '保留本机版本', exact: true }).click();
  await b.getByRole('button', { name: '保留本机版本', exact: true }).waitFor({ state: 'hidden' });
  await b.getByRole('button', { name: '关闭', exact: true }).last().click();
  await sync(a);
  await a.getByText('手机修改', { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  const results = {
    passed: true,
    environment:
      'isolated local clients with simulated cloud RPC; no real accounts or cloud writes',
    completed: [
      ...(native
        ? [
            'real native IPC cloud backend; first import retains and backs up original SQLite workspace',
          ]
        : []),
      'desktop email login and separate workspace',
      'mobile responsive page',
      'desktop to phone incremental sync',
      'mobile offline editing and offline reload',
      'expired login still permits offline cached editing; reconnect refreshes session',
      'offline outbox upload and PC convergence',
      'same-record conflict comparison and explicit resolution',
    ],
    rendererErrors: errors,
  };
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await electronApp?.close();
  await new Promise((r) => desktop.server.close(r));
  await new Promise((r) => mobile.server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
}
