const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Vault, within } = require('./store.cjs');
const { inventory } = require('./backup.cjs');
const { zipFiles } = require('./zip-export.cjs');
const { version } = require('../package.json');
const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};
function createLocalServer({ root, dist, port = 5173 }) {
  const vault = new Vault(root),
    token = randomBytes(32).toString('hex'),
    uploads = new Map(),
    downloads = new Map();
  const working = path.join(vault.root, 'staging', `web-${randomUUID()}`);
  fs.mkdirSync(working);
  const siblingBackups = path.join(path.dirname(vault.root), 'backups');
  fs.mkdirSync(siblingBackups, { recursive: true });
  const json = (res, data, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const file = (res, absolute, mime) => {
    res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(absolute).pipe(res);
  };
  const decode = (base64, limit) => {
    ensure(typeof base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(base64), '文件编码无效');
    const bytes = Buffer.from(base64, 'base64');
    ensure(bytes.length <= limit, '文件过大');
    return bytes;
  };
  const consumeImages = (input) => {
    const images = (list = []) =>
      list.map((key) => {
        ensure(uploads.has(key), '图片上传已过期，请重新选择');
        return uploads.get(key);
      });
    return {
      ...input,
      references: images(input.references),
      outputs: images(input.outputs),
      ...(input.generation
        ? { generation: { ...input.generation, outputs: images(input.generation.outputs) } }
        : {}),
    };
  };
  const download = (bytes, name, type) => {
    const key = randomUUID();
    downloads.set(key, { bytes, name, type });
    return { download: `/api/download/${key}`, name };
  };
  let maintenance = false,
    active = 0;
  async function call(operation, input = {}) {
    ensure(!maintenance, '正在备份或恢复，请稍后再试');
    switch (operation) {
      case 'state': {
        const state = vault.state();
        const media = (i) => ({ ...i, url: `/api/media/${i.id}`, thumbnail: `/api/media/${i.id}` });
        return {
          ...state,
          prompts: state.prompts.map((p) => ({
            ...p,
            images: p.images.map(media),
            generations: p.generations.map((g) => ({ ...g, images: g.images.map(media) })),
          })),
        };
      }
      case 'assistantState':
        return vault.assistantState();
      case 'syncExport': {
        ensure(active === 1 && !vault.busy.size, '请等待其他操作完成后再导入');
        maintenance = true;
        try {
          return await require('./sync-export.cjs').syncExport(vault, siblingBackups);
        } finally {
          maintenance = false;
        }
      }
      case 'assistantSave':
        return vault.assistantSave(input);
      case 'savePrompt':
        return vault.savePrompt(consumeImages(input));
      case 'addGeneration':
        return vault.addGeneration(consumeImages(input));
      case 'favorite':
        vault.favorite(input.kind, input.id);
        return true;
      case 'delete':
        vault.remove(input.kind, input.id);
        return true;
      case 'manageImage':
        return vault.manageImage(input);
      case 'copy':
        if (input.id) vault.used(input.id);
        return true;
      case 'uploadImage': {
        ensure(
          typeof input.name === 'string' && /\.(png|jpe?g|webp|gif)$/i.test(input.name),
          '仅支持 PNG、JPG、WebP、GIF',
        );
        const key = randomUUID(),
          folder = path.join(working, key);
        fs.mkdirSync(folder);
        const target = path.join(folder, input.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-'));
        fs.writeFileSync(target, decode(input.base64, 30 * 1024 ** 2));
        uploads.set(key, target);
        return key;
      }
      case 'scanLocal': {
        ensure(
          Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 10000,
          '请选择 Skill 文件夹',
        );
        const directory = path.join(working, randomUUID());
        fs.mkdirSync(directory);
        let total = 0;
        for (const entry of input.files) {
          ensure(
            typeof entry.path === 'string' &&
              !entry.path.split(/[\\/]/).some((s) => !s || s === '.' || s === '..') &&
              !/[:\x00-\x1f]/.test(entry.path),
            '文件路径无效',
          );
          const target = path.resolve(directory, entry.path);
          ensure(within(directory, target), '文件路径越界');
          const bytes = decode(entry.base64, 200 * 1024 ** 2);
          total += bytes.length;
          ensure(total <= 200 * 1024 ** 2, '目录超过 200 MB');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bytes);
        }
        return vault.scanLocal(directory);
      }
      case 'scanGithub':
        return vault.scanGithub(input.url);
      case 'importSkills':
        return vault.importSkills(input.token, input.keys);
      case 'saveSkill':
        vault.saveSkill(input);
        return true;
      case 'checkUpdate':
        return vault.checkUpdate(input.id);
      case 'updateSkill':
        return vault.updateSkill(input.id);
      case 'exportSkill': {
        const skill = vault.skill(input.id),
          files = [];
        const name = skill.name.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '') || 'skill';
        for (const relative of skill.files ? JSON.parse(skill.files) : []) {
          const absolute = path.resolve(skill.directory, relative);
          ensure(within(skill.directory, absolute), '文件路径无效');
          files.push({ name: `${name}/${relative}`, bytes: fs.readFileSync(absolute) });
        }
        return download(zipFiles(files), `${name}.zip`, 'application/zip');
      }
      case 'openData':
        return vault.root;
      case 'openSkill':
        return vault.skill(input.id).directory;
      case 'backup': {
        ensure(active === 1 && !vault.busy.size, '请等待其他操作完成后再备份');
        maintenance = true;
        try {
          const target = await vault.exportBackup(siblingBackups);
          const files = {};
          for (const relative of [
            ...Object.keys(inventory(target).files),
            'manifest.json',
            'catalog.json',
          ])
            files[relative] = fs.readFileSync(path.join(target, relative)).toString('base64');
          return {
            ...download(
              Buffer.from(JSON.stringify({ app: 'AgentValue-Archive', files })),
              `${path.basename(target)}.json`,
              'application/json',
            ),
            path: target,
          };
        } finally {
          maintenance = false;
        }
      }
      case 'inspectBackup': {
        ensure(active === 1 && !vault.busy.size, '请等待其他操作完成后再恢复');
        const archive = input.archive;
        ensure(
          archive?.app === 'AgentValue-Archive' &&
            archive.files &&
            typeof archive.files === 'object' &&
            !Array.isArray(archive.files),
          '请选择 AgentValue 导出的备份文件',
        );
        const directory = path.join(siblingBackups, `uploaded-${randomUUID()}`);
        fs.mkdirSync(directory);
        for (const part of ['skills', 'images/references', 'images/outputs'])
          fs.mkdirSync(path.join(directory, part), { recursive: true });
        let total = 0;
        ensure(Object.keys(archive.files).length <= 100000, '备份文件过多');
        for (const [relative, base64] of Object.entries(archive.files)) {
          ensure(
            !relative.split(/[\\/]/).some((s) => !s || s === '.' || s === '..') &&
              !/[:\x00-\x1f]/.test(relative),
            '备份路径无效',
          );
          const target = path.resolve(directory, relative);
          ensure(within(directory, target), '备份路径越界');
          const bytes = decode(base64, 512 * 1024 ** 2);
          total += bytes.length;
          ensure(total <= 512 * 1024 ** 2, '浏览器备份超过 512 MB，请使用桌面版恢复');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bytes);
        }
        return vault.inspectBackup(directory);
      }
      case 'restoreBackup':
        ensure(active === 1, '请等待其他操作完成后再恢复');
        maintenance = true;
        try {
          return await vault.restoreBackup();
        } finally {
          maintenance = false;
        }
      case 'softwareStatus':
        return {
          currentVersion: version,
          phase: 'unavailable',
          message: '本地浏览器版；安装程序更新和数据目录迁移请使用桌面版。',
        };
      case 'chooseDataLocation':
        throw new Error(
          '数据目录迁移请使用桌面版；本地服务可通过 AGENTVALUE_DATA_DIR 指定现有数据目录。',
        );
      default:
        throw new Error('此操作需要使用 AgentValue 桌面版');
    }
  }
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`,
      allowed = [`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`];
    if (
      !allowed.includes(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return json(res, { ok: false, error: '无效来源' }, 403);
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, { token });
      if (req.method === 'POST' && url.pathname === '/api/call') {
        ensure(req.headers['x-agentvalue-token'] === token, '无效会话');
        ensure(req.headers['content-type']?.includes('application/json'), '请求格式无效');
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          ensure(size <= 720 * 1024 ** 2, '请求内容过大');
          chunks.push(chunk);
        }
        const { operation, input } = JSON.parse(Buffer.concat(chunks).toString());
        active++;
        try {
          return json(res, { ok: true, data: await call(operation, input) });
        } finally {
          active--;
        }
      }
      if (req.method === 'GET' && /^\/api\/media\/[\w-]+$/.test(url.pathname)) {
        const absolute = vault.media(url.pathname.split('/').pop());
        const ext = path.extname(absolute).slice(1);
        return file(res, absolute, ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
        const item = downloads.get(url.pathname.split('/').pop());
        ensure(item, '下载已过期，请重新导出');
        res.writeHead(200, {
          'Content-Type': item.type,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
          'Cache-Control': 'no-store',
        });
        return res.end(item.bytes);
      }
      if (url.pathname.startsWith('/api/'))
        return json(res, { ok: false, error: '未找到接口' }, 404);
      ensure(req.method === 'GET' || req.method === 'HEAD', '请求方法无效');
      const relative = decodeURIComponent(url.pathname),
        absolute = path.resolve(dist, `.${relative}`);
      ensure(within(dist, absolute) || absolute === path.resolve(dist), '路径无效');
      const target =
        fs.existsSync(absolute) && fs.statSync(absolute).isFile()
          ? absolute
          : path.join(dist, 'index.html');
      const mime =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.pdf': 'application/pdf',
        }[path.extname(target)] || 'application/octet-stream';
      file(res, target, mime);
    } catch (error) {
      json(res, { ok: false, error: error.message || '操作失败' }, 400);
    }
  });
  server.on('close', () => vault.close());
  return {
    server,
    vault,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address()));
      }),
  };
}
module.exports = { createLocalServer };
