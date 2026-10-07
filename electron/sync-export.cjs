const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { within } = require('./store.cjs');
async function syncExport(vault, backupRoot) {
  if (vault.busy.size) throw new Error('请等待资产操作完成后再导入');
  const state = vault.state(),
    assistant = vault.assistantState(),
    records = [],
    files = [];
  let bytes = 0;
  const read = (absolute) => {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 30 * 1024 ** 2)
      throw new Error('云空间仅支持小于 30 MB 的普通附件');
    bytes += stat.size;
    if (bytes > 200 * 1024 ** 2) throw new Error('首次导入附件超过 200 MB，请先分批整理资产');
    return fs.readFileSync(absolute).toString('base64');
  };
  for (const prompt of state.prompts) {
    const { images, generations, ...data } = prompt;
    records.push({ kind: 'prompt', id: prompt.id, data });
    for (const generation of generations) {
      const { images: outputs, ...g } = generation;
      records.push({ kind: 'generation', id: g.id, data: { ...g, prompt_id: prompt.id } });
    }
  }
  for (const image of vault.db.prepare('SELECT * FROM images').all()) {
    const absolute = vault.media(image.id),
      ext = path.extname(absolute).toLowerCase();
    const type = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }[ext];
    if (!type) throw new Error('图片格式无效');
    const { path: ignored, ...data } = image;
    records.push({ kind: 'image', id: image.id, data });
    files.push({ kind: 'image', id: image.id, base64: read(absolute), type, name: image.name });
  }
  for (const skill of state.skills) {
    const { directory: oldDirectory, source_key: sourceKey, tree_hash: treeHash, ...data } = skill;
    const directory = vault.skill(skill.id).directory;
    records.push({ kind: 'skill', id: skill.id, data });
    for (const relative of skill.files) {
      const absolute = path.resolve(directory, relative);
      if (
        !within(directory, absolute) ||
        !within(fs.realpathSync(directory), fs.realpathSync(absolute))
      )
        throw new Error('Skill 附件路径无效');
      const normal = relative.replaceAll('\\', '/');
      const id = `${skill.id}:${createHash('sha256').update(normal).digest('hex')}`;
      records.push({ kind: 'skillFile', id, data: { skill_id: skill.id, path: normal } });
      files.push({ kind: 'skillFile', id, base64: read(absolute) });
    }
  }
  // The original SQLite data and attachments are backed up before any cloud writes occur.
  fs.mkdirSync(backupRoot, { recursive: true });
  const backupPath = await vault.exportBackup(backupRoot);
  return { assistant, records, files, backupPath };
}
module.exports = { syncExport };
