import test from 'node:test';
import assert from 'node:assert/strict';
import { endTime, segmentsToLogs } from '../src/assistant/flow.ts';
import { logMinutes } from '../src/assistant/model.ts';
import { layoutTimeBlocks } from '../src/assistant/timeline.ts';

test('planning permits a midnight end and rejects accidental cross-day/invalid intervals', () => {
  assert.equal(endTime('23:30', 30), '24:00');
  assert.equal(endTime('23:30', 60), '');
  assert.equal(endTime('25:00', 30), '');
  assert.equal(endTime('09:00', 0), '');
  assert.equal(endTime('09:00', 30.5), '');
  assert.equal(endTime('09:00', 90), '10:30');
});

test('actual logs preserve short work and exclude the pause between sessions', () => {
  const at = (hour, minute, second = 0) => new Date(2026, 9, 4, hour, minute, second).getTime();
  const logs = segmentsToLogs(
    'task',
    [
      { start: at(9, 0), end: at(9, 10) },
      { start: at(9, 25), end: at(9, 25, 20) },
    ],
    'Finished draft',
  );
  assert.equal(logs.length, 2);
  assert.equal(
    logs.reduce((sum, log) => sum + log.seconds, 0),
    620,
  );
  assert.equal(logMinutes(logs[1]), 1 / 3);
  assert.equal(logs[1].start, logs[1].end);
  assert.equal(logs[0].summary, 'Finished draft');
  assert.equal(new Set(logs.map((log) => log.id)).size, 2);
});

test('midnight work is split into separate daily totals without loss or duplication', () => {
  const logs = segmentsToLogs(
    'task',
    [
      {
        start: new Date(2026, 9, 4, 23, 50).getTime(),
        end: new Date(2026, 9, 5, 0, 10).getTime(),
      },
    ],
    'Review',
  );
  assert.deepEqual(
    logs.map((log) => [log.date, log.start, log.end, logMinutes(log)]),
    [
      ['2026-10-04', '23:50', '24:00', 10],
      ['2026-10-05', '00:00', '00:10', 10],
    ],
  );
  assert.equal(
    segmentsToLogs(
      'task',
      [
        { start: 10, end: 10 },
        { start: 20, end: 10 },
      ],
      '',
    ).length,
    0,
  );
});

test('sub-minute actual records remain separately clickable on the timeline', () => {
  const layout = layoutTimeBlocks(
    [
      { id: 'first', start: '09:00', end: '09:00' },
      { id: 'second', start: '09:00', end: '09:01' },
    ],
    26,
  );
  assert.notEqual(layout.get('first').left, layout.get('second').left);
  assert.equal(layout.get('first').width, 'calc(50% - 10px)');
});
