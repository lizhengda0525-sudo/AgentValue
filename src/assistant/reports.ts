import {
  shiftDate,
  weekDays,
  logMinutes,
  formatDuration,
  type Task,
  type WorkLog,
  type TaskStatus,
} from './model.ts';

export function changeTaskStatus(
  tasks: Task[],
  id: string,
  status: TaskStatus,
  today: string,
): Task[] {
  const task = tasks.find((item) => item.id === id);
  const next = tasks.map((item) => (item.id === id ? { ...item, status } : item));
  if (
    !task ||
    task.status === 'done' ||
    status !== 'done' ||
    !task.repeat ||
    task.repeat === 'none' ||
    !task.date ||
    tasks.some((item) => item.repeatOf === id)
  )
    return next;
  const anchor = task.date > today ? task.date : today;
  let date = shiftDate(anchor, task.repeat === 'weekly' ? 7 : 1);
  if (task.repeat === 'weekdays') {
    while ([0, 6].includes(new Date(`${date}T12:00:00`).getDay())) date = shiftDate(date, 1);
  }
  if (task.repeat === 'monthly') {
    const value = new Date(`${anchor}T12:00:00`),
      day = value.getDate();
    value.setDate(1);
    value.setMonth(value.getMonth() + 1);
    const last = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
    value.setDate(Math.min(day, last));
    date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const delta = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${task.date}T12:00:00Z`)) / 86400000,
  );
  next.push({
    ...task,
    id: crypto.randomUUID(),
    status: 'todo',
    date,
    deadline: task.deadline ? shiftDate(task.deadline, delta) : '',
    repeatOf: id,
  });
  return next;
}
export function reviewRange(date: string, scope: 'week' | 'month') {
  if (scope === 'week') {
    const days = weekDays(date);
    return { start: days[0], end: days[6] };
  }
  const last = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${last}` };
}
export function periodReport(
  tasks: Task[],
  logs: WorkLog[],
  date: string,
  scope: 'week' | 'month',
  reviews: Record<string, string>,
) {
  const { start, end } = reviewRange(date, scope);
  const selected = tasks.filter((task) => task.date >= start && task.date <= end);
  const recorded = logs.filter((log) => log.date >= start && log.date <= end);
  const projects = [
    ...new Set(
      recorded.map((log) => tasks.find((task) => task.id === log.taskId)?.project || '未设置项目'),
    ),
  ];
  return [
    `AgentValue ${scope === 'week' ? '周' : '月'}回顾 · ${start} — ${end}`,
    '',
    `完成 ${selected.filter((task) => task.status === 'done').length} / ${selected.length} 项；实际记录 ${formatDuration(recorded.reduce((sum, log) => sum + logMinutes(log), 0))}。`,
    '',
    '项目投入',
    ...projects.map(
      (project) =>
        `${project}：${formatDuration(recorded.filter((log) => (tasks.find((task) => task.id === log.taskId)?.project || '未设置项目') === project).reduce((sum, log) => sum + logMinutes(log), 0))}`,
    ),
    '',
    '执行成果',
    ...recorded.map(
      (log) =>
        `• ${log.date} ${log.start}—${log.end} ${tasks.find((task) => task.id === log.taskId)?.title || ''}：${log.summary || '待补充小计'}`,
    ),
    '',
    '未完成事项',
    ...selected
      .filter((task) => task.status !== 'done')
      .map((task) => `• ${task.title}（${task.date}）`),
    '',
    '已保存的每日回顾',
    ...Object.entries(reviews)
      .filter(([day]) => day >= start && day <= end)
      .sort()
      .map(([day, text]) => `\n${day}\n${text}`),
    '',
    '个人总结与下一步',
    '',
  ].join('\n');
}
export function recordsCsv(tasks: Task[], logs: WorkLog[]) {
  const cell = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  return (
    '\uFEFF' +
    [
      ['类型', '名称', '日期', '开始', '结束', '实际秒数', '状态', '项目', '小计'],
      ...tasks.map((task) => [
        '计划',
        task.title,
        task.date,
        task.start,
        task.end,
        '',
        task.status,
        task.project,
        task.notes,
      ]),
      ...logs.map((log) => [
        '执行',
        tasks.find((task) => task.id === log.taskId)?.title || '',
        log.date,
        log.start,
        log.end,
        log.seconds ?? logMinutes(log) * 60,
        '',
        '',
        log.summary,
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}
export function downloadText(text: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
