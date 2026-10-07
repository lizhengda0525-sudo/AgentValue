const emptyAssistant = () => ({
  tasks: [],
  logs: [],
  goals: [],
  reviews: {},
  savedReviews: {},
  timer: { taskId: null, startedAt: null, segments: [] },
});
const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max, label, required = false) => {
  ensure(typeof x === 'string' && x.length <= max && (!required || x.trim()), `${label}无效`);
  return x;
};
const date = (x, optional = false) => {
  ensure(
    (optional && x === '') ||
      (typeof x === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(x) &&
        new Date(`${x}T12:00:00Z`).toISOString().slice(0, 10) === x),
    '日期无效',
  );
  return x;
};
const time = (x, end = false) =>
  typeof x === 'string' && (/^([01]\d|2[0-3]):[0-5]\d$/.test(x) || (end && x === '24:00'));
const minute = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
function validateAssistant(input) {
  ensure(object(input), '助手数据无效');
  const data = emptyAssistant();
  for (const key of ['tasks', 'logs', 'goals']) {
    ensure(Array.isArray(input[key]) && input[key].length <= 20000, '记录数量无效');
    data[key] = input[key];
  }
  const ids = (rows) => {
    const seen = new Set();
    for (const row of rows) {
      ensure(object(row), '记录无效');
      str(row.id, 100, '记录编号', true);
      ensure(!seen.has(row.id), '记录编号重复');
      seen.add(row.id);
    }
    return seen;
  };
  const taskIds = ids(data.tasks);
  ids(data.logs);
  ids(data.goals);
  for (const task of data.tasks) {
    str(task.title, 160, '事项名称', true);
    str(task.project, 160, '项目');
    str(task.notes, 20000, '备注');
    ensure(
      ['work', 'study', 'life', 'uncategorized'].includes(task.category) &&
        ['todo', 'doing', 'waiting', 'done'].includes(task.status) &&
        ['high', 'normal'].includes(task.priority),
      '事项属性无效',
    );
    date(task.date, true);
    date(task.deadline, true);
    ensure(
      task.repeat === undefined ||
        ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(task.repeat),
      '重复规则无效',
    );
    ensure(task.remind === undefined || typeof task.remind === 'boolean', '提醒设置无效');
    if (task.repeatOf !== undefined) str(task.repeatOf, 100, '重复来源', true);
    ensure(
      (task.start === '' && task.end === '') ||
        (task.date &&
          time(task.start) &&
          time(task.end, true) &&
          minute(task.end) > minute(task.start)),
      '计划时间无效',
    );
    if (task.asset !== undefined) str(task.asset, 160, '关联工具');
    if (task.assetId) {
      str(task.assetId, 100, '工具编号', true);
      ensure(['prompt', 'skill'].includes(task.assetKind), '工具类型无效');
    }
  }
  for (const log of data.logs) {
    ensure(taskIds.has(log.taskId), '执行记录的事项不存在');
    date(log.date);
    str(log.summary, 20000, '小计');
    ensure(
      time(log.start) && time(log.end, true) && minute(log.end) >= minute(log.start),
      '实际时间无效',
    );
    if (log.seconds !== undefined)
      ensure(
        Number.isFinite(log.seconds) &&
          log.seconds > 0 &&
          log.seconds <= 86400 &&
          Math.abs(log.seconds / 60 - (minute(log.end) - minute(log.start))) < 1.01,
        '执行时长无效',
      );
    else ensure(minute(log.end) > minute(log.start), '实际时间不能为空');
    ensure(log.source === undefined || ['timer', 'manual'].includes(log.source), '记录来源无效');
  }
  for (const goal of data.goals) {
    ensure(goal.period === undefined || ['month', 'year'].includes(goal.period), '目标周期无效');
    str(goal.title, 160, '目标名称', true);
    str(goal.project, 160, '目标项目', true);
    str(goal.hint, 2000, '目标说明');
    ensure(
      /^\d{4}-(0[1-9]|1[0-2])$/.test(goal.month) &&
        ['work', 'study', 'life', 'uncategorized'].includes(goal.category),
      '目标属性无效',
    );
  }
  for (const key of ['reviews', 'savedReviews']) {
    ensure(object(input[key]) && Object.keys(input[key]).length <= 20000, '回顾数据无效');
    data[key] = input[key];
    for (const [day, value] of Object.entries(data[key])) {
      date(day);
      if (key === 'reviews') str(value, 200000, '回顾');
      else {
        ensure(object(value), '回顾快照无效');
        str(value.text, 200000, '回顾');
        str(value.signature, 4000000, '回顾签名');
      }
    }
  }
  const timer = input.timer;
  ensure(
    object(timer) && Array.isArray(timer.segments) && timer.segments.length <= 20000,
    '计时数据无效',
  );
  ensure(timer.taskId === null || taskIds.has(timer.taskId), '计时事项不存在');
  ensure(
    timer.startedAt === null ||
      (timer.taskId &&
        Number.isSafeInteger(timer.startedAt) &&
        timer.startedAt > 0 &&
        timer.startedAt <= Date.now() + 60000),
    '计时开始时间无效',
  );
  let last = 0;
  for (const segment of timer.segments) {
    ensure(
      timer.taskId &&
        Number.isSafeInteger(segment.start) &&
        Number.isSafeInteger(segment.end) &&
        segment.start >= last &&
        segment.end >= segment.start &&
        segment.end <= Date.now() + 60000,
      '计时区间无效',
    );
    last = segment.end;
  }
  ensure(timer.startedAt === null || timer.startedAt >= last, '计时区间重叠');
  data.timer = timer;
  return data;
}

export { emptyAssistant, validateAssistant };
