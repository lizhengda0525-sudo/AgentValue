const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const parts = ['agentvault.db', 'skills', 'images'];
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
function writeJournal(file, value) {
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function hashFile(file) {
  const hash = createHash('sha256'),
    buffer = Buffer.alloc(256 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
function safeFile(root, relative) {
  ensure(typeof relative === 'string' && relative.length > 0, '备份路径无效');
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  ensure(rel && !rel.startsWith('..') && !path.isAbsolute(rel), '备份路径越界');
  let current = root;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    ensure(!fs.lstatSync(current).isSymbolicLink(), '备份不能包含符号链接');
  }
  return resolved;
}
function inventory(root) {
  const files = {};
  let total = 0,
    count = 0;
  function walk(relative) {
    const file = safeFile(root, relative),
      stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) walk(`${relative}/${name}`);
    } else {
      ensure(stat.isFile(), '备份包含非普通文件');
      total += stat.size;
      ensure(++count <= 100000 && total <= 10 * 1024 ** 3, '备份超过 100000 个文件或 10 GB');
      files[relative] = hashFile(file);
    }
  }
  for (const part of parts) walk(part);
  return { files, bytes: total };
}
function inspectBackup(source) {
  ensure(
    fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink(),
    '请选择普通备份目录',
  );
  const root = fs.realpathSync(source);
  const manifestPath = safeFile(root, 'manifest.json');
  ensure(fs.statSync(manifestPath).size < 20 * 1024 ** 2, '备份清单过大');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ensure(
    manifest.app === 'AgentVault' && [1, 2].includes(manifest.schema),
    '不支持的备份格式或版本',
  );
  for (const suffix of ['-wal', '-shm'])
    ensure(
      !fs.existsSync(path.join(root, 'agentvault.db' + suffix)),
      '备份含有 WAL/SHM 文件，请重新导出完整备份',
    );
  const contents = inventory(root);
  if (manifest.checksums) {
    ensure(
      JSON.stringify(Object.keys(contents.files).sort()) ===
        JSON.stringify(Object.keys(manifest.checksums).sort()),
      '备份文件清单不一致',
    );
    for (const [file, hash] of Object.entries(contents.files))
      ensure(manifest.checksums[file] === hash, `备份校验失败：${file}`);
  }
  // SQLite may create WAL/SHM even for a read-only connection. Inspect a disposable copy.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvault-inspect-'));
  let db;
  try {
    const database = path.join(scratch, 'agentvault.db');
    fs.copyFileSync(path.join(root, 'agentvault.db'), database);
    ensure(hashFile(database) === contents.files['agentvault.db'], '校验期间数据库发生变化');
    db = new DatabaseSync(database, { readOnly: true });
    const version = db.prepare('PRAGMA user_version').get().user_version;
    ensure(version === manifest.schema, '清单与数据库版本不一致');
    ensure(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', '备份数据库损坏');
    ensure(!db.prepare('PRAGMA foreign_key_check').all().length, '备份存在失效的数据引用');
    ensure(
      !db.prepare("SELECT name FROM sqlite_master WHERE type IN ('view','trigger')").all().length,
      '备份含有不支持的数据库对象',
    );
    const prompts = db.prepare('SELECT * FROM prompts').all();
    const generations = db.prepare('SELECT * FROM generations').all();
    const images = db.prepare('SELECT * FROM images').all();
    const skills = db.prepare('SELECT * FROM skills').all();
    const array = (s) => {
      const v = JSON.parse(s);
      ensure(Array.isArray(v) && v.every((x) => typeof x === 'string'), '备份数组字段无效');
      return v;
    };
    for (const p of prompts) {
      ensure(
        ['text', 'image'].includes(p.kind) &&
          typeof p.content === 'string' &&
          typeof p.title === 'string',
        '备份 Prompt 无效',
      );
      array(p.tags);
    }
    for (const i of images) {
      ensure(
        /^images[\\/]/.test(i.path) && fs.statSync(safeFile(root, i.path)).isFile(),
        '备份图片缺失',
      );
      ensure(['reference', 'output'].includes(i.role), '图片角色无效');
      if (i.generation_id)
        ensure(
          generations.some((g) => g.id === i.generation_id && g.prompt_id === i.prompt_id),
          '实验图片引用不一致',
        );
    }
    for (const s of skills) {
      array(s.tags);
      ensure(/^skills[\\/]/.test(s.directory), 'Skill 目录无效');
      const dir = safeFile(root, s.directory);
      ensure(fs.statSync(safeFile(dir, 'SKILL.md')).isFile(), '备份 Skill 缺失');
      for (const file of array(s.files))
        ensure(fs.statSync(safeFile(dir, file)).isFile(), '备份 Skill 文件缺失');
    }
    return {
      root,
      schema: version,
      createdAt: manifest.createdAt,
      verified: !!manifest.checksums,
      bytes: contents.bytes,
      counts: {
        prompts: prompts.length,
        skills: skills.length,
        images: images.length,
        generations: generations.length,
      },
      fingerprint: createHash('sha256').update(JSON.stringify(contents.files)).digest('hex'),
    };
  } finally {
    db?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
// Only these fixed managed paths participate in the swap. Electron userData and caches stay open.
function recoverRestore(root) {
  const journal = path.join(root, 'restore-journal.json');
  if (!fs.existsSync(journal)) return;
  const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
  ensure(/^restore-[a-f0-9-]{36}$/.test(record.stage), '恢复日志无效');
  const stage = safeFile(root, `staging/${record.stage}`);
  if (!record.committed) {
    for (const part of parts) {
      const old = path.join(stage, 'previous', part),
        live = path.join(root, part);
      if (fs.existsSync(old)) {
        fs.rmSync(live, { recursive: true, force: true });
        fs.renameSync(old, live);
      }
    }
    for (const suffix of ['-wal', '-shm'])
      fs.rmSync(path.join(root, 'agentvault.db' + suffix), { force: true });
  }
  fs.unlinkSync(journal);
  fs.rmSync(stage, { recursive: true, force: true });
}
module.exports = { parts, safeFile, inventory, inspectBackup, recoverRestore, writeJournal };
