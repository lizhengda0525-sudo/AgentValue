const day = (value) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
function dueReminders(state, now = new Date(), seen = new Set()) {
  return state.tasks
    .filter((task) => task.remind && task.status !== 'done' && task.date === day(now))
    .map((task) => ({
      task,
      key: `${task.id}:${task.date}:${task.start || '09:00'}`,
      due: new Date(`${task.date}T${task.start || '09:00'}:00`).getTime(),
    }))
    .filter((item) => item.due <= now.getTime() && !seen.has(item.key));
}
function checkReminders(vault, notify, now = new Date()) {
  vault.db.exec(
    'CREATE TABLE IF NOT EXISTS assistant_reminders (id TEXT PRIMARY KEY, day TEXT NOT NULL)',
  );
  const state = vault.assistantState();
  const seen = new Set(
    vault.db
      .prepare('SELECT id FROM assistant_reminders WHERE day=?')
      .all(day(now))
      .map((row) => row.id),
  );
  const pending = dueReminders(state, now, seen);
  if (!pending.length) return 0;
  notify(pending.map(({ task }) => task));
  const insert = vault.db.prepare('INSERT OR IGNORE INTO assistant_reminders VALUES (?,?)');
  for (const item of pending) insert.run(item.key, day(now));
  vault.db
    .prepare('DELETE FROM assistant_reminders WHERE day<?')
    .run(day(new Date(now.getTime() - 90 * 86400000)));
  return pending.length;
}
module.exports = { dueReminders, checkReminders };
