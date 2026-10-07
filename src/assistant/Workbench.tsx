import { Segmented, Popover, Menu, Badge, App as AntApp, Alert, Spin } from 'antd';
import { Button, Input, Textarea, Disclosure, Feedback } from '../ui';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  FolderOpen,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  LayoutList,
  ListTodo,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Sun,
  Target,
  Timer,
  X,
  Bell,
  PanelLeftClose,
  Image as ImageIcon,
  FileText,
  Code2,
  ChevronDown,
  Settings2,
} from 'lucide-react';
import App, { type LibraryPage } from '../App';
import { ChoiceSelect } from '../ChoiceSelect';
import { QuickAdd, TaskDetails, LogEditor } from './TaskPanels';
import { type TimedSegment, localDate } from './flow';
import { useAssistant, type Goal } from './persistence';
import { GoalEditor } from './GoalEditor';
import { ModalShell } from '../ModalShell';
import { CalendarTransfer } from './CalendarTransfer';
import { SyncControl } from '../sync/SyncPanel';
import { calendarFile } from './calendar-file';
import { changeTaskStatus, recordsCsv, periodReport, downloadText } from './reports';
import brandIcon from '../assets/agentvalue-icon.png';
import { libraryCall } from '../library-client';
import type { State } from '../types';
import {
  categoryInfo,
  dayLabel,
  duration,
  formatDuration,
  logMinutes,
  minutes,
  shiftDate,
  statusInfo,
  weekDays,
  type Category,
  type Task,
  type TaskStatus,
  type WorkLog,
} from './model';
import { getTimeRange, timeStyle, layoutTimeBlocks } from './timeline';
import './workbench.css';

type Page =
  | 'today'
  | 'tasks'
  | 'calendar'
  | 'review'
  | 'assets'
  | 'images'
  | 'prompts'
  | 'skills'
  | 'library-settings';
type View = 'board' | 'list' | 'timeline';
const pageInfo = {
  today: { title: '今天', icon: Sun },
  tasks: { title: '事项', icon: ListTodo },
  calendar: { title: '日历与目标', icon: CalendarDays },
  review: { title: '每日回顾', icon: BookOpen },
  assets: { title: '资产库', icon: FolderOpen },
  images: { title: '图片提示词', icon: ImageIcon },
  prompts: { title: 'Prompt 管理', icon: FileText },
  skills: { title: 'Skill 管理', icon: Code2 },
  'library-settings': { title: '资产库设置', icon: Settings2 },
};
const statuses = Object.keys(statusInfo) as TaskStatus[];
const categories = Object.keys(categoryInfo) as Category[];
const todayDate = () => localDate(Date.now());
const matches = (task: Task, query: string, filter: string) =>
  (!filter || task.category === filter) &&
  (!query ||
    `${task.title} ${task.project} ${task.notes}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()));
const elapsedLabel = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function TaskCard({
  task,
  onOpen,
  onToggle,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  return (
    <article
      className={`av-task-card ${task.category} ${task.status === 'done' ? 'is-done' : ''}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
    >
      <div className="av-card-top">
        <span className={`av-tag ${task.category}`}>
          {task.project || categoryInfo[task.category].label}
        </span>
        <Button className="av-icon" aria-label={`查看 ${task.title}`} onClick={() => onOpen(task)}>
          <MoreHorizontal size={17} />
        </Button>
      </div>
      <Button className="av-task-title" onClick={() => onOpen(task)}>
        {task.title}
      </Button>
      <p>{task.notes}</p>
      {task.asset && (
        <div className="av-linked">
          <Sparkles size={12} /> {task.asset}
        </div>
      )}
      <div className="av-card-bottom">
        <span>
          <Clock3 size={13} />{' '}
          {task.start ? `${task.start} · ${duration(task.start, task.end)} 分钟` : '尚未安排时间'}
        </span>
        <Button
          className={`av-check ${task.status === 'done' ? 'checked' : ''}`}
          aria-label={`${task.status === 'done' ? '重新打开' : '完成'} ${task.title}`}
          onClick={() => onToggle(task)}
        >
          {task.status === 'done' && <Check size={13} />}
        </Button>
      </div>
      {task.deadline && (
        <div className="av-card-deadline">
          <Flag size={11} /> 截止 {dayLabel(task.deadline)}
        </div>
      )}
    </article>
  );
}

function TimeGrid({
  tasks,
  logs,
  onOpen,
  date,
  onNew,
  compact = false,
}: {
  tasks: Task[];
  logs: WorkLog[];
  onOpen: (task: Task) => void;
  date: string;
  onNew: () => void;
  compact?: boolean;
}) {
  const scheduled = tasks.filter((task) => task.date === date && task.start && task.end);
  const recorded = logs.filter(
    (log) => log.date === date && tasks.some((task) => task.id === log.taskId),
  );
  const range = getTimeRange([...scheduled, ...recorded]);
  const plannedLayout = layoutTimeBlocks(scheduled);
  const actualLayout = layoutTimeBlocks(recorded, 26);
  return (
    <div className={`av-time-grid ${compact ? 'compact' : ''}`}>
      <div className="av-time-grid-header">
        <span>时间</span>
        <span>计划安排</span>
        <span>实际记录</span>
      </div>
      <div className="av-time-grid-body" style={{ height: range.hours * 54 }}>
        <div className="av-hours">
          {Array.from({ length: range.hours + 1 }, (_, i) => (
            <span key={i} style={{ top: `${(i / range.hours) * 100}%` }}>
              {String(i + range.firstHour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        <div className="av-day-lane">
          {Array.from({ length: range.hours + 1 }, (_, i) => (
            <div className="av-hour-line" key={i} style={{ top: `${(i / range.hours) * 100}%` }} />
          ))}
          {tasks
            .filter((task) => task.date === date && task.start && task.end)
            .map((task) => (
              <Button
                key={task.id}
                onClick={() => onOpen(task)}
                className={`av-time-block ${task.category} ${task.status === 'done' ? 'done' : ''} ${duration(task.start, task.end) < 60 ? 'short' : ''}`}
                style={{ ...timeStyle(task.start, task.end, range), ...plannedLayout.get(task.id) }}
              >
                <span className="av-block-time">
                  {task.start}—{task.end}
                  {task.status === 'done' && <Check size={12} />}
                </span>
                <strong>{task.title}</strong>
                <span className="av-block-project">{task.project}</span>
              </Button>
            ))}
          {date === todayDate() && (
            <div
              className="av-now-line"
              style={{
                top: `${((new Date().getHours() * 60 + new Date().getMinutes() - range.start) / range.span) * 100}%`,
              }}
            >
              <span>
                {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <i />
            </div>
          )}
          {!compact &&
            !scheduled.some((task) => minutes(task.start) < 840 && minutes(task.end) > 780) && (
              <Button
                className="av-free-slot"
                style={{ top: `${((780 - range.start) / range.span) * 100}%` }}
                onClick={onNew}
              >
                <Plus size={13} />
                添加日程
              </Button>
            )}
        </div>
        <div className="av-day-lane actual">
          {Array.from({ length: range.hours + 1 }, (_, i) => (
            <div className="av-hour-line" key={i} style={{ top: `${(i / range.hours) * 100}%` }} />
          ))}
          {logs
            .filter((log) => log.date === date)
            .map((log) => {
              const task = tasks.find((item) => item.id === log.taskId);
              return (
                task && (
                  <Button
                    key={log.id}
                    onClick={() => onOpen(task)}
                    className={`av-time-block actual ${task.category} ${duration(log.start, log.end) < 60 ? 'short' : ''}`}
                    style={{ ...timeStyle(log.start, log.end, range), ...actualLayout.get(log.id) }}
                  >
                    <span className="av-block-time">
                      {log.start}—{log.end}
                    </span>
                    <strong>{log.summary || '待补充小计'}</strong>
                  </Button>
                )
              );
            })}
          {!logs.some((log) => log.date === date) && (
            <div className="av-lane-empty">
              <BookOpen size={18} />
              <span>暂无执行记录</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectTimeline({
  tasks,
  date,
  onOpen,
}: {
  tasks: Task[];
  date: string;
  onOpen: (task: Task) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(date, i));
  const scheduled = tasks.filter(
    (task) => task.date && task.date >= days[0] && task.date <= days[6],
  );
  return (
    <div className="av-gantt-scroll">
      <div className="av-gantt">
        <div className="av-gantt-head">
          <span>事项 / 项目</span>
          {days.map((day) => (
            <span key={day} className={day === todayDate() ? 'is-today' : ''}>
              <small>{dayLabel(day, { weekday: 'short' })}</small>
              {day.slice(8)}
            </span>
          ))}
        </div>
        {scheduled.map((task) => (
          <div className="av-gantt-row" key={task.id}>
            <Button className="av-gantt-name" onClick={() => onOpen(task)}>
              <span className={`av-dot ${task.category}`} />
              <span>
                {task.title}
                <small>
                  {task.project || categoryInfo[task.category].label} · {statusInfo[task.status]}
                </small>
              </span>
            </Button>
            <div className="av-gantt-track">
              {days.map((day) => (
                <span key={day} className={day === todayDate() ? 'is-today' : ''} />
              ))}
              <Button
                className={`av-gantt-bar ${task.category}`}
                onClick={() => onOpen(task)}
                style={{
                  left: `${(days.indexOf(task.date) / 7) * 100}%`,
                  width: 'calc(14.2857% - 12px)',
                }}
              >
                {task.status === 'done' ? <Check size={13} /> : <Clock3 size={13} />}{' '}
                {task.start || '未定时间'}
              </Button>
              {task.deadline && days.includes(task.deadline) && (
                <span
                  className="av-deadline-marker"
                  style={{ left: `${((days.indexOf(task.deadline) + 0.5) / 7) * 100}%` }}
                  title={`截止：${task.deadline}`}
                >
                  <Flag size={12} />
                </span>
              )}
            </div>
          </div>
        ))}
        {!scheduled.length && (
          <div className="av-empty">这七天还没有安排。新建事项，选好计划日期就会出现在这里。</div>
        )}
      </div>
    </div>
  );
}

export default function Workbench({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
  const assistant = useAssistant();
  const { modal: confirmation } = AntApp.useApp();
  const { tasks, logs, reviews, savedReviews, goals } = assistant.state;
  const setTasks = assistant.setter('tasks'),
    setLogs = assistant.setter('logs'),
    setReviews = assistant.setter('reviews'),
    setSavedReviews = assistant.setter('savedReviews'),
    setGoals = assistant.setter('goals');
  const [goalEditor, setGoalEditor] = useState<Goal | null>(null);
  const [calendarImport, setCalendarImport] = useState(false);
  const [report, setReport] = useState<{ text: string; name: string } | null>(null);
  const [, refreshClock] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => refreshClock((n) => n + 1), 60000);
    return () => clearInterval(interval);
  }, []);
  const [assetSelection, setAssetSelection] = useState<{
    type: 'prompt' | 'skill';
    id: string;
  } | null>(null);
  const [page, setPage] = useState<Page>('today');
  const libraryPages: Partial<Record<Page, LibraryPage>> = {
    assets: 'image',
    images: 'image',
    prompts: 'text',
    skills: 'skills',
    'library-settings': 'settings',
  };
  const libraryPage = libraryPages[page];
  const [date, setDate] = useState(todayDate);
  const [view, setView] = useState<View>('list');
  const [calendarView, setCalendarView] = useState<'week' | 'month' | 'year'>('week');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [taskScope, setTaskScope] = useState<'all' | 'inbox' | 'today' | 'important'>('all');
  const [editor, setEditor] = useState<{ id?: string; newTask?: Task } | null>(null);
  const [quickDraft, setQuickDraft] = useState<Task | null>(null);
  const [captureTitle, setCaptureTitle] = useState('');
  const [logEditor, setLogEditor] = useState<{
    id: string;
    segments: TimedSegment[];
    existing?: WorkLog;
  } | null>(null);
  const [toast, setToast] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const timerSegments = useRef<TimedSegment[]>([]);
  const timerStarted = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const editing = !!(editor || logEditor || goalEditor || calendarImport || captureTitle);
    assistant.pauseRemote(editing);
    const protect = (event: Event) => {
      if (editing) event.preventDefault();
    };
    window.addEventListener('agentvalue-before-switch', protect);
    return () => window.removeEventListener('agentvalue-before-switch', protect);
  }, [editor, logEditor, goalEditor, calendarImport, captureTitle]);
  useEffect(() => {
    if (!assistant.loaded) return;
    const timer = assistant.state.timer;
    timerSegments.current = timer.segments.map((segment) => ({ ...segment }));
    timerStarted.current = timer.startedAt;
    setFocusedId(timer.taskId);
    setRunning(timer.startedAt !== null);
    setElapsed(
      Math.floor(
        (timer.segments.reduce((sum, s) => sum + s.end - s.start, 0) +
          (timer.startedAt === null ? 0 : Date.now() - timer.startedAt)) /
          1000,
      ),
    );
  }, [assistant.loaded, assistant.state.timer]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(
      () =>
        setElapsed(
          Math.floor(
            (timerSegments.current.reduce((sum, segment) => sum + segment.end - segment.start, 0) +
              (timerStarted.current !== null ? Date.now() - timerStarted.current : 0)) /
              1000,
          ),
        ),
      250,
    );
    return () => clearInterval(interval);
  }, [running]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        libraryPage ||
        document.querySelector(
          '[role=dialog], .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
        )
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [libraryPage]);
  const visible = tasks.filter(
    (task) =>
      matches(task, query, filter) &&
      (page !== 'tasks' ||
        taskScope === 'all' ||
        (taskScope === 'inbox' && !task.date) ||
        (taskScope === 'today' && task.date === todayDate()) ||
        (taskScope === 'important' && task.priority === 'high')),
  );
  const daily = tasks.filter((task) => task.date === date);
  const reminders = tasks.filter(
    (task) =>
      task.status !== 'done' &&
      (task.date === todayDate() || (task.deadline && task.deadline <= todayDate())),
  );
  const dailyLogs = logs.filter((log) => log.date === date);
  const planned = daily.reduce(
    (sum, task) => sum + duration(task.start || '00:00', task.end || '00:00'),
    0,
  );
  const actual = dailyLogs.reduce((sum, log) => sum + logMinutes(log), 0);
  const done = daily.filter((task) => task.status === 'done').length;
  const days = weekDays(date);
  const weekRange = getTimeRange(visible.filter((task) => days.includes(task.date)));
  const reviewSignature = JSON.stringify({ tasks: daily, logs: dailyLogs });
  const active =
    tasks.find((task) => task.id === focusedId) ||
    daily.find((task) => task.status === 'doing') ||
    daily.find((task) => task.status === 'todo');
  const openTask = (task: Task) => setEditor({ id: task.id });
  const blankTask = (scheduled = false, start = ''): Task => ({
    id: crypto.randomUUID(),
    title: '',
    category: (filter || 'uncategorized') as Category,
    project: '',
    status: 'todo',
    priority: 'normal',
    date: scheduled ? date : '',
    start,
    end: start === '13:00' ? '13:30' : '',
    deadline: '',
    notes: '',
  });
  const newTask = (scheduled = false, start = '') =>
    setEditor({ newTask: quickDraft || blankTask(scheduled, start) });
  useEffect(
    () =>
      window.vault?.onQuickCapture?.(() => {
        setPage('today');
        setDate(todayDate());
        setEditor({ newTask: { ...blankTask(true), date: todayDate() } });
      }),
    [],
  );
  const pauseTiming = () => {
    if (timerStarted.current !== null) {
      timerSegments.current.push({ start: timerStarted.current, end: Date.now() });
      timerStarted.current = null;
    }
    setRunning(false);
    assistant.setter('timer')({
      taskId: focusedId,
      startedAt: null,
      segments: [...timerSegments.current],
    });
    setElapsed(
      Math.floor(
        timerSegments.current.reduce((sum, segment) => sum + segment.end - segment.start, 0) / 1000,
      ),
    );
  };
  const resetTiming = () => {
    timerSegments.current = [];
    timerStarted.current = null;
    setRunning(false);
    setElapsed(0);
    setFocusedId(null);
    assistant.setter('timer')({ taskId: null, startedAt: null, segments: [] });
  };
  const startTiming = (task: Task) => {
    if (focusedId && focusedId !== task.id && (running || timerSegments.current.length)) {
      setToast('请先保存当前任务的小计，或重置计时。');
      return false;
    }
    setFocusedId(task.id);
    if (timerStarted.current === null) timerStarted.current = Date.now();
    setRunning(true);
    assistant.setter('timer')({
      taskId: task.id,
      startedAt: timerStarted.current,
      segments: [...timerSegments.current],
    });
    return true;
  };
  const openLog = (task: Task) => {
    const ownTimer = focusedId === task.id;
    if (ownTimer) pauseTiming();
    setLogEditor({ id: task.id, segments: ownTimer ? [...timerSegments.current] : [] });
  };
  const updateStatus = (id: string, status: TaskStatus) => {
    if (status === 'done' && focusedId === id) pauseTiming();
    setTasks((previous) => changeTaskStatus(previous, id, status, todayDate()));
  };
  const toggleTask = (task: Task) => {
    if (task.status !== 'done' && focusedId === task.id) pauseTiming();
    updateStatus(task.id, task.status === 'done' ? 'todo' : 'done');
    setToast(task.status === 'done' ? '事项已重新打开' : '已标记完成，执行小计可以继续补充');
  };
  const patchTask = (task: Task) => {
    if (task.status === 'done' && focusedId === task.id) pauseTiming();
    setTasks((previous) =>
      changeTaskStatus(
        previous.map((item) => (item.id === task.id ? { ...task, status: item.status } : item)),
        task.id,
        task.status,
        todayDate(),
      ),
    );
  };
  const saveTask = (task: Task, keepOpen = false) => {
    setTasks((previous) =>
      previous.some((item) => item.id === task.id)
        ? previous.map((item) => (item.id === task.id ? task : item))
        : [...previous, task],
    );
    const next = keepOpen ? { ...task, id: crypto.randomUUID(), title: '', notes: '' } : null;
    setQuickDraft(next);
    setEditor(next ? { newTask: next } : null);
    setToast('事项已添加');
  };
  const currentTask = editor?.newTask || tasks.find((task) => task.id === editor?.id);
  const createReview = () => {
    const text = [
      `${dayLabel(date)} · 今日回顾`,
      '',
      `计划 ${formatDuration(planned)}，已记录 ${formatDuration(actual)}。`,
      `完成 ${done} / ${daily.length} 项。`,
      '',
      '今天留下的成果',
      ...dailyLogs.map((log) => `• ${log.start}—${log.end}  ${log.summary || '待补充小计'}`),
      ...(dailyLogs.length ? [] : ['暂无执行记录，先补充一笔小计。']),
      '',
      '接下来要做',
      ...daily
        .filter((task) => task.status !== 'done')
        .map(
          (task) =>
            `• ${task.title}（${dailyLogs.some((log) => log.taskId === task.id) ? '已有进展' : '未记录'}）`,
        ),
      '',
      '我的想法',
      '今天最有价值的事：',
      '遇到的问题：',
      '明天的重点：',
    ].join('\n');
    setReviews((previous) => ({ ...previous, [date]: text }));
    setToast('已根据任务和小计生成草稿，可以继续补充');
  };
  const exportReview = () => {
    const body = reviews[date];
    if (!body?.trim()) return setToast('先生成或写下今日回顾，再导出');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `AgentValue-回顾-${date}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const counts = categories.map((category) => ({
    category,
    total: dailyLogs
      .filter((log) => tasks.find((task) => task.id === log.taskId)?.category === category)
      .reduce((sum, log) => sum + logMinutes(log), 0),
  }));
  const navigate = (next: Page) => {
    setAssetSelection(null);
    setPage(next);
    setQuery('');
    setFilter('');
    setShowNotifications(false);
  };
  const nav = Object.entries(pageInfo) as [Page, typeof pageInfo.today][];
  const dateControl = (
    <div className="av-date-control">
      <Button className="av-icon" aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))}>
        <ChevronLeft size={17} />
      </Button>
      <label>
        <CalendarDays size={14} />
        <Input
          aria-label="查看日期"
          required
          type="date"
          value={date}
          onChange={(event) => event.target.value && setDate(event.target.value)}
        />
      </label>
      <Button className="av-icon" aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))}>
        <ChevronRight size={17} />
      </Button>
      <Button onClick={() => setDate(todayDate())} className="av-button small">
        今天
      </Button>
    </div>
  );
  const empty = (
    <div className="av-empty">
      <ListTodo size={26} />
      <h3>{query || filter ? '没有匹配的事项' : '暂无事项'}</h3>
      <Button
        className="av-button"
        onClick={() => (query || filter ? (setQuery(''), setFilter('')) : newTask())}
      >
        {query || filter ? '清除筛选' : '新增事项'}
        <Plus size={14} />
      </Button>
    </div>
  );

  if (!assistant.loaded)
    return (
      <div className="av-loading">
        <Spin />
        <p>{assistant.error || '正在读取本地数据'}</p>
        {assistant.error && <Button onClick={assistant.reload}>重试</Button>}
      </div>
    );
  return (
    <div className="av-workbench">
      <aside className="av-sidebar">
        <Button className="av-brand" aria-label="AgentValue" onClick={() => navigate('today')}>
          <span className="av-brand-mark">
            <img src={brandIcon} alt="" />
          </span>
          <span>AgentValue</span>
        </Button>
        <div className="av-nav-label">工作台</div>
        <nav aria-label="助手导航">
          <Menu
            mode="inline"
            selectedKeys={[page]}
            className="av-main-menu"
            onClick={({ key }) => navigate(key as Page)}
            items={nav
              .filter(([key]) => ['today', 'tasks', 'calendar', 'review'].includes(key))
              .map(([key, info]) => ({
                key,
                'aria-label': info.title,
                icon: <info.icon size={18} />,
                label: (
                  <span className="av-menu-label">
                    {info.title}
                    {key === 'tasks' && (
                      <Badge
                        count={tasks.filter((task) => task.status !== 'done').length}
                        color="#849a81"
                      />
                    )}
                  </span>
                ),
              }))}
          />
        </nav>
        <div className="av-nav-label library">工具</div>
        <div className="av-library-label">
          <FolderOpen size={17} />
          我的资产库
          <ChevronDown size={14} />
        </div>
        <nav className="av-library-nav" aria-label="资产库导航">
          <Menu
            mode="inline"
            selectedKeys={[page]}
            className="av-library-menu"
            onClick={({ key }) => navigate(key as Page)}
            items={(['images', 'prompts', 'skills'] as Page[]).map((key) => {
              const info = pageInfo[key];
              return {
                key,
                'aria-label': info.title,
                icon: <info.icon size={17} />,
                label: info.title,
              };
            })}
          />
        </nav>
        <div className="av-sidebar-bottom">
          <span className="av-preview-dot" />
          {assistant.status === 'saving'
            ? '正在保存'
            : assistant.status === 'error'
              ? '保存失败'
              : '本地存储'}
          <small>{assistant.status === 'saved' ? '已保存到本机' : '请查看保存状态'}</small>
          <Button
            className={`av-nav ${page === 'library-settings' ? 'active' : ''}`}
            onClick={() => navigate('library-settings')}
          >
            <Settings2 size={16} />
            资产库设置
          </Button>
        </div>
      </aside>
      <div className="av-main">
        {assistant.status === 'error' && (
          <Alert
            type="error"
            showIcon
            title="数据未保存"
            description={assistant.error}
            action={
              <div>
                <Button onClick={assistant.loaded ? assistant.retry : assistant.reload}>
                  重试
                </Button>
                {assistant.loaded && <Button onClick={assistant.exportDraft}>导出草稿</Button>}
                <Button
                  onClick={() =>
                    confirmation.confirm({
                      title: '重新载入数据',
                      content: '未保存的修改会丢失。请先导出草稿。',
                      onOk: () => window.dispatchEvent(new Event('agentvalue-reload')),
                    })
                  }
                >
                  重新载入
                </Button>
              </div>
            }
          />
        )}
        <header className={`av-topbar ${libraryPage ? 'av-hidden' : ''}`}>
          <div className="av-breadcrumb">
            <strong>{pageInfo[page].title}</strong>
          </div>
          <div className="av-search">
            <Search size={16} />
            <Input
              ref={searchRef}
              aria-label="搜索事项"
              placeholder="搜索事项或项目"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (page === 'assets' || page === 'review') setPage('tasks');
              }}
            />
            <kbd>Ctrl K</kbd>
            {query && (
              <Button className="av-icon" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={13} />
              </Button>
            )}
          </div>
          <Popover
            open={showNotifications}
            onOpenChange={setShowNotifications}
            trigger="click"
            placement="bottomRight"
            classNames={{ root: 'av-notification-popover' }}
            title="待办提醒"
            content={
              <div className="av-notifications">
                {reminders.map((task) => (
                  <Button
                    key={task.id}
                    onClick={() => {
                      openTask(task);
                      setShowNotifications(false);
                    }}
                  >
                    <span className={`av-dot ${task.category}`} />
                    {task.title}
                    <small>
                      {task.deadline && task.deadline < todayDate()
                        ? '已逾期'
                        : task.deadline === todayDate()
                          ? '今天截止'
                          : task.start || '今天待办'}
                    </small>
                  </Button>
                ))}
                {!reminders.length && <p>暂无到期待办</p>}
              </div>
            }
          >
            <Button
              className="av-icon av-bell"
              aria-label="查看今日待办"
              aria-expanded={showNotifications}
            >
              <Bell size={19} />
              {reminders.length > 0 && <i />}
            </Button>
          </Popover>
          {onOpenLibrary && (
            <Button className="av-button small av-return-library" onClick={onOpenLibrary}>
              <ArrowLeft size={13} />
              收藏库
            </Button>
          )}
          <SyncControl />
        </header>
        <main className={`av-content ${libraryPage ? 'av-hidden' : ''}`}>
          <div className="av-page-heading">
            <div>
              <h1>{pageInfo[page].title}</h1>
              <p>
                {page === 'today' || page === 'review'
                  ? dayLabel(date, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })
                  : page === 'tasks'
                    ? `${tasks.length} 项事项 · ${tasks.filter((task) => task.status !== 'done').length} 项未完成`
                    : page === 'calendar'
                      ? dayLabel(date, { year: 'numeric', month: 'long' })
                      : `${tasks.filter((task) => task.asset).length} 项关联工具`}
              </p>
            </div>
            {page !== 'review' && page !== 'assets' && (
              <Button
                className="av-button primary"
                onClick={() => newTask(page === 'today' || page === 'calendar')}
              >
                <Plus size={17} />
                新增事项
              </Button>
            )}
            {page === 'assets' && onOpenLibrary && (
              <Button className="av-button" onClick={onOpenLibrary}>
                打开收藏库
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
          {(page === 'today' || page === 'tasks') && (
            <form
              className="av-capture-bar"
              onSubmit={(event) => {
                event.preventDefault();
                if (!captureTitle.trim()) return;
                const task = { ...blankTask(page === 'today'), title: captureTitle.trim() };
                setTasks((previous) => [...previous, task]);
                setCaptureTitle('');
                setToast(task.date ? '已加入当天待办，时间可稍后安排' : '已加入收件箱');
              }}
            >
              <Plus size={18} />
              <Input
                aria-label="快速记录事项"
                placeholder="新增事项，回车保存"
                value={captureTitle}
                maxLength={160}
                onChange={(event) => setCaptureTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                  )
                    event.preventDefault();
                }}
              />
              <span className="av-capture-context">
                {page === 'today' ? dayLabel(date) : '收件箱'}
              </span>
              <Button
                type="button"
                className="av-button small"
                onClick={() => {
                  const draft = captureTitle.trim()
                    ? { ...blankTask(page === 'today'), title: captureTitle.trim() }
                    : quickDraft || blankTask(page === 'today');
                  setQuickDraft(draft);
                  setEditor({ newTask: draft });
                  setCaptureTitle('');
                }}
              >
                更多设置
              </Button>
            </form>
          )}
          {page === 'today' && (
            <>
              <div className="av-week-strip">
                {days.map((day) => (
                  <Button
                    key={day}
                    className={day === date ? 'selected' : ''}
                    onClick={() => setDate(day)}
                  >
                    <span>{dayLabel(day, { weekday: 'short' })}</span>
                    <strong>{day.slice(8)}</strong>
                    <div>
                      {categories
                        .filter((category) =>
                          tasks.some((task) => task.date === day && task.category === category),
                        )
                        .map((category) => (
                          <i className={category} key={category} />
                        ))}
                    </div>
                  </Button>
                ))}
              </div>
              <div className="av-day-overview">
                <div>
                  <span className="av-stat-icon sage">
                    <CalendarDays size={20} />
                  </span>
                  <span>
                    计划时长<strong>{formatDuration(planned)}</strong>
                  </span>
                  <small>{daily.length} 项事项</small>
                </div>
                <div>
                  <span className="av-stat-icon lavender">
                    <Timer size={20} />
                  </span>
                  <span>
                    已记录时长<strong>{formatDuration(actual)}</strong>
                  </span>
                  <small>{dailyLogs.length} 段记录</small>
                </div>
                <div>
                  <span className="av-stat-icon sand">
                    <CheckCheck size={20} />
                  </span>
                  <span>
                    已完成事项
                    <strong>
                      {done}
                      <em> / {daily.length}</em>
                    </strong>
                  </span>
                  <div className="av-mini-progress">
                    <i style={{ width: `${daily.length ? (done / daily.length) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              {daily.some((task) => !task.start) && (
                <section className="av-panel av-untimed-tasks">
                  <div className="av-section-title">
                    <h2>当天待办 · 未定时间</h2>
                    <span className="av-muted">
                      {daily.filter((task) => !task.start).length} 项
                    </span>
                  </div>
                  {daily
                    .filter((task) => !task.start)
                    .map((task) => (
                      <div className="av-untimed-row" key={task.id}>
                        <Button
                          className={`av-check ${task.status === 'done' ? 'checked' : ''}`}
                          aria-label={`${task.status === 'done' ? '重新打开' : '完成'} ${task.title}`}
                          onClick={() => toggleTask(task)}
                        >
                          {task.status === 'done' && <Check size={13} />}
                        </Button>
                        <Button className="av-untimed-title" onClick={() => openTask(task)}>
                          {task.title}
                          <small>{task.project || categoryInfo[task.category].label}</small>
                        </Button>
                        <Button className="av-button small" onClick={() => openTask(task)}>
                          <Clock3 size={13} />
                          安排时间
                        </Button>
                        <Button
                          className="av-icon"
                          aria-label={`记录 ${task.title}的小计`}
                          onClick={() => openLog(task)}
                        >
                          <BookOpen size={16} />
                        </Button>
                      </div>
                    ))}
                </section>
              )}
              <div className="av-today-columns">
                <section className="av-panel av-schedule-panel">
                  <div className="av-panel-heading">
                    <div>
                      <h2>
                        <Clock3 size={18} />
                        今天的时间轴
                      </h2>
                    </div>
                    <div className="av-legend">
                      {categories.map((category) => (
                        <Button
                          key={category}
                          aria-pressed={filter === category}
                          onClick={() => setFilter(filter === category ? '' : category)}
                        >
                          <i className={category} />
                          {categoryInfo[category].label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {query && (
                    <div className="av-search-caption">
                      找到 {visible.filter((task) => task.date === date).length} 件当天事项
                    </div>
                  )}
                  <TimeGrid
                    tasks={visible}
                    logs={logs}
                    date={date}
                    onOpen={openTask}
                    onNew={() => newTask(true, '13:00')}
                  />
                  <div className="av-schedule-footer">
                    <span>
                      <Circle size={9} />
                      空白时段没有执行记录
                    </span>
                    <span>标线显示当前时间</span>
                  </div>
                </section>
                <aside className="av-day-aside">
                  <section className="av-focus-card">
                    <div className="av-focus-top">
                      <span>
                        <i />
                        {running ? '计时中' : elapsed ? '已暂停' : '未开始'}
                      </span>
                      <Timer size={18} />
                    </div>
                    <span className="av-focus-label">当前专注</span>
                    <h3>{active?.title || '暂无待办事项'}</h3>
                    <p>
                      {active ? active.project || categoryInfo[active.category].label : ''}
                      {active?.asset && ` · ${active.asset}`}
                    </p>
                    <div className="av-focus-time">
                      {elapsedLabel(elapsed)}
                      <span>专注计时</span>
                    </div>
                    <div className="av-focus-actions">
                      <Button
                        className="av-button focus"
                        disabled={!active || active.status === 'done'}
                        onClick={() => {
                          if (running) pauseTiming();
                          else if (active) startTiming(active);
                        }}
                      >
                        {running ? <Pause size={16} /> : <Play size={16} />}
                        {running ? '暂停' : elapsed ? '继续专注' : '开始专注'}
                      </Button>
                      <Button
                        className="av-icon"
                        aria-label="重置专注计时"
                        onClick={() => {
                          resetTiming();
                        }}
                      >
                        <Timer size={17} />
                      </Button>
                    </div>
                    <Button
                      className="av-focus-log"
                      disabled={!active}
                      onClick={() => {
                        if (active) openLog(active);
                      }}
                    >
                      记录执行小计
                      <ArrowRight size={14} />
                    </Button>
                  </section>
                  <section className="av-panel av-priorities">
                    <div className="av-section-title">
                      <h2>今天的重点</h2>
                      <span className="av-muted">
                        {daily.filter((task) => task.priority === 'high').length} 项
                      </span>
                    </div>
                    {daily
                      .filter((task) => task.priority === 'high')
                      .map((task) => (
                        <div
                          className={`av-priority-row ${task.status === 'done' ? 'is-done' : ''}`}
                          key={task.id}
                        >
                          <Button
                            className={`av-check ${task.status === 'done' ? 'checked' : ''}`}
                            aria-label={`${task.status === 'done' ? '重新打开' : '完成'} ${task.title}`}
                            onClick={() => toggleTask(task)}
                          >
                            {task.status === 'done' && <Check size={12} />}
                          </Button>
                          <Button onClick={() => openTask(task)}>
                            {task.title}
                            <small>
                              {task.start} · {task.project}
                            </small>
                          </Button>
                        </div>
                      ))}
                    {!daily.some((task) => task.priority === 'high') && (
                      <p className="av-muted">今天还没选重点。</p>
                    )}
                    <Button className="av-text-button" onClick={() => navigate('tasks')}>
                      查看所有事项
                      <ArrowRight size={14} />
                    </Button>
                  </section>
                  <section className="av-panel av-latest">
                    <div className="av-section-title">
                      <h2>最近的小计</h2>
                      <BookOpen size={16} />
                    </div>
                    {dailyLogs.length ? (
                      [...dailyLogs]
                        .reverse()
                        .slice(0, 2)
                        .map((log) => (
                          <Button
                            key={log.id}
                            onClick={() => {
                              const task = tasks.find((item) => item.id === log.taskId);
                              if (task) openTask(task);
                            }}
                          >
                            <span>
                              {log.start}—{log.end}
                            </span>
                            <p>{log.summary || '待补充小计'}</p>
                          </Button>
                        ))
                    ) : (
                      <p className="av-muted">暂无执行小计</p>
                    )}
                  </section>
                  <Button className="av-reflect-card" onClick={() => navigate('review')}>
                    <span>
                      <BookOpen size={18} />
                      <strong>每日回顾</strong>
                    </span>
                    <ArrowRight size={18} />
                  </Button>
                </aside>
              </div>
            </>
          )}
          {page === 'tasks' && (
            <>
              <div className="av-scope-bar" role="group" aria-label="事项范围">
                {(
                  [
                    ['all', '全部事项'],
                    ['inbox', '收件箱'],
                    ['today', '今天'],
                    ['important', '重要'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    className={`av-chip ${taskScope === value ? 'selected' : ''}`}
                    aria-pressed={taskScope === value}
                    onClick={() => setTaskScope(value)}
                  >
                    {label}
                    <span>
                      {
                        tasks.filter(
                          (task) =>
                            value === 'all' ||
                            (value === 'inbox' && !task.date) ||
                            (value === 'today' && task.date === todayDate()) ||
                            (value === 'important' && task.priority === 'high'),
                        ).length
                      }
                    </span>
                  </Button>
                ))}
              </div>
              <div className="av-toolbar">
                <Segmented
                  aria-label="事项展示方式"
                  value={view}
                  onChange={(value) => setView(value as View)}
                  options={[
                    { value: 'list', label: '清单', icon: <LayoutList size={15} /> },
                    { value: 'board', label: '看板', icon: <LayoutDashboard size={15} /> },
                    { value: 'timeline', label: '时间线', icon: <GitBranch size={15} /> },
                  ]}
                />
                <div className="av-filter-chips">
                  <Button className={!filter ? 'selected' : ''} onClick={() => setFilter('')}>
                    全部 {tasks.length}
                  </Button>
                  {categories.map((category) => (
                    <Button
                      key={category}
                      className={filter === category ? 'selected' : ''}
                      onClick={() => setFilter(category)}
                    >
                      <i className={category} />
                      {categoryInfo[category].label}
                    </Button>
                  ))}
                </div>
                {view === 'timeline' && dateControl}
              </div>
              {view === 'board' && (
                <>
                  <div className="av-board">
                    {statuses.map((status) => (
                      <section
                        className={`av-board-column ${status}`}
                        key={status}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const id = event.dataTransfer.getData('text/plain');
                          if (tasks.some((task) => task.id === id)) {
                            updateStatus(id, status);
                            setToast(`事项已移到“${statusInfo[status]}”`);
                          }
                        }}
                      >
                        <div className="av-board-heading">
                          <span>
                            <i />
                            {statusInfo[status]}
                            <b>{visible.filter((task) => task.status === status).length}</b>
                          </span>
                          <Button
                            className="av-icon"
                            aria-label={`新增${statusInfo[status]}事项`}
                            onClick={() => {
                              const draft: Task = {
                                id: crypto.randomUUID(),
                                title: '',
                                category: (filter || 'uncategorized') as Category,
                                project: '',
                                status,
                                priority: 'normal',
                                date: '',
                                start: '',
                                end: '',
                                deadline: '',
                                notes: '',
                              };
                              setQuickDraft(draft);
                              setEditor({ newTask: draft });
                            }}
                          >
                            <Plus size={16} />
                          </Button>
                        </div>
                        {visible
                          .filter((task) => task.status === status)
                          .map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              onOpen={openTask}
                              onToggle={toggleTask}
                            />
                          ))}
                        {!visible.some((task) => task.status === status) && (
                          <div className="av-column-empty">
                            暂时没有事项
                            <br />
                            也可以把卡片拖到这里
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                  <p className="av-view-hint">
                    <GripVertical size={14} />
                    可拖动卡片改变状态，或打开事项修改状态和时间。
                  </p>
                </>
              )}
              {view === 'list' && (
                <section className="av-panel av-list-panel">
                  <div className="av-list-head">
                    <span>事项</span>
                    <span>计划</span>
                    <span>截止</span>
                    <span>状态</span>
                  </div>
                  {visible.length
                    ? visible.map((task) => (
                        <div className="av-list-row" key={task.id}>
                          <div>
                            <Button
                              className={`av-check ${task.status === 'done' ? 'checked' : ''}`}
                              aria-label={`${task.status === 'done' ? '重新打开' : '完成'} ${task.title}`}
                              onClick={() => toggleTask(task)}
                            >
                              {task.status === 'done' && <Check size={12} />}
                            </Button>
                            <Button className="av-list-title" onClick={() => openTask(task)}>
                              {task.title}
                              <small>
                                <i className={task.category} />
                                {task.project || categoryInfo[task.category].label}
                              </small>
                            </Button>
                          </div>
                          <span>
                            <Button
                              className="av-list-date"
                              onClick={() => openTask(task)}
                              aria-label={`安排 ${task.title}`}
                            >
                              {task.date ? dayLabel(task.date) : '待安排'}
                            </Button>
                            <small>{task.start && `${task.start}—${task.end}`}</small>
                            {!task.date && (
                              <span className="av-list-quick-date">
                                <Button
                                  onClick={() => patchTask({ ...task, date: todayDate() })}
                                  aria-label={`把 ${task.title}安排到今天`}
                                >
                                  今天
                                </Button>
                                <Button
                                  onClick={() =>
                                    patchTask({ ...task, date: shiftDate(todayDate(), 1) })
                                  }
                                  aria-label={`把 ${task.title}安排到明天`}
                                >
                                  明天
                                </Button>
                              </span>
                            )}
                          </span>
                          <span>{task.deadline ? dayLabel(task.deadline) : '—'}</span>
                          <label>
                            <span className="av-sr-only">{task.title}的状态</span>
                            <ChoiceSelect
                              aria-label={`${task.title}的状态`}
                              value={task.status}
                              onChange={(event) =>
                                updateStatus(task.id, event.target.value as TaskStatus)
                              }
                            >
                              {statuses.map((status) => (
                                <option key={status} value={status}>
                                  {statusInfo[status]}
                                </option>
                              ))}
                            </ChoiceSelect>
                          </label>
                        </div>
                      ))
                    : empty}
                </section>
              )}
              {view === 'timeline' && (
                <section className="av-panel">
                  <div className="av-panel-heading">
                    <div>
                      <h2>接下来七天，怎么推进</h2>
                      <p>色块表示计划日，旗标表示截止日；点击事项调整安排。</p>
                    </div>
                    <span className="av-tag neutral">计划与截止分开</span>
                  </div>
                  <ProjectTimeline tasks={visible} date={date} onOpen={openTask} />
                  <div className="av-unscheduled">
                    <span>未排期</span>
                    {visible
                      .filter((task) => !task.date)
                      .map((task) => (
                        <Button key={task.id} onClick={() => openTask(task)}>
                          <Plus size={12} />
                          {task.title}
                        </Button>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
          {page === 'calendar' && (
            <>
              <div className="av-toolbar">
                <Button className="av-button" onClick={() => setCalendarImport(true)}>
                  导入日历
                </Button>
                <Button
                  className="av-button"
                  onClick={() =>
                    downloadText(
                      calendarFile(tasks),
                      'AgentValue-日历.ics',
                      'text/calendar;charset=utf-8',
                    )
                  }
                >
                  导出日历
                </Button>
                <Button
                  className="av-button"
                  onClick={() => {
                    setCalendarView('year');
                    setGoalEditor({
                      id: crypto.randomUUID(),
                      title: '',
                      project: '',
                      category: 'work',
                      hint: '',
                      month: date.slice(0, 7),
                    });
                  }}
                >
                  新增目标
                </Button>
                <Segmented
                  aria-label="日历展示方式"
                  value={calendarView}
                  onChange={(value) => setCalendarView(value as 'week' | 'month' | 'year')}
                  options={[
                    { value: 'week', label: '周安排' },
                    { value: 'month', label: '月历' },
                    { value: 'year', label: '年度目标' },
                  ]}
                />
                {dateControl}
              </div>
              {calendarView === 'week' && (
                <section className="av-panel av-week-calendar">
                  <div className="av-panel-heading">
                    <div>
                      <h2>
                        {dayLabel(days[0])} — {dayLabel(days[6])}
                      </h2>
                    </div>
                    <span className="av-tag neutral">小时日程</span>
                  </div>
                  <div className="av-week-scroll">
                    <div className="av-week-grid">
                      <div className="av-week-grid-head">
                        <span />
                        {days.map((day) => (
                          <Button
                            key={day}
                            className={day === date ? 'selected' : ''}
                            onClick={() => {
                              setDate(day);
                              navigate('today');
                            }}
                          >
                            <span>{dayLabel(day, { weekday: 'short' })}</span>
                            <strong>{day.slice(8)}</strong>
                            <small>{tasks.filter((task) => task.date === day).length} 件事</small>
                          </Button>
                        ))}
                      </div>
                      <div className="av-week-grid-body" style={{ height: weekRange.hours * 54 }}>
                        <div className="av-hours">
                          {Array.from({ length: weekRange.hours + 1 }, (_, i) => (
                            <span key={i} style={{ top: `${(i / weekRange.hours) * 100}%` }}>
                              {i + weekRange.firstHour}:00
                            </span>
                          ))}
                        </div>
                        {days.map((day) => (
                          <div className="av-week-lane" key={day}>
                            {Array.from({ length: weekRange.hours + 1 }, (_, i) => (
                              <div
                                className="av-hour-line"
                                key={i}
                                style={{ top: `${(i / weekRange.hours) * 100}%` }}
                              />
                            ))}
                            {visible
                              .filter((task) => task.date === day && task.start)
                              .map((task) => (
                                <Button
                                  key={task.id}
                                  className={`av-time-block ${task.category} short ${duration(task.start, task.end) < 45 ? 'tiny' : ''}`}
                                  style={{
                                    ...timeStyle(task.start, task.end, weekRange),
                                    ...layoutTimeBlocks(
                                      visible.filter((item) => item.date === day),
                                    ).get(task.id),
                                  }}
                                  onClick={() => openTask(task)}
                                >
                                  <span className="av-block-time">{task.start}</span>
                                  <strong>{task.title}</strong>
                                </Button>
                              ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}
              {calendarView === 'month' &&
                (() => {
                  const year = Number(date.slice(0, 4));
                  const month = Number(date.slice(5, 7));
                  const first = `${year}-${String(month).padStart(2, '0')}-01`;
                  const start = shiftDate(
                    first,
                    -((new Date(`${first}T12:00:00`).getDay() + 6) % 7),
                  );
                  const cells = Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
                  return (
                    <section className="av-panel">
                      <div className="av-panel-heading">
                        <h2>
                          {year} 年 {month} 月
                        </h2>
                        <div className="av-calendar-month-nav">
                          <Button
                            className="av-icon"
                            aria-label="上个月"
                            onClick={() => setDate(shiftDate(first, -1))}
                          >
                            <ChevronLeft size={16} />
                          </Button>
                          <Button
                            className="av-icon"
                            aria-label="下个月"
                            onClick={() =>
                              setDate(shiftDate(first, new Date(year, month, 0).getDate()))
                            }
                          >
                            <ChevronRight size={16} />
                          </Button>
                        </div>
                      </div>
                      <div className="av-month-grid">
                        {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                          <div className="av-month-label" key={day}>
                            周{day}
                          </div>
                        ))}
                        {cells.map((day) => (
                          <div
                            key={day}
                            className={`av-month-cell ${day.slice(5, 7) !== date.slice(5, 7) ? 'outside' : ''} ${day === date ? 'selected' : ''}`}
                          >
                            <Button
                              className="av-month-day"
                              aria-label={`查看${day}`}
                              onClick={() => {
                                setDate(day);
                                navigate('today');
                              }}
                            >
                              {Number(day.slice(8))}
                            </Button>
                            {visible
                              .filter((task) => task.date === day)
                              .slice(0, 3)
                              .map((task) => (
                                <Button
                                  className={`av-month-task ${task.category}`}
                                  key={task.id}
                                  onClick={() => openTask(task)}
                                >
                                  {task.start} {task.title}
                                </Button>
                              ))}
                            {visible.filter((task) => task.date === day).length > 3 && (
                              <Button
                                className="av-more-tasks"
                                onClick={() => {
                                  setDate(day);
                                  navigate('today');
                                }}
                              >
                                还有 {visible.filter((task) => task.date === day).length - 3} 件事
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })()}
              {calendarView === 'year' && (
                <div className="av-goals-layout">
                  <section className="av-year-summary av-panel">
                    <div>
                      <Target size={20} />
                      <h2>{date.slice(0, 4)} 年度概览</h2>
                    </div>
                    <dl className="av-year-stats">
                      <div>
                        <dt>已排期事项</dt>
                        <dd>
                          {tasks.filter((task) => task.date.startsWith(date.slice(0, 4))).length}
                        </dd>
                      </div>
                      <div>
                        <dt>已完成</dt>
                        <dd>
                          {
                            tasks.filter(
                              (task) =>
                                task.date.startsWith(date.slice(0, 4)) && task.status === 'done',
                            ).length
                          }
                        </dd>
                      </div>
                    </dl>
                    <p className="av-muted">统计本年度已排期的事项。</p>
                    <div className="av-year-months">
                      {Array.from({ length: 12 }, (_, i) => {
                        const month = `${date.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
                          records = tasks.filter((t) => t.date.startsWith(month));
                        return (
                          <Button
                            key={month}
                            className="av-button"
                            onClick={() => {
                              setDate(`${month}-01`);
                              setCalendarView('month');
                            }}
                          >
                            <strong>{i + 1} 月</strong>
                            <span>
                              {records.length} 项 ·{' '}
                              {goals.filter((g) => g.period !== 'year' && g.month === month).length}{' '}
                              个目标
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="av-panel av-goal-panel">
                    <div className="av-section-title">
                      <h2>年度与月度目标</h2>

                      <span className="av-tag neutral">{date.slice(5, 7)} 月</span>
                    </div>
                    {goals
                      .filter((goal) =>
                        goal.period === 'year'
                          ? goal.month.slice(0, 4) === date.slice(0, 4)
                          : goal.month === date.slice(0, 7),
                      )
                      .map((goal) => {
                        const linked = tasks.filter(
                          (task) =>
                            task.project === goal.project &&
                            task.date.startsWith(
                              goal.period === 'year' ? goal.month.slice(0, 4) : goal.month,
                            ),
                        );
                        const completed = linked.filter((task) => task.status === 'done').length;
                        return (
                          <div className="av-goal-row" key={goal.id}>
                            <span className={`av-goal-icon ${goal.category}`}>
                              {goal.category === 'work' ? (
                                <Flag size={20} />
                              ) : goal.category === 'study' ? (
                                <BookOpen size={20} />
                              ) : (
                                <Timer size={20} />
                              )}
                            </span>
                            <div>
                              <Button onClick={() => setGoalEditor(goal)}>
                                <h3>
                                  {goal.title} {goal.period === 'year' ? '· 年度' : ''}
                                </h3>
                              </Button>
                              <p>{goal.hint}</p>
                              <div className="av-goal-progress">
                                <i
                                  className={goal.category}
                                  style={{
                                    width: `${linked.length ? (completed / linked.length) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <small>
                                相关事项 {completed} / {linked.length} 已完成
                              </small>
                            </div>
                            <Button
                              className="av-icon"
                              aria-label={`查看${goal.title}的相关事项`}
                              onClick={() => {
                                setPage('tasks');
                                setQuery(goal.project);
                                setView('list');
                              }}
                            >
                              <ArrowRight size={18} />
                            </Button>
                          </div>
                        );
                      })}
                  </section>
                </div>
              )}
              {calendarView !== 'year' && (
                <section className="av-panel av-month-goals">
                  <h2>{date.slice(5, 7)} 月目标</h2>
                  {goals
                    .filter((g) => g.period !== 'year' && g.month === date.slice(0, 7))
                    .map((g) => (
                      <Button key={g.id} className="av-button" onClick={() => setGoalEditor(g)}>
                        {g.title}
                      </Button>
                    ))}
                  {!goals.some((g) => g.period !== 'year' && g.month === date.slice(0, 7)) && (
                    <p className="av-muted">暂无月度目标</p>
                  )}
                </section>
              )}
            </>
          )}
          {page === 'review' && (
            <>
              <div className="av-toolbar">
                {dateControl}
                <div className="av-toolbar-actions">
                  {(['week', 'month'] as const).map((scope) => (
                    <Button
                      key={scope}
                      className="av-button"
                      onClick={() =>
                        setReport({
                          text: periodReport(
                            tasks,
                            logs,
                            date,
                            scope,
                            Object.fromEntries(
                              Object.entries(savedReviews).map(([day, value]) => [day, value.text]),
                            ),
                          ),
                          name: `AgentValue-${scope === 'week' ? '周' : '月'}回顾-${date}.md`,
                        })
                      }
                    >
                      {scope === 'week' ? '周回顾' : '月回顾'}
                    </Button>
                  ))}
                  <Button
                    className="av-button"
                    onClick={() =>
                      downloadText(
                        recordsCsv(tasks, logs),
                        'AgentValue-计划与执行.csv',
                        'text/csv;charset=utf-8',
                      )
                    }
                  >
                    导出记录
                  </Button>
                  <Button className="av-button" onClick={exportReview}>
                    <ArrowDownToLine size={15} />
                    导出回顾
                  </Button>
                  <Button className="av-button primary" onClick={createReview}>
                    <Sparkles size={15} />
                    生成今日回顾
                  </Button>
                </div>
              </div>
              <div className="av-review-columns">
                <div>
                  <section className="av-panel av-allocation">
                    <div className="av-panel-heading">
                      <div>
                        <h2>时间分配</h2>
                        <p>按执行记录统计</p>
                      </div>
                      <strong>{formatDuration(actual)}</strong>
                    </div>
                    <div
                      className="av-allocation-bar"
                      role="img"
                      aria-label={counts
                        .map((item) => `${categoryInfo[item.category].label}${item.total}分钟`)
                        .join('，')}
                    >
                      {counts.map(
                        (item) =>
                          item.total > 0 && (
                            <span
                              className={item.category}
                              key={item.category}
                              style={{ width: `${actual ? (item.total / actual) * 100 : 0}%` }}
                            />
                          ),
                      )}
                    </div>
                    <div className="av-allocation-legend">
                      {counts.map((item) => (
                        <span key={item.category}>
                          <i className={item.category} />
                          {categoryInfo[item.category].label}
                          <strong>{formatDuration(item.total)}</strong>
                        </span>
                      ))}
                    </div>
                    <div className="av-plan-compare">
                      <span>
                        原计划 <strong>{formatDuration(planned)}</strong>
                      </span>
                      <span>
                        已记录 <strong>{formatDuration(actual)}</strong>
                      </span>
                      <span>
                        完成事项{' '}
                        <strong>
                          {done} / {daily.length}
                        </strong>
                      </span>
                    </div>
                  </section>
                  <section className="av-panel av-review-log">
                    <div className="av-section-title">
                      <h2>执行小计</h2>
                      <span className="av-tag neutral">{dailyLogs.length} 段</span>
                    </div>
                    {dailyLogs.map((log) => {
                      const task = tasks.find((item) => item.id === log.taskId);
                      return (
                        <Button
                          key={log.id}
                          className="av-review-log-row"
                          onClick={() => task && openTask(task)}
                        >
                          <span className="av-review-log-time">
                            {log.start}
                            <small>{log.end}</small>
                          </span>
                          <span className={`av-review-log-dot ${task?.category}`} />
                          <div>
                            <strong>{task?.title || '执行记录'}</strong>
                            <p>{log.summary || '待补充小计'}</p>
                            <small>
                              {formatDuration(logMinutes(log))} ·{' '}
                              {task && categoryInfo[task.category].label}
                            </small>
                          </div>
                        </Button>
                      );
                    })}
                    {!dailyLogs.length && (
                      <p className="av-muted">今天还没有小计。在事项详情里记录实际时间和成果。</p>
                    )}
                  </section>
                  <section className="av-panel av-pending">
                    <div className="av-section-title">
                      <h2>未完成事项</h2>
                      <span className="av-muted">
                        {daily.filter((task) => task.status !== 'done').length} 项
                      </span>
                    </div>
                    {daily
                      .filter((task) => task.status !== 'done')
                      .map((task) => (
                        <div key={task.id}>
                          <span>
                            <i className={task.category} />
                            {task.title}
                            <small>
                              {dailyLogs.some((log) => log.taskId === task.id)
                                ? '已有进展'
                                : '未记录'}
                            </small>
                          </span>
                          <Button
                            className="av-button small"
                            onClick={() => {
                              setTasks((previous) =>
                                previous.map((item) =>
                                  item.id === task.id
                                    ? { ...item, date: shiftDate(date, 1) }
                                    : item,
                                ),
                              );
                              setToast('计划已移到明天，原执行记录仍然保留');
                            }}
                          >
                            移到明天
                            <ArrowRight size={12} />
                          </Button>
                        </div>
                      ))}
                    {daily.every((task) => task.status === 'done') && (
                      <p className="av-muted">暂无未完成事项</p>
                    )}
                  </section>
                </div>
                <section className="av-panel av-journal">
                  <div className="av-section-title">
                    <h2>
                      <BookOpen size={18} />
                      回顾记录
                    </h2>
                    <span className="av-tag neutral">可编辑</span>
                  </div>
                  {savedReviews[date] && savedReviews[date].signature !== reviewSignature && (
                    <div className="av-review-update">
                      执行记录或计划有更新，已保存的回顾保持原样。需要时可重新生成。
                    </div>
                  )}
                  <Textarea
                    aria-label="每日回顾正文"
                    placeholder={'完成成果\n\n遇到的问题\n\n明日计划'}
                    value={reviews[date] || ''}
                    onChange={(event) =>
                      setReviews((previous) => ({ ...previous, [date]: event.target.value }))
                    }
                  />
                  <div className="av-journal-footer">
                    <span>
                      {savedReviews[date]
                        ? savedReviews[date].text === reviews[date]
                          ? '已保存到本机'
                          : '有尚未保存的修改'
                        : '尚未保存'}
                    </span>
                    <Button
                      className="av-button primary"
                      onClick={() => {
                        if (!reviews[date]?.trim())
                          return setToast('请填写回顾内容，或生成回顾草稿');
                        setSavedReviews((previous) => ({
                          ...previous,
                          [date]: { text: reviews[date], signature: reviewSignature },
                        }));
                        setToast('回顾已更新');
                      }}
                    >
                      <Check size={15} />
                      保存回顾
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === 'assets' && (
            <>
              <div className="av-asset-grid">
                {tasks
                  .filter((task) => task.asset)
                  .map((task) => (
                    <article className="av-panel av-asset-card" key={task.id}>
                      <div className={`av-asset-icon ${task.category}`}>
                        {task.category === 'study' ? (
                          <BookOpen size={23} />
                        ) : (
                          <Sparkles size={23} />
                        )}
                      </div>
                      <span className="av-tag neutral">
                        {task.category === 'study' ? 'Skill' : '文本 Prompt'}
                      </span>
                      <h2>{task.asset}</h2>
                      <p>用于：{task.title}</p>
                      <Button className="av-text-button" onClick={() => openTask(task)}>
                        查看关联事项
                        <ArrowRight size={14} />
                      </Button>
                    </article>
                  ))}
              </div>
            </>
          )}
        </main>
        {libraryPage && (
          <App
            selectedAsset={assetSelection}
            embedded
            libraryPage={libraryPage}
            onNavigate={(next) =>
              navigate(
                next === 'settings'
                  ? 'library-settings'
                  : next === 'skills'
                    ? 'skills'
                    : next === 'text'
                      ? 'prompts'
                      : 'images',
              )
            }
          />
        )}
      </div>
      {toast && <Feedback text={toast} />}
      {calendarImport && (
        <CalendarTransfer
          tasks={tasks}
          date={date}
          onClose={() => setCalendarImport(false)}
          onImport={(incoming) => {
            setTasks((previous) => [
              ...previous,
              ...incoming.filter((task) => !previous.some((item) => item.id === task.id)),
            ]);
            setCalendarImport(false);
            setToast(`已导入 ${incoming.length} 项日历事项`);
          }}
        />
      )}
      {report && (
        <ModalShell title="周期回顾" wide onClose={() => setReport(null)}>
          <div className="av-quick-form">
            <Textarea
              aria-label="周期回顾正文"
              rows={16}
              value={report.text}
              onChange={(event) => setReport({ ...report, text: event.target.value })}
            />
            <Button
              className="av-button primary"
              onClick={() => downloadText(report.text, report.name, 'text/markdown;charset=utf-8')}
            >
              导出 Markdown
            </Button>
          </div>
        </ModalShell>
      )}
      {goalEditor && (
        <GoalEditor
          goal={goalEditor}
          onClose={() => setGoalEditor(null)}
          onSave={(goal) => {
            setGoals((previous) => [...previous.filter((g) => g.id !== goal.id), goal]);
            setGoalEditor(null);
          }}
          onDelete={() =>
            confirmation.confirm({
              title: '删除目标',
              content: '关联事项会保留。',
              onOk: () => {
                setGoals((previous) => previous.filter((g) => g.id !== goalEditor.id));
                setGoalEditor(null);
              },
            })
          }
        />
      )}
      {currentTask &&
        !logEditor &&
        (editor?.newTask ? (
          <QuickAdd
            task={currentTask}
            anchor={todayDate()}
            onDraft={(draft) => {
              setQuickDraft(draft);
              setEditor({ newTask: draft });
            }}
            onClose={() => {
              setQuickDraft(currentTask);
              setEditor(null);
            }}
            onSave={saveTask}
          />
        ) : (
          <TaskDetails
            key={currentTask.id}
            task={currentTask}
            logs={logs}
            anchor={todayDate()}
            onClose={() => setEditor(null)}
            onChange={patchTask}
            onDelete={() =>
              confirmation.confirm({
                title: '删除事项',
                content: '该事项及其执行小计会一起删除。',
                okText: '删除',
                cancelText: '取消',
                okButtonProps: { danger: true },
                onOk: () => {
                  assistant.change((previous) => ({
                    ...previous,
                    tasks: previous.tasks.filter((t) => t.id !== currentTask.id),
                    logs: previous.logs.filter((l) => l.taskId !== currentTask.id),
                    timer:
                      previous.timer.taskId === currentTask.id
                        ? { taskId: null, startedAt: null, segments: [] }
                        : previous.timer,
                  }));
                  if (focusedId === currentTask.id) {
                    timerSegments.current = [];
                    timerStarted.current = null;
                    setFocusedId(null);
                    setRunning(false);
                    setElapsed(0);
                  }
                  setEditor(null);
                },
              })
            }
            onAsset={async () => {
              try {
                const state = await libraryCall<State>('state');
                const prompt = state.prompts.find((p) => p.id === currentTask.assetId);
                setEditor(null);
                navigate(
                  currentTask.assetKind === 'skill'
                    ? 'skills'
                    : prompt?.kind === 'image'
                      ? 'images'
                      : 'prompts',
                );
                setAssetSelection({ type: currentTask.assetKind!, id: currentTask.assetId! });
              } catch (error) {
                setToast(error instanceof Error ? error.message : '打开失败');
              }
            }}
            onLog={() => openLog(currentTask)}
            onEditLog={(log) => setLogEditor({ id: currentTask.id, segments: [], existing: log })}
            onFocus={() => {
              if (startTiming(currentTask)) {
                setEditor(null);
                navigate('today');
              }
            }}
          />
        ))}
      {logEditor && tasks.find((task) => task.id === logEditor.id) && (
        <LogEditor
          task={tasks.find((task) => task.id === logEditor.id)!}
          date={date}
          segments={logEditor.segments}
          existing={logEditor.existing}
          onClose={() => setLogEditor(null)}
          onDelete={() =>
            confirmation.confirm({
              title: '删除执行小计',
              content: '删除后会重新计算执行时长。',
              okText: '删除',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: () => {
                setLogs((previous) => previous.filter((l) => l.id !== logEditor.existing?.id));
                setLogEditor(null);
              },
            })
          }
          onSave={(entries, complete, timed) => {
            setLogs((previous) => [
              ...previous.filter((log) => log.id !== logEditor.existing?.id),
              ...entries,
            ]);
            if (complete) updateStatus(logEditor.id, 'done');
            if (timed) resetTiming();
            setLogEditor(null);
            setToast('执行小计已更新');
          }}
        />
      )}
    </div>
  );
}
