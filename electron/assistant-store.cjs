const { randomUUID } = require('node:crypto');
const { emptyAssistant, validateAssistant } = require('../shared/assistant-validation.js');
const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};
function migrateAssistant(db) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS assistant_records (kind TEXT NOT NULL CHECK(kind IN ('task','log','goal','review','savedReview')), id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS assistant_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, timer TEXT NOT NULL);
    PRAGMA user_version=3; COMMIT;`);
  db.prepare('INSERT OR IGNORE INTO assistant_meta VALUES(1,?,?)').run(
    randomUUID(),
    JSON.stringify(emptyAssistant().timer),
  );
}
function readAssistant(db) {
  const state = emptyAssistant();
  const keys = {
    task: 'tasks',
    log: 'logs',
    goal: 'goals',
    review: 'reviews',
    savedReview: 'savedReviews',
  };
  for (const row of db.prepare('SELECT * FROM assistant_records ORDER BY rowid').all()) {
    const key = keys[row.kind],
      value = JSON.parse(row.data);
    if (Array.isArray(state[key])) state[key].push(value);
    else state[key][row.id] = value;
  }
  const meta = db.prepare('SELECT * FROM assistant_meta WHERE id=1').get();
  state.timer = JSON.parse(meta.timer);
  return { ...validateAssistant(state), revision: meta.revision };
}
function saveAssistant(db, input) {
  const state = validateAssistant(input.state);
  db.exec('BEGIN IMMEDIATE');
  try {
    ensure(
      db.prepare('SELECT revision FROM assistant_meta WHERE id=1').get().revision ===
        input.revision,
      '数据已被其他窗口或备份恢复修改，请保留草稿后重新载入。',
    );
    for (const task of state.tasks.filter((t) => t.assetId)) {
      if (
        !db
          .prepare(
            `SELECT id FROM ${task.assetKind === 'prompt' ? 'prompts' : 'skills'} WHERE id=?`,
          )
          .get(task.assetId)
      ) {
        delete task.asset;
        delete task.assetId;
        delete task.assetKind;
      }
    }
    db.exec('DELETE FROM assistant_records');
    const insert = db.prepare('INSERT INTO assistant_records VALUES(?,?,?)');
    for (const [key, kind] of Object.entries({ tasks: 'task', logs: 'log', goals: 'goal' }))
      for (const row of state[key]) insert.run(kind, row.id, JSON.stringify(row));
    for (const [key, kind] of Object.entries({ reviews: 'review', savedReviews: 'savedReview' }))
      for (const [day, row] of Object.entries(state[key]))
        insert.run(kind, day, JSON.stringify(row));
    const revision = randomUUID();
    db.prepare('UPDATE assistant_meta SET revision=?,timer=? WHERE id=1').run(
      revision,
      JSON.stringify(state.timer),
    );
    db.exec('COMMIT');
    return { revision };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
module.exports = {
  emptyAssistant,
  validateAssistant,
  migrateAssistant,
  readAssistant,
  saveAssistant,
};
