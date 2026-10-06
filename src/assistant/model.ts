export type Category = 'work' | 'study' | 'life' | 'uncategorized';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export type Task = {
  id: string;
  title: string;
  category: Category;
  project: string;
  status: TaskStatus;
  priority: 'high' | 'normal';
  date: string;
  start: string;
  end: string;
  deadline: string;
  notes: string;
  asset?: string;
  assetId?: string;
  assetKind?: 'prompt' | 'skill';
  repeat?: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  repeatOf?: string;
  remind?: boolean;
};
export type WorkLog = {
  id: string;
  taskId: string;
  date: string;
  start: string;
  end: string;
  summary: string;
  seconds?: number;
  source?: 'timer' | 'manual';
};
export const categoryInfo = {
  work: { label: '工作', color: '#628375' },
  study: { label: '学习', color: '#9581ba' },
  life: { label: '生活', color: '#c59662' },
  uncategorized: { label: '未分类', color: '#89939b' },
};
export const statusInfo = {
  todo: '待办',
  doing: '进行中',
  waiting: '等待中',
  done: '已完成',
};
export const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export const duration = (start: string, end: string) => Math.max(0, minutes(end) - minutes(start));
export const formatDuration = (value: number) => {
  if (value > 0 && value < 1) return `${Math.max(1, Math.round(value * 60))} 秒`;
  value = Math.round(value);
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? `${h} 小时${m ? ` ${m} 分` : ''}` : `${m} 分钟`;
};
export const logMinutes = (log: WorkLog) =>
  log.seconds !== undefined ? log.seconds / 60 : duration(log.start, log.end);
export const shiftDate = (date: string, amount: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const weekDays = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => shiftDate(date, i - ((d.getDay() + 6) % 7)));
};
export const dayLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' },
) => new Intl.DateTimeFormat('zh-CN', options).format(new Date(`${date}T12:00:00`));
