import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-ui-'));
const artifacts = path.join(project, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const env = { ...process.env, AGENTVALUE_DATA_DIR: data };
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
    executablePath: process.env.AGENTVALUE_EXECUTABLE || undefined,
    args: process.env.AGENTVALUE_EXECUTABLE ? [] : [project],
    cwd: project,
    env,
    timeout: 60000,
  });
  if (process.env.AGENTVALUE_SMOKE_MOCK_CLIPBOARD === '1') {
    await app.evaluate(({ clipboard }) => {
      let text = '';
      clipboard.writeText = (value) => {
        text = value;
      };
      clipboard.readText = () => text;
    });
  }
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '今天', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: 'Prompt 管理', exact: true }).click();
  await page.getByRole('heading', { name: /Prompt 管理/ }).waitFor();
  return page;
}
try {
  let page = await launch();
  await page.screenshot({ path: path.join(artifacts, 'home.png'), fullPage: true });
  completed.push('Unified startup and expanded asset navigation');
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
  await page.getByRole('menuitem', { name: 'Prompt 管理', exact: true }).click();
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
  completed.push(
    `Text create, tags, favorite, full-text search and ${process.env.AGENTVALUE_SMOKE_MOCK_CLIPBOARD ? 'mocked' : 'actual'} clipboard`,
  );
  await page.getByRole('heading', { name: '测试 · 代码审查', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const template = '请用 {{语言}} 审查 {{主题}} 的并发边界。';
  await page.locator('textarea[name=content]').fill(template);
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('button', { name: '复制 Prompt', exact: true }).click();
  await page.getByRole('dialog', { name: '填写模板变量' }).waitFor();
  const templateDialog = page.getByRole('dialog', { name: '填写模板变量' });
  await templateDialog.getByRole('heading', { name: '原始提示词' }).waitFor();
  await templateDialog.getByRole('heading', { name: '填写内容' }).waitFor();
  assert.deepEqual(await templateDialog.locator('.template-slot').allTextContents(), [
    '{{语言}}',
    '{{主题}}',
  ]);
  assert.equal(await templateDialog.locator('.template-field').count(), 2);
  assert.equal(await page.getByRole('button', { name: '填写并复制' }).isDisabled(), true);
  await templateDialog.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    '请检查并发边界与异常处理。',
  );
  await page.getByRole('button', { name: '复制 Prompt', exact: true }).click();
  await page.getByLabel('语言', { exact: true }).fill('中文');
  assert.equal(await page.locator('.template-slot').first().textContent(), '中文');
  assert.equal(await page.locator('.template-slot').last().textContent(), '{{主题}}');
  await page.getByLabel('主题', { exact: true }).fill('队列');
  assert.deepEqual(await page.locator('.template-slot').allTextContents(), ['中文', '队列']);
  assert.equal(
    (await page.locator('.template-slot').first().getAttribute('class')).split(' ').at(-1),
    (await page.locator('.template-field').first().getAttribute('class')).split(' ').at(-1),
  );
  await page.screenshot({ path: path.join(artifacts, 'template-variables.png'), fullPage: true });
  await page.getByRole('button', { name: '填写并复制', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已填写变量并复制' }).waitFor();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    '请用 中文 审查 队列 的并发边界。',
  );
  assert.equal(
    (await page.evaluate(() => window.vault.call('state'))).prompts[0].content,
    template,
  );
  await page
    .getByRole('dialog', { name: '收藏详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  completed.push(
    `Template variables: cancel, required values, live fill, ${process.env.AGENTVALUE_SMOKE_MOCK_CLIPBOARD ? 'mocked' : 'actual'} clipboard and original preservation`,
  );
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await page.getByRole('menuitem', { name: '图片提示词', exact: true }).click();
  await page.getByRole('button', { name: '新增 Prompt', exact: true }).click();
  await page.locator('input[name=title]').fill('测试 · 图片实验');
  await page.locator('textarea[name=content]').fill('A watercolor lake. Original snapshot.');
  await page.locator('input[name=tags]').fill('水彩，测试');
  const secondFixture = path.join(data, 'second-reference.png');
  fs.copyFileSync(fixture, secondFixture);
  await page
    .locator('.upload-group')
    .filter({ hasText: '参考图' })
    .locator('input[type=file]')
    .setInputFiles([fixture, secondFixture]);
  await page
    .locator('.upload-group')
    .filter({ hasText: '效果图' })
    .locator('input[type=file]')
    .setInputFiles(fixture);
  await page.locator('input[name=model]').fill('测试模型');
  await page.locator('input[name=ratio]').fill('16:9');
  await page.getByRole('radio', { name: '4 星', exact: true }).click();
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('heading', { name: '测试 · 图片实验', exact: true }).waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.card-image img')).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  assert.equal(
    await page
      .locator('.card-image img')
      .first()
      .evaluate((img) => img.naturalWidth <= 480),
    true,
  );
  assert.ok(fs.readdirSync(path.join(data, 'thumbnails')).length > 0);
  await page.screenshot({ path: path.join(artifacts, 'gallery.png'), fullPage: true });
  await page.getByRole('heading', { name: '测试 · 图片实验', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('textarea[name=content]').fill('Revised watercolor lake.');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByText('Revised watercolor lake.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看本次 Prompt 快照', exact: true }).first().click();
  await page.getByText('A watercolor lake. Original snapshot.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '记录新实验', exact: true }).click();
  await page
    .locator('.upload-group')
    .filter({ hasText: '效果图' })
    .locator('input[type=file]')
    .setInputFiles(fixture);
  await page.locator('input[name=model]').fill('第二模型');
  await page.getByRole('radio', { name: '5 星', exact: true }).click();
  await page.getByRole('button', { name: '保存实验', exact: true }).click();
  await page
    .getByRole('dialog', { name: '收藏详情' })
    .getByText('第二模型', { exact: true })
    .waitFor();
  await page.locator('.drawer-content').evaluate((el) => (el.scrollTop = 0));
  const references = page.locator('.media-grid:not(.outputs)');
  await references
    .getByRole('button', { name: '设为封面 second-reference.png', exact: true })
    .click();
  await references.getByText('✓ 封面', { exact: true }).waitFor();
  await references.getByRole('button', { name: '前移 second-reference.png', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.media-grid:not(.outputs) .image-name')?.textContent ===
      'second-reference.png',
  );
  await page.screenshot({ path: path.join(artifacts, 'image-management.png'), fullPage: true });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  await references
    .getByRole('button', { name: '移除图片 second-reference.png', exact: true })
    .click();
  assert.equal(await references.locator('.managed-image').count(), 2);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await references
    .getByRole('button', { name: '移除图片 second-reference.png', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('.media-grid:not(.outputs) .managed-image').length === 1,
  );
  const imageState = (await page.evaluate(() => window.vault.call('state'))).prompts.find(
    (p) => p.kind === 'image',
  );
  assert.equal(imageState.cover_id, null);
  assert.equal(imageState.generations.length, 2);
  completed.push(
    'Native thumbnails, cover selection, persisted image ordering and individual removal confirmation',
  );
  await page.screenshot({ path: path.join(artifacts, 'image-detail.png'), fullPage: true });
  await page.locator('.outputs img').first().click();
  await page.locator('.ant-image-preview').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('.ant-image-preview').waitFor({ state: 'hidden' });
  await page
    .getByRole('dialog', { name: '收藏详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  completed.push(
    'Image upload, local protocol decoding, gallery, immutable snapshots, new generation and large image',
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, source);
  await page.getByRole('menuitem', { name: 'Skill 管理', exact: true }).first().click();
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
  await page.getByRole('alert').filter({ hasText: '目标已存在' }).first().waitFor();
  await page
    .getByRole('dialog', { name: '收藏详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
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
  await page.getByRole('menuitem', { name: '今天', exact: true }).click();
  await page.getByRole('textbox', { name: '快速记录事项' }).fill('测试 · 真实事项');
  await page.getByRole('textbox', { name: '快速记录事项' }).press('Enter');
  await page.waitForFunction(async () =>
    (await window.vault.call('assistantState')).tasks.some(
      (task) => task.title === '测试 · 真实事项',
    ),
  );
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await page.waitForFunction(async () => {
    const state = await window.vault.call('assistantState');
    return state.timer.startedAt && Date.now() - state.timer.startedAt >= 1500;
  });
  await app.close();
  app = null;
  page = await launch();
  await page.getByRole('menuitem', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '记录执行小计', exact: true }).click();
  await page.locator('textarea[name=summary]').fill('真实计时与重启后的执行成果');
  await page.getByRole('button', { name: '保存小计', exact: true }).click();
  await page.waitForFunction(async () =>
    (await window.vault.call('assistantState')).logs.some(
      (log) => log.summary === '真实计时与重启后的执行成果' && log.seconds > 0,
    ),
  );
  await page.getByRole('menuitem', { name: '每日回顾', exact: true }).click();
  await page.getByRole('button', { name: '生成今日回顾', exact: true }).click();
  await page.getByRole('textbox', { name: '每日回顾正文' }).waitFor();
  assert.match(
    await page.getByRole('textbox', { name: '每日回顾正文' }).inputValue(),
    /真实计时与重启后的执行成果/,
  );
  await page.getByRole('button', { name: '保存回顾', exact: true }).click();
  await page.getByRole('menuitem', { name: '日历与目标', exact: true }).click();
  await page.getByRole('button', { name: '新增目标', exact: true }).click();
  await page
    .getByRole('dialog', { name: '月度目标' })
    .getByRole('textbox', { name: '目标名称' })
    .fill('测试 · 月度交付');
  await page.getByRole('button', { name: '保存目标', exact: true }).click();
  await page.waitForFunction(async () => {
    const state = await window.vault.call('assistantState');
    return (
      state.goals.some((goal) => goal.title === '测试 · 月度交付') &&
      Object.keys(state.savedReviews).length === 1
    );
  });
  completed.push(
    'Assistant title-only capture, persisted timer across restart, real execution log, generated and saved daily review, monthly goal',
  );
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-backup-ui-'));
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, backups);
  await page.getByRole('button', { name: '资产库设置', exact: true }).click();
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '备份已保存' }).waitFor();
  assert.equal(fs.readdirSync(backups).length, 1);
  completed.push('Backup using native destination picker');
  await page.getByRole('menuitem', { name: 'Prompt 管理', exact: true }).click();
  await page.getByRole('heading', { name: '测试 · 代码审查', exact: true }).click();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 2);
  const restoredAssistant = await page.evaluate(() => window.vault.call('assistantState'));
  assert.equal(restoredAssistant.tasks.length, 1);
  assert.equal(restoredAssistant.logs.length, 1);
  assert.equal(restoredAssistant.goals.length, 1);
  assert.equal(Object.keys(restoredAssistant.savedReviews).length, 1);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '删除收藏', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '收藏已删除' }).waitFor();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 1);
  completed.push('Delete confirmation cancel and confirm branches');
  await page.getByRole('menuitem', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: /测试 · 真实事项 未分类/ }).click();
  await page.getByRole('button', { name: '删除事项', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除事项' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const state = await window.vault.call('assistantState');
    return state.tasks.length === 0 && state.logs.length === 0;
  });
  const backupFolder = path.join(backups, fs.readdirSync(backups)[0]);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, backupFolder);
  await page.getByRole('button', { name: '资产库设置', exact: true }).click();
  await page.getByRole('button', { name: '选择备份并恢复', exact: true }).click();
  await page.getByRole('dialog', { name: '恢复收藏库' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '确认恢复', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 1);
  await page.getByRole('button', { name: '选择备份并恢复', exact: true }).click();
  await page.getByRole('checkbox', { name: '我确认用此备份替换全部助手记录和资产' }).check();
  await page.screenshot({ path: path.join(artifacts, 'restore-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByRole('heading', { name: '今天', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 2);
  const recoveryRoot = data + '-recovery';
  assert.equal(fs.readdirSync(recoveryRoot).length, 1);
  await app.close();
  app = null;
  page = await launch();
  assert.equal((await page.evaluate(() => window.vault.call('state'))).prompts.length, 2);
  completed.push(
    'Restore preview, cancel, explicit confirmation, pre-restore backup and restart persistence',
  );
  await page.getByRole('menuitem', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: /测试 · 真实事项 未分类/ }).waitFor();
  await page.screenshot({
    path: path.join(artifacts, 'assistant-real-window.png'),
    fullPage: true,
  });
  const downloads = path.join(data, 'downloads');
  fs.mkdirSync(downloads);
  await app.evaluate(({ BrowserWindow }, folder) => {
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_event, item) =>
      item.setSavePath(folder + '/' + item.getFilename()),
    );
  }, downloads);
  const downloadSaved = (name) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        watcher.close();
        reject(new Error('Download not completed: ' + name));
      }, 15000);
      const watcher = fs.watch(downloads, () => {
        if (fs.existsSync(path.join(downloads, name))) {
          clearTimeout(timer);
          watcher.close();
          resolve();
        }
      });
    });
  await page.getByRole('menuitem', { name: '日历与目标', exact: true }).click();
  const calendarDownload = downloadSaved('AgentValue-日历.ics');
  await page.getByRole('button', { name: '导出日历', exact: true }).click();
  await calendarDownload;
  assert.match(
    fs.readFileSync(path.join(downloads, 'AgentValue-日历.ics'), 'utf8'),
    /BEGIN:VCALENDAR/,
  );
  const calendarFixture = path.join(data, 'calendar-fixture.ics');
  fs.writeFileSync(
    calendarFixture,
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fixture//EN\r\nBEGIN:VEVENT\r\nUID:native-test\r\nDTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008\r\nSUMMARY:测试 · 日历导入\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  );
  await page.getByRole('button', { name: '导入日历', exact: true }).click();
  await page
    .getByRole('dialog', { name: '导入日历' })
    .locator('input[type=file]')
    .setInputFiles(calendarFixture);
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.waitForFunction(async () =>
    (await window.vault.call('assistantState')).tasks.some((t) => t.title === '测试 · 日历导入'),
  );
  await page.getByRole('button', { name: '导入日历', exact: true }).click();
  await page
    .getByRole('dialog', { name: '导入日历' })
    .locator('input[type=file]')
    .setInputFiles(calendarFixture);
  await page.getByText('新增 0 项 · 跳过 1 项', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '确认导入', exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole('dialog', { name: '导入日历' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: '新增目标', exact: true }).click();
  await page
    .getByRole('dialog', { name: '月度目标' })
    .getByRole('textbox', { name: '目标名称' })
    .fill('测试 · 年度目标');
  await page.getByRole('combobox', { name: '目标周期' }).click();
  await page.getByRole('option', { name: '年度目标', exact: true }).click();
  await page.getByRole('dialog', { name: '年度目标' }).waitFor();
  await page.getByRole('button', { name: '保存目标', exact: true }).click();
  await page.waitForFunction(async () =>
    (await window.vault.call('assistantState')).goals.some(
      (g) => g.period === 'year' && g.title === '测试 · 年度目标',
    ),
  );
  await page.getByRole('menuitem', { name: '每日回顾', exact: true }).click();
  await page.getByRole('button', { name: '周回顾', exact: true }).click();
  assert.match(
    await page.getByRole('textbox', { name: '周期回顾正文' }).inputValue(),
    /真实计时与重启后的执行成果/,
  );
  await page
    .getByRole('dialog', { name: '周期回顾' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  const csvDownload = downloadSaved('AgentValue-计划与执行.csv');
  await page.getByRole('button', { name: '导出记录', exact: true }).click();
  await csvDownload;
  assert.match(
    fs.readFileSync(path.join(downloads, 'AgentValue-计划与执行.csv'), 'utf8'),
    /真实计时与重启后的执行成果/,
  );
  assert.equal(
    await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('CommandOrControl+Shift+Space'),
    ),
    true,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('agentvalue:quick-capture'),
  );
  await page.getByRole('dialog', { name: '快速新增' }).waitFor();
  await page
    .getByRole('dialog', { name: '快速新增' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  completed.push(
    'V2 native ICS upload/preview/import, duplicate prevention, actual ICS/CSV downloads, annual goal, weekly review, quick capture bridge and tray close behavior',
  );
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
