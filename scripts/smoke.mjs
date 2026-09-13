import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvault-ui-'));
const artifacts = path.join(project, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const env = { ...process.env, AGENTVAULT_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const source = path.join(data, 'source', 'demo-skill');
fs.mkdirSync(path.join(source, 'references'), { recursive: true });
fs.writeFileSync(
  path.join(source, 'SKILL.md'),
  '---\nname: smoke-review\ndescription: 真实窗口测试用 Skill\n---\n# Review\n边界条件验证。',
);
fs.writeFileSync(path.join(source, 'references', 'guide.md'), '# Reference\nFixture only.');
const errors = [];
const completed = [];
let app;
async function launch() {
  app = await electron.launch({
    executablePath: process.env.AGENTVAULT_EXECUTABLE || undefined,
    args: process.env.AGENTVAULT_EXECUTABLE ? [] : [project],
    cwd: project,
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /好灵感，值得被收藏/ }).waitFor();
  return page;
}
try {
  let page = await launch();
  await page.screenshot({ path: path.join(artifacts, 'home.png'), fullPage: true });
  completed.push('Clean startup and empty-state home');
  const fixture = path.join(data, 'test-output.png');
  const fixtureBase64 = await app.evaluate(({ nativeImage }) => {
    const w = 640,
      h = 420,
      pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = 160 + Math.floor((y / h) * 50);
        pixels[i + 1] = 170 + Math.floor((x / w) * 35);
        pixels[i + 2] = 210 + Math.floor((y / h) * 30);
        pixels[i + 3] = 255;
      }
    return nativeImage.createFromBitmap(pixels, { width: w, height: h }).toPNG().toString('base64');
  });
  fs.writeFileSync(fixture, Buffer.from(fixtureBase64, 'base64'));
  await page.getByRole('button', { name: '文本 Prompt', exact: false }).first().click();
  await page.getByRole('button', { name: '新增 Prompt', exact: true }).click();
  await page.locator('input[name=title]').fill('测试 · 代码审查');
  await page.locator('textarea[name=content]').fill('请检查并发边界与异常处理。');
  await page.locator('input[name=category]').fill('开发');
  await page.locator('input[name=tags]').fill('Java，代码审查');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('heading', { name: '测试 · 代码审查', exact: true }).waitFor();
  await page.getByRole('button', { name: '复制 测试 · 代码审查', exact: true }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    '请检查并发边界与异常处理。',
  );
  await page.getByRole('button', { name: '收藏 测试 · 代码审查', exact: true }).click();
  await page.getByLabel('全局搜索').fill('并发边界');
  await page.getByRole('heading', { name: '测试 · 代码审查', exact: true }).waitFor();
  completed.push('Text create, tags, favorite, full-text search and actual clipboard');
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await page.getByRole('button', { name: '图片 Prompt', exact: false }).first().click();
  await page.getByRole('button', { name: '新增 Prompt', exact: true }).click();
  await page.locator('input[name=title]').fill('测试 · 图片实验');
  await page.locator('textarea[name=content]').fill('A watercolor lake. Original snapshot.');
  await page.locator('input[name=tags]').fill('水彩，测试');
  await page.getByLabel('参考图', { exact: true }).setInputFiles(fixture);
  await page.getByLabel('效果图', { exact: true }).setInputFiles(fixture);
  await page.locator('input[name=model]').fill('测试模型');
  await page.locator('input[name=ratio]').fill('16:9');
  await page.locator('select[name=rating]').selectOption('4');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('heading', { name: '测试 · 图片实验', exact: true }).waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.card-image img')).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: path.join(artifacts, 'gallery.png'), fullPage: true });
  await page.getByRole('heading', { name: '测试 · 图片实验', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('textarea[name=content]').fill('Revised watercolor lake.');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByText('Revised watercolor lake.', { exact: true }).waitFor();
  await page.locator('summary').first().click();
  await page.getByText('A watercolor lake. Original snapshot.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '记录新实验', exact: true }).click();
  await page.getByLabel('效果图', { exact: true }).setInputFiles(fixture);
  await page.locator('input[name=model]').fill('第二模型');
  await page.locator('select[name=rating]').selectOption('5');
  await page.getByRole('button', { name: '保存实验', exact: true }).click();
  await page
    .getByRole('dialog', { name: '收藏详情' })
    .getByText('第二模型', { exact: true })
    .waitFor();
  await page.locator('.drawer-content').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: path.join(artifacts, 'image-detail.png'), fullPage: true });
  await page.locator('.outputs img').first().click();
  await page.getByRole('dialog', { name: '图片大图' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  completed.push(
    'Image upload, local protocol decoding, gallery, immutable snapshots, new generation and large image',
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, source);
  await page
    .getByRole('button', { name: /^Skills/ })
    .first()
    .click();
  await page.getByRole('button', { name: '导入 Skill', exact: true }).click();
  await page.getByRole('button', { name: '选择文件夹并扫描', exact: true }).click();
  await page.getByText('smoke-review', { exact: true }).waitFor();
  await page.getByRole('button', { name: '导入收藏库', exact: true }).click();
  await page.getByRole('heading', { name: 'smoke-review', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'smoke-review', exact: true }).click();
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  await page.locator('input[name=tags]').fill('测试，审查');
  await page.getByRole('button', { name: '保存信息', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑 Skill 信息' }).waitFor({ state: 'hidden' });
  const destination = path.join(data, 'project');
  fs.mkdirSync(destination);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, destination);
  await page.getByRole('button', { name: '复制到项目', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已复制至' }).waitFor();
  assert.ok(fs.existsSync(path.join(destination, 'smoke-review', 'references', 'guide.md')));
  await page.getByRole('button', { name: '复制到项目', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '目标已存在' }).waitFor();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  completed.push(
    'Skill native picker, scan/select, import, edit tags, copy actual files and refuse overwrite',
  );
  await app.close();
  app = null;
  page = await launch();
  const state = await page.evaluate(() => window.vault.call('state'));
  assert.equal(state.prompts.length, 2);
  assert.equal(state.skills.length, 1);
  assert.equal(state.prompts.find((p) => p.kind === 'image').generations.length, 2);
  assert.equal(state.prompts.find((p) => p.kind === 'text').favorite, true);
  completed.push('Real Electron restart persistence');
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvault-backup-ui-'));
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, backups);
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '备份已保存' }).waitFor();
  assert.equal(fs.readdirSync(backups).length, 1);
  completed.push('Backup using native destination picker');
  await page.getByRole('button', { name: '文本 Prompt', exact: false }).first().click();
  await page.getByRole('heading', { name: '测试 · 代码审查', exact: true }).click();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 2);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '收藏已删除' }).waitFor();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 1);
  completed.push('Delete confirmation cancel and confirm branches');
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(artifacts, 'smoke-results.json'),
    JSON.stringify({ passed: true, completed, rendererErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, completed, rendererErrors: errors }, null, 2));
} catch (error) {
  console.error(error);
  if (app) {
    try {
      await (
        await app.firstWindow()
      ).screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
      console.error(await (await app.firstWindow()).locator('body').innerText());
    } catch {}
  }
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  console.log('Isolated test data:', data);
}
