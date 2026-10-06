import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ICAL from 'ical.js';
import { parseCalendar, calendarFile } from '../src/assistant/calendar-file.ts';
import { changeTaskStatus, periodReport, recordsCsv } from '../src/assistant/reports.ts';
const require = createRequire(import.meta.url);
const { Vault } = require('../electron/store.cjs');
const { checkReminders, dueReminders } = require('../electron/reminders.cjs');
process.env.TZ = 'Asia/Shanghai';
const task = (patch = {}) => ({
  id: 'fixture',
  title: '写作，审阅\n最终稿',
  date: '2026-10-07',
  start: '09:00',
  end: '10:00',
  notes: '正文',
  category: 'work',
  project: '项目',
  status: 'todo',
  priority: 'normal',
  deadline: '',
  ...patch,
});
const ics = (events) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fixture//EN\r\n${events}\r\nEND:VCALENDAR\r\n`;

test('ICS export round trip preserves Chinese text, all-day dates, midnight and native IDs without duplication', async () => {
  const tasks = [
    task(),
    task({ id: 'all', start: '', end: '' }),
    task({ id: 'midnight', start: '23:00', end: '24:00' }),
  ];
  const file = calendarFile(tasks);
  const calendar = new ICAL.Component(ICAL.parse(file));
  assert.equal(calendar.getAllSubcomponents('vevent').length, 3);
  assert.equal(new ICAL.Event(calendar.getAllSubcomponents('vevent')[1]).startDate.isDate, true);
  const result = await parseCalendar(file, '2026-10-07');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.tasks.map((t) => [t.id, t.title, t.date, t.start, t.end]),
    tasks.map((t) => [t.id, t.title, t.date, t.start, t.end]),
  );
});
test('UTC event crosses local midnight into separate dated plans; missing zone definition is reported', async () => {
  const result = await parseCalendar(
    ics(
      'BEGIN:VEVENT\r\nUID:cross\r\nDTSTART:20261007T153000Z\r\nDTEND:20261007T163000Z\r\nSUMMARY:跨日\r\nEND:VEVENT',
    ),
    '2026-10-07',
  );
  assert.deepEqual(
    result.tasks.map((t) => [t.date, t.start, t.end]),
    [
      ['2026-10-07', '23:30', '24:00'],
      ['2026-10-08', '00:00', '00:30'],
    ],
  );
  const unknown = await parseCalendar(
    ics(
      'BEGIN:VEVENT\r\nUID:zone\r\nDTSTART;TZID=Missing/Zone:20261007T090000\r\nDTEND;TZID=Missing/Zone:20261007T100000\r\nSUMMARY:不可猜测的时区\r\nEND:VEVENT',
    ),
    '2026-10-07',
  );
  assert.equal(unknown.tasks.length, 0);
  assert.match(unknown.warnings[0], /VTIMEZONE/);
});
test('recurring ICS honors excluded dates and modified individual occurrences; reimport IDs are stable', async () => {
  const file = ics(
    'BEGIN:VEVENT\r\nUID:daily\r\nDTSTART:20261007T090000\r\nDTEND:20261007T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261008T090000\r\nSUMMARY:原事件\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:daily\r\nRECURRENCE-ID:20261009T090000\r\nDTSTART:20261009T110000\r\nDTEND:20261009T120000\r\nSUMMARY:改期事件\r\nEND:VEVENT',
  );
  const first = await parseCalendar(file, '2026-10-07');
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(
    first.tasks.map((t) => [t.date, t.start, t.title]),
    [
      ['2026-10-07', '09:00', '原事件'],
      ['2026-10-09', '11:00', '改期事件'],
    ],
  );
  assert.deepEqual(
    (await parseCalendar(file, '2026-10-07')).tasks.map((t) => t.id),
    first.tasks.map((t) => t.id),
  );
});
test('finite recurrence import does not silently skip ancient infinite rules, malformed files or oversized input', async () => {
  await assert.rejects(parseCalendar('bad', '2026-10-07'));
  await assert.rejects(parseCalendar('a'.repeat(2 * 1024 ** 2 + 1), '2026-10-07'), /2 MB/);
  const zero = await parseCalendar(
    ics('BEGIN:VEVENT\r\nUID:zero\r\nDTSTART:20261007T090000\r\nSUMMARY:缺少时长\r\nEND:VEVENT'),
    '2026-10-07',
  );
  assert.equal(zero.tasks.length, 0);
  assert.match(zero.warnings[0], /结束时间/);
});
test('completing repeats skips weekends, handles short months and never creates a second successor on reopen', () => {
  const weekdays = changeTaskStatus(
    [task({ repeat: 'weekdays', date: '2026-10-09' })],
    'fixture',
    'done',
    '2026-10-09',
  );
  assert.equal(weekdays[1].date, '2026-10-12');
  const reopened = changeTaskStatus(weekdays, 'fixture', 'todo', '2026-10-09');
  assert.equal(changeTaskStatus(reopened, 'fixture', 'done', '2026-10-09').length, 2);
  const monthly = changeTaskStatus(
    [task({ repeat: 'monthly', date: '2027-01-31', deadline: '2027-02-01' })],
    'fixture',
    'done',
    '2027-01-31',
  );
  assert.equal(monthly[1].date, '2027-02-28');
  assert.equal(monthly[1].deadline, '2027-03-01');
});
test('weekly report counts actual seconds and project time; CSV protects formula-like content and quotes', () => {
  const tasks = [
    task({ title: '=DANGEROUS()', status: 'done' }),
    task({ id: 'other', date: '2026-11-01' }),
  ];
  const logs = [
    {
      id: 'log',
      taskId: 'fixture',
      date: '2026-10-07',
      start: '09:00',
      end: '09:30',
      seconds: 1800,
      summary: '结果 "完成"',
    },
  ];
  const report = periodReport(tasks, logs, '2026-10-07', 'week', { '2026-10-07': '个人回顾' });
  assert.match(report, /完成 1 \/ 1 项/);
  assert.match(report, /项目：30 分钟/);
  assert.match(report, /个人回顾/);
  assert.match(recordsCsv(tasks, logs), /"'=DANGEROUS\(\)"/);
  assert.match(recordsCsv(tasks, logs), /结果 ""完成""/);
});
test('desktop reminders are opt-in, due only today, and persist acknowledgement through restart', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-reminder-'));
  let vault = new Vault(root);
  t.after(() => {
    vault.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const state = vault.assistantState();
  state.tasks = [
    task({ remind: true }),
    task({ id: 'disabled' }),
    task({ id: 'tomorrow', date: '2026-10-08', remind: true }),
  ];
  vault.assistantSave({ state, revision: state.revision });
  const time = new Date('2026-10-07T09:00:00');
  let notified = 0;
  assert.equal(dueReminders(state, new Date('2026-10-07T08:59:59')).length, 0);
  assert.equal(
    checkReminders(vault, (items) => (notified += items.length), time),
    1,
  );
  vault.close();
  vault = new Vault(root);
  assert.equal(
    checkReminders(vault, (items) => (notified += items.length), time),
    0,
  );
  assert.equal(notified, 1);
});
