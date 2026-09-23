const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parse } = require('yaml');
const {
  databaseFile,
  parts,
  inventory,
  inspectBackup,
  recoverRestore,
  writeJournal,
} = require('./backup.cjs');
const run = promisify(execFile);
const now = () => new Date().toISOString();
const id = () => randomUUID();
const text = (value, max = 200000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const tags = (value) =>
  [...new Set((Array.isArray(value) ? value : []).map((v) => text(v, 50)).filter(Boolean))].slice(
    0,
    30,
  );
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function within(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}
function scanFiles(root) {
  assert(
    fs.existsSync(root) && fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(),
    '请选择普通文件夹',
  );
  const result = [];
  let bytes = 0;
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(item.name)) continue;
      const absolute = path.join(dir, item.name);
      const stat = fs.lstatSync(absolute);
      assert(!stat.isSymbolicLink(), '为保证副本独立，暂不支持包含符号链接的目录');
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        bytes += stat.size;
        result.push(path.relative(root, absolute));
        assert(
          result.length <= 10000 && bytes <= 200 * 1024 * 1024,
          '目录过大：最多 10000 个文件、200 MB',
        );
      }
    }
  }
  walk(root);
  return result;
}
function skillInfo(root) {
  const files = scanFiles(root);
  assert(files.includes('SKILL.md'), '文件夹中没有 SKILL.md');
  assert(fs.statSync(path.join(root, 'SKILL.md')).size <= 2 * 1024 * 1024, 'SKILL.md 超过 2 MB');
  const content = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const header = content.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let meta = {};
  if (header) {
    try {
      meta = parse(header[1], { maxAliasCount: 20 }) || {};
    } catch {
      /* readable even with invalid frontmatter */
    }
  }
  return {
    name: text(meta.name, 120) || path.basename(root),
    description: text(meta.description, 2000),
    content,
    files,
  };
}
function copySkill(source, target) {
  const files = scanFiles(source);
  assert(!fs.existsSync(target), '目标已存在，为避免覆盖请换一个目录');
  assert(!within(source, target), '目标不能位于源 Skill 内部');
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const file of files) {
      const dest = path.join(target, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(source, file), dest, fs.constants.COPYFILE_EXCL);
    }
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    throw e;
  }
}
function treeHash(root) {
  const digest = createHash('sha256');
  for (const file of scanFiles(root).sort()) {
    digest.update(file.split(path.sep).join('/'));
    digest.update('\0');
    digest.update(
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest(),
    );
  }
  return digest.digest('hex');
}
async function git(args, cwd) {
  try {
    const r = await run(
      'git',
      ['-c', 'core.hooksPath=NUL', '-c', 'protocol.file.allow=never', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_LFS_SKIP_SMUDGE: '1',
          GCM_INTERACTIVE: 'never',
        },
      },
    );
    return r.stdout.trim();
  } catch (e) {
    throw new Error(
      e.code === 'ENOENT'
        ? '未找到 Git，请先安装 Git 并重启应用'
        : 'Git 操作失败，请检查仓库地址和网络连接。' + (e.killed ? '（操作超时）' : ''),
    );
  }
}
class Vault {
  constructor(root) {
    this.root = path.resolve(root);
    this.sessions = new Map();
    this.busy = new Set();
    fs.mkdirSync(this.root, { recursive: true });
    recoverRestore(this.root);
    for (const dir of ['', 'skills', 'images/references', 'images/outputs', 'git', 'staging'])
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    this.root = fs.realpathSync(root);
    this.openDatabase();
    this.recoverImports();
  }
  openDatabase() {
    this.db = new DatabaseSync(path.join(this.root, databaseFile));
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) {
      this.db.close();
      throw new Error('此数据目录来自更新版本，请使用新版 AgentValue 打开');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('text','image')), title TEXT NOT NULL, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, used_at TEXT);
      CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE, snapshot TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', ratio TEXT NOT NULL DEFAULT '', parameters TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE, generation_id TEXT REFERENCES generations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('reference','output')), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, repo TEXT NOT NULL DEFAULT '', relative_path TEXT NOT NULL DEFAULT '', commit_hash TEXT NOT NULL DEFAULT '', latest_commit TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL, files TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS gen_prompt ON generations(prompt_id);
      CREATE INDEX IF NOT EXISTS image_prompt ON images(prompt_id);
      `);
    if (
      !this.db
        .prepare('PRAGMA table_info(skills)')
        .all()
        .some((c) => c.name === 'tree_hash')
    )
      this.db.exec("ALTER TABLE skills ADD COLUMN tree_hash TEXT NOT NULL DEFAULT ''");
    if (version < 2) {
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE prompts ADD COLUMN cover_id TEXT;
        ALTER TABLE images ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version=2;
        COMMIT;`);
    }
  }
  recoverImports() {
    const folder = path.join(this.root, 'staging');
    for (const file of fs
      .readdirSync(folder)
      .filter((f) => /^import-[a-f0-9-]{36}\.json$/.test(f))) {
      const journal = path.join(folder, file);
      const paths = JSON.parse(fs.readFileSync(journal, 'utf8'));
      for (const relative of paths) {
        assert(
          /^(images\/(references|outputs)\/[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif)|skills\/[a-f0-9-]{36})$/.test(
            relative,
          ),
          '导入恢复日志无效',
        );
        const exists = relative.startsWith('images/')
          ? this.db.prepare('SELECT id FROM images WHERE path=?').get(relative)
          : this.db.prepare('SELECT id FROM skills WHERE directory=?').get(relative);
        if (!exists) fs.rmSync(path.join(this.root, relative), { recursive: true, force: true });
      }
      fs.unlinkSync(journal);
    }
  }
  trackImport(relative) {
    assert(this.importJournal, '文件导入必须位于事务中');
    this.importPaths.push(relative);
    writeJournal(this.importJournal, this.importPaths);
  }
  transaction(fn) {
    assert(!this.importJournal, '不支持嵌套事务');
    this.importPaths = [];
    this.importJournal = path.join(this.root, 'staging', `import-${id()}.json`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.importJournal = null;
      this.recoverImports();
    }
  }
  state() {
    const images = this.db
      .prepare('SELECT * FROM images ORDER BY position, rowid')
      .all()
      .map((row) => ({
        ...row,
        url: `vault://media/${row.id}`,
        thumbnail: `vault://media/${row.id}?thumbnail=1`,
      }));
    const generations = this.db
      .prepare('SELECT * FROM generations ORDER BY created_at DESC, rowid DESC')
      .all();
    return {
      prompts: this.db
        .prepare('SELECT * FROM prompts ORDER BY updated_at DESC, rowid DESC')
        .all()
        .map((p) => ({
          ...p,
          tags: JSON.parse(p.tags),
          favorite: !!p.favorite,
          images: images.filter((i) => i.prompt_id === p.id),
          generations: generations
            .filter((g) => g.prompt_id === p.id)
            .map((g) => ({ ...g, images: images.filter((i) => i.generation_id === g.id) })),
        })),
      skills: this.db
        .prepare('SELECT * FROM skills ORDER BY updated_at DESC')
        .all()
        .map((s) => ({
          ...s,
          tags: JSON.parse(s.tags),
          files: JSON.parse(s.files),
          favorite: !!s.favorite,
        })),
      root: this.root,
      schema: 2,
    };
  }
  savePrompt(input) {
    const title = text(input.title, 160),
      content = text(input.content);
    assert(title && content, '请填写标题和 Prompt 正文');
    const old = input.id ? this.db.prepare('SELECT * FROM prompts WHERE id=?').get(input.id) : null;
    assert(!input.id || old, 'Prompt 不存在');
    const kind = old?.kind || input.kind;
    assert(['text', 'image'].includes(kind), '类型无效');
    const promptId = old?.id || id();
    const time = now();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO prompts(id,kind,title,content,category,tags,notes,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,category=excluded.category,tags=excluded.tags,notes=excluded.notes,updated_at=excluded.updated_at`,
        )
        .run(
          promptId,
          kind,
          title,
          content,
          text(input.category, 80),
          JSON.stringify(tags(input.tags)),
          text(input.notes, 10000),
          old?.favorite || 0,
          old?.created_at || time,
          time,
        );
      if (kind === 'image') {
        this.addImages(promptId, null, 'reference', input.references || []);
        if (input.generation) this.insertGeneration(promptId, content, input.generation);
      }
    });
    return promptId;
  }
  importImage(source, role) {
    assert(typeof source === 'string' && path.isAbsolute(source), '图片路径无效');
    const stat = fs.lstatSync(source);
    assert(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 30 * 1024 * 1024,
      '图片必须是小于 30 MB 的普通文件',
    );
    const ext = path.extname(source).toLowerCase();
    assert(
      ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext),
      '支持 PNG、JPG、WebP、GIF 图片',
    );
    const head = Buffer.alloc(12);
    const fd = fs.openSync(source, 'r');
    try {
      fs.readSync(fd, head, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
    const valid =
      (ext === '.png' &&
        head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (['.jpg', '.jpeg'].includes(ext) && head[0] === 255 && head[1] === 216 && head[2] === 255) ||
      (ext === '.gif' && /^GIF8[79]a/.test(head.toString('ascii'))) ||
      (ext === '.webp' &&
        head.toString('ascii', 0, 4) === 'RIFF' &&
        head.toString('ascii', 8, 12) === 'WEBP');
    assert(valid, '图片格式与文件内容不符');
    const imageId = id();
    const relative = `images/${role === 'reference' ? 'references' : 'outputs'}/${imageId}${ext}`;
    this.trackImport(relative);
    fs.copyFileSync(source, path.join(this.root, relative), fs.constants.COPYFILE_EXCL);
    return { id: imageId, path: relative, name: path.basename(source) };
  }
  addImages(promptId, generationId, role, paths) {
    assert(Array.isArray(paths) && paths.length <= 30, '每次最多保存 30 张图片');
    for (const source of paths) {
      const image = this.importImage(source, role);
      this.db
        .prepare(
          'INSERT INTO images(id,prompt_id,generation_id,role,path,name,position) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          image.id,
          promptId,
          generationId,
          role,
          image.path,
          image.name,
          this.db
            .prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM images WHERE prompt_id=?')
            .get(promptId).n,
        );
    }
  }
  insertGeneration(promptId, snapshot, input) {
    const rating = Number(input.rating || 0);
    assert(Number.isInteger(rating) && rating >= 0 && rating <= 5, '评分应为 0 到 5 星');
    const generationId = id();
    this.db
      .prepare('INSERT INTO generations VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        generationId,
        promptId,
        snapshot,
        text(input.model, 120),
        text(input.size, 80),
        text(input.ratio, 40),
        text(input.parameters, 10000),
        rating,
        text(input.notes, 10000),
        now(),
      );
    this.addImages(promptId, generationId, 'output', input.outputs || []);
    return generationId;
  }
  addGeneration(input) {
    const p = this.db.prepare('SELECT * FROM prompts WHERE id=?').get(input.promptId);
    assert(p?.kind === 'image', '图片 Prompt 不存在');
    return this.transaction(() => {
      const result = this.insertGeneration(p.id, text(input.snapshot) || p.content, input);
      this.db.prepare('UPDATE prompts SET updated_at=? WHERE id=?').run(now(), p.id);
      return result;
    });
  }
  favorite(kind, recordId) {
    assert(['prompt', 'skill'].includes(kind), '类型无效');
    this.db
      .prepare(
        `UPDATE ${kind === 'prompt' ? 'prompts' : 'skills'} SET favorite=1-favorite WHERE id=?`,
      )
      .run(recordId);
  }
  remove(kind, recordId) {
    assert(['prompt', 'skill'].includes(kind), '类型无效');
    this.db
      .prepare(`DELETE FROM ${kind === 'prompt' ? 'prompts' : 'skills'} WHERE id=?`)
      .run(recordId);
  }
  used(recordId) {
    this.db.prepare('UPDATE prompts SET used_at=? WHERE id=?').run(now(), recordId);
  }
  media(imageId) {
    const image = this.db.prepare('SELECT * FROM images WHERE id=?').get(imageId);
    assert(image, '图片不存在');
    const absolute = path.resolve(this.root, image.path);
    assert(within(this.root, absolute), '路径无效');
    return absolute;
  }
  manageImage(input) {
    const image = this.db.prepare('SELECT * FROM images WHERE id=?').get(input.id);
    assert(image, '图片不存在');
    return this.transaction(() => {
      if (input.action === 'cover') {
        this.db.prepare('UPDATE prompts SET cover_id=? WHERE id=?').run(image.id, image.prompt_id);
      } else if (input.action === 'delete') {
        this.db.prepare('UPDATE prompts SET cover_id=NULL WHERE cover_id=?').run(image.id);
        this.db.prepare('DELETE FROM images WHERE id=?').run(image.id);
      } else if (input.action === 'move') {
        assert([-1, 1].includes(input.direction), '排序方向无效');
        const group = this.db
          .prepare(
            'SELECT id FROM images WHERE prompt_id=? AND role=? AND generation_id IS ? ORDER BY position,rowid',
          )
          .all(image.prompt_id, image.role, image.generation_id);
        const current = group.findIndex((i) => i.id === image.id),
          next = current + input.direction;
        if (next >= 0 && next < group.length)
          [group[current], group[next]] = [group[next], group[current]];
        group.forEach((i, n) =>
          this.db.prepare('UPDATE images SET position=? WHERE id=?').run(n, i.id),
        );
      } else throw new Error('图片操作无效');
      this.db.prepare('UPDATE prompts SET updated_at=? WHERE id=?').run(now(), image.prompt_id);
      return true;
    });
  }
  scanLocal(root) {
    const files = scanFiles(root);
    const candidates = files
      .filter((f) => path.basename(f) === 'SKILL.md')
      .map((f) => {
        const relative = path.dirname(f);
        const info = skillInfo(path.join(root, relative));
        return {
          key: relative,
          name: info.name,
          description: info.description,
          count: info.files.length,
        };
      });
    assert(candidates.length, '未发现 SKILL.md，请选择 Skill 文件夹或其父目录');
    const token = id();
    this.sessions.set(token, { root, source: 'local', repo: '', commit: '', candidates });
    return { token, candidates };
  }
  async scanGithub(url) {
    const match = text(url, 500).match(
      /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i,
    );
    assert(match, '请输入公开 GitHub 仓库根地址，例如 https://github.com/owner/repo');
    const repo = `https://github.com/${match[1]}/${match[2]}`;
    const root = path.join(this.root, 'git', id());
    await git(['clone', '--depth', '1', '--', repo + '.git', root]);
    const result = this.scanLocal(root);
    this.sessions.set(result.token, {
      ...this.sessions.get(result.token),
      source: 'github',
      repo,
      commit: await git(['rev-parse', 'HEAD'], root),
    });
    return result;
  }
  importSkills(token, keys) {
    const session = this.sessions.get(token);
    assert(session, '导入会话已过期，请重新扫描');
    assert(Array.isArray(keys) && keys.length, '请至少选择一个 Skill');
    const imported = [];
    let skipped = 0;
    this.transaction(() => {
      for (const key of [...new Set(keys)]) {
        assert(
          session.candidates.some((c) => c.key === key),
          'Skill 路径无效',
        );
        const source = path.resolve(session.root, key);
        assert(
          source === path.resolve(session.root) || within(session.root, source),
          'Skill 路径超出仓库',
        );
        const sourceKey =
          session.source === 'github'
            ? `${session.repo.toLowerCase()}#${key}`
            : process.platform === 'win32'
              ? source.toLowerCase()
              : source;
        if (this.db.prepare('SELECT id FROM skills WHERE source_key=?').get(sourceKey)) {
          skipped++;
          continue;
        }
        const info = skillInfo(source),
          skillId = id(),
          directory = path.join(this.root, 'skills', skillId);
        this.trackImport(`skills/${skillId}`);
        copySkill(source, directory);
        const time = now();
        this.db
          .prepare('INSERT INTO skills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(
            skillId,
            info.name,
            info.description,
            info.content,
            '[]',
            0,
            session.source,
            sourceKey,
            session.repo,
            key,
            session.commit,
            session.commit,
            `skills/${skillId}`,
            JSON.stringify(info.files),
            time,
            time,
            treeHash(directory),
          );
        imported.push(skillId);
      }
    });
    return { imported: imported.length, skipped };
  }
  skill(recordId) {
    const s = this.db.prepare('SELECT * FROM skills WHERE id=?').get(recordId);
    assert(s, 'Skill 不存在');
    return { ...s, directory: path.resolve(this.root, s.directory) };
  }
  saveSkill(input) {
    this.skill(input.id);
    assert(text(input.name, 120), '名称不能为空');
    this.db
      .prepare('UPDATE skills SET name=?,description=?,tags=?,updated_at=? WHERE id=?')
      .run(
        text(input.name, 120),
        text(input.description, 2000),
        JSON.stringify(tags(input.tags)),
        now(),
        input.id,
      );
  }
  exportSkill(recordId, targetRoot) {
    const s = this.skill(recordId);
    const safeName =
      s.name
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/[. ]+$/g, '')
        .slice(0, 100) || 'skill';
    assert(
      !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safeName),
      'Skill 名称是 Windows 保留名称，请先编辑名称',
    );
    assert(
      fs.lstatSync(targetRoot).isDirectory() && !fs.lstatSync(targetRoot).isSymbolicLink(),
      '目标目录无效',
    );
    const target = path.join(targetRoot, safeName);
    assert(within(targetRoot, target), '目标路径无效');
    copySkill(s.directory, target);
    return target;
  }
  async checkUpdate(recordId) {
    const s = this.skill(recordId);
    assert(s.source === 'github', '本地 Skill 不支持 GitHub 更新');
    const result = await git(['ls-remote', '--', s.repo + '.git', 'HEAD']);
    const latest = result.split(/\s/)[0];
    assert(/^[0-9a-f]{40,64}$/.test(latest), '无法读取远程版本');
    this.db.prepare('UPDATE skills SET latest_commit=? WHERE id=?').run(latest, recordId);
    return latest !== s.commit_hash;
  }
  async updateSkill(recordId) {
    assert(!this.busy.has(recordId), '该 Skill 正在更新');
    this.busy.add(recordId);
    try {
      const s = this.skill(recordId);
      assert(s.source === 'github', '仅支持更新 GitHub Skill');
      const unchanged = () =>
        assert(
          s.tree_hash && s.tree_hash === treeHash(s.directory),
          '收藏副本已被外部修改。请先另存改动，再移除此收藏并重新导入，以免覆盖本地修改。',
        );
      unchanged();
      const root = path.join(this.root, 'git', id());
      await git(['clone', '--depth', '1', '--', s.repo + '.git', root]);
      const source = path.resolve(root, s.relative_path);
      assert(source === root || within(root, source), '路径无效');
      const info = skillInfo(source),
        commit = await git(['rev-parse', 'HEAD'], root);
      const stage = path.join(this.root, 'staging', id());
      copySkill(source, stage);
      const old = path.join(this.root, 'staging', id());
      this.skill(recordId);
      unchanged();
      fs.renameSync(s.directory, old);
      try {
        fs.renameSync(stage, s.directory);
        this.db
          .prepare(
            'UPDATE skills SET content=?,files=?,commit_hash=?,latest_commit=?,updated_at=?,tree_hash=? WHERE id=?',
          )
          .run(
            info.content,
            JSON.stringify(info.files),
            commit,
            commit,
            now(),
            treeHash(s.directory),
            recordId,
          );
      } catch (e) {
        if (fs.existsSync(s.directory)) fs.renameSync(s.directory, stage);
        fs.renameSync(old, s.directory);
        throw e;
      }
      return commit;
    } finally {
      this.busy.delete(recordId);
    }
  }
  async exportBackup(destination) {
    assert(!this.busy.size, 'Skill 正在更新，请稍后备份');
    const resolved = fs.realpathSync(destination);
    assert(resolved !== this.root && !within(this.root, resolved), '备份请选择数据目录以外的位置');
    const target = path.join(
      resolved,
      `AgentValue-backup-${now().replace(/[:.]/g, '-')}-${id().slice(0, 8)}`,
    );
    fs.mkdirSync(target);
    await backup(this.db, path.join(target, databaseFile));
    for (const dir of ['skills', 'images'])
      fs.cpSync(path.join(this.root, dir), path.join(target, dir), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'manifest.json'),
      JSON.stringify(
        {
          app: 'AgentValue',
          schema: 2,
          checksums: inventory(target).files,
          createdAt: now(),
          restore:
            '退出 AgentValue 后，将 agentvalue.db、skills 和 images 复制到原数据目录，旧库请先另存。Git 缓存无需恢复。',
        },
        null,
        2,
      ),
    );
    const data = this.state();
    fs.writeFileSync(path.join(target, 'catalog.json'), JSON.stringify(data, null, 2));
    return target;
  }
  inspectBackup(source) {
    const preview = inspectBackup(source);
    assert(
      preview.root !== this.root && !within(this.root, preview.root),
      '请选择当前数据目录以外的备份',
    );
    this.restorePreview = preview;
    return preview;
  }
  async restoreBackup() {
    assert(this.restorePreview, '请先选择并校验备份');
    assert(!this.busy.size, 'Skill 正在更新，请稍后恢复');
    const preview = this.restorePreview;
    assert(
      inspectBackup(preview.root).fingerprint === preview.fingerprint,
      '备份已变化，请重新选择',
    );
    const recoveryRoot = path.join(path.dirname(this.root), path.basename(this.root) + '-recovery');
    fs.mkdirSync(recoveryRoot, { recursive: true });
    const recovery = await this.exportBackup(recoveryRoot);
    const stageName = `restore-${id()}`,
      stage = path.join(this.root, 'staging', stageName);
    fs.mkdirSync(path.join(stage, 'next'), { recursive: true });
    fs.mkdirSync(path.join(stage, 'previous'));
    fs.copyFileSync(
      path.join(preview.root, preview.sourceDatabase),
      path.join(stage, 'next', databaseFile),
    );
    for (const part of ['skills', 'images'])
      fs.cpSync(path.join(preview.root, part), path.join(stage, 'next', part), { recursive: true });
    const nextFiles = inventory(path.join(stage, 'next')).files;
    for (const [file, hash] of Object.entries(nextFiles))
      assert(
        preview.files[file === databaseFile ? preview.sourceDatabase : file] === hash,
        '复制期间备份发生变化，请重新选择',
      );
    fs.writeFileSync(
      path.join(stage, 'next', 'manifest.json'),
      JSON.stringify({
        app: 'AgentValue',
        schema: preview.schema,
        createdAt: preview.createdAt,
        checksums: nextFiles,
      }),
    );
    inspectBackup(path.join(stage, 'next'));
    const journal = path.join(this.root, 'restore-journal.json');
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    try {
      writeJournal(journal, { stage: stageName, committed: false });
      for (const suffix of ['-wal', '-shm'])
        fs.rmSync(path.join(this.root, databaseFile + suffix), { force: true });
      for (const part of parts) {
        fs.renameSync(path.join(this.root, part), path.join(stage, 'previous', part));
        fs.renameSync(path.join(stage, 'next', part), path.join(this.root, part));
      }
      this.openDatabase();
      this.state();
      // Removing the journal commits the replacement. A crash before this rolls back on startup.
      fs.unlinkSync(journal);
      this.sessions.clear();
      this.restorePreview = null;
    } catch (error) {
      try {
        this.db.close();
      } catch {}
      recoverRestore(this.root);
      this.openDatabase();
      throw error;
    }
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch {
      /* recovery backup is retained */
    }
    return { recovery, counts: preview.counts };
  }
  close() {
    this.db.close();
  }
}
module.exports = { Vault, within, skillInfo, scanFiles, copySkill };
