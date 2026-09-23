const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync, backup } = require('node:sqlite');
const { databaseFile, legacyDatabaseFile, inventory, inspectBackup } = require('./backup.cjs');

function defaultDataDirectory(executable) {
  return path.join(path.dirname(executable), 'data');
}

function settingsFile(
  localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
) {
  return path.join(localAppData, 'AgentValue', 'settings.json');
}

function readDataChoice(file) {
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    config.version !== 1 ||
    typeof config.dataDirectory !== 'string' ||
    !path.isAbsolute(config.dataDirectory)
  )
    throw new Error('数据位置设置无效，请检查 AgentValue 的 settings.json');
  return path.resolve(config.dataDirectory);
}

function saveDataChoice(file, directory) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(
    temp,
    JSON.stringify({ version: 1, dataDirectory: path.resolve(directory) }, null, 2),
  );
  fs.renameSync(temp, file);
}

function ensureTargetEmpty(target) {
  if (!fs.existsSync(target)) return;
  if (!fs.statSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink())
    throw new Error('目标不是普通文件夹');
  if (fs.readdirSync(target).length) throw new Error('目标文件夹非空，请选择空文件夹');
}

async function copyData(source, target, sourceDatabase, openDatabase) {
  source = fs.realpathSync(source);
  target = path.resolve(target);
  if (
    source === target ||
    target.startsWith(source + path.sep) ||
    source.startsWith(target + path.sep)
  )
    throw new Error('新旧数据位置不能互相包含');
  ensureTargetEmpty(target);
  const parent = path.dirname(target);
  if (fs.existsSync(parent)) {
    if (!fs.statSync(parent).isDirectory()) throw new Error('数据目录的上级路径不是文件夹');
  } else {
    fs.mkdirSync(parent, { recursive: true });
  }
  const stage = fs.mkdtempSync(path.join(parent, '.agentvalue-migrate-'));
  let db;
  try {
    db = openDatabase || new DatabaseSync(path.join(source, sourceDatabase), { readOnly: true });
    await backup(db, path.join(stage, databaseFile));
    for (const dir of ['skills', 'images'])
      fs.cpSync(path.join(source, dir), path.join(stage, dir), { recursive: true });
    const files = inventory(stage).files;
    fs.writeFileSync(
      path.join(stage, 'manifest.json'),
      JSON.stringify({
        app: 'AgentValue',
        schema: db.prepare('PRAGMA user_version').get().user_version,
        createdAt: new Date().toISOString(),
        checksums: files,
      }),
    );
    inspectBackup(stage);
    ensureTargetEmpty(target);
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(stage, target);
    return target;
  } finally {
    if (!openDatabase) db?.close();
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function resolveDataDirectory({
  executable,
  home,
  configFile,
  override,
  localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
}) {
  if (override) return path.resolve(override);
  const choice = readDataChoice(configFile);
  const target = choice || defaultDataDirectory(executable);
  if (fs.existsSync(path.join(target, databaseFile))) return target;
  if (choice) throw new Error(`已选数据目录不可用或缺少 ${databaseFile}，请检查：${target}`);
  if (fs.existsSync(target) && fs.readdirSync(target).length)
    throw new Error(`数据目录没有 ${databaseFile}，请检查：${target}`);
  const appDirectory = path.dirname(executable);
  const previousAdjacent =
    path.basename(appDirectory).toLowerCase() === 'app'
      ? path.join(path.dirname(appDirectory), 'data')
      : path.join(path.dirname(appDirectory), `${path.basename(appDirectory)}-data`);
  const previousDefault = path.join(localAppData, 'Programs', 'AgentValue', 'data');
  const legacy = path.join(home, '.agentvault');
  if (fs.existsSync(path.join(previousAdjacent, databaseFile)))
    await copyData(previousAdjacent, target, databaseFile);
  else if (target !== previousDefault && fs.existsSync(path.join(previousDefault, databaseFile)))
    await copyData(previousDefault, target, databaseFile);
  else if (fs.existsSync(path.join(legacy, legacyDatabaseFile)))
    await copyData(legacy, target, legacyDatabaseFile);
  else if (fs.existsSync(target) && !fs.statSync(target).isDirectory())
    throw new Error('数据目录不是文件夹');
  return target;
}

module.exports = {
  defaultDataDirectory,
  settingsFile,
  readDataChoice,
  saveDataChoice,
  copyData,
  resolveDataDirectory,
};
