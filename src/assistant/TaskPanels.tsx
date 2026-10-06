import { Button, Input, Textarea, Disclosure, Feedback } from '../ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Check, Flag, Plus, Play, Timer } from 'lucide-react';
import { ModalShell } from '../ModalShell';
import { ChoiceSelect } from '../ChoiceSelect';
import { libraryCall } from '../library-client';
import type { State } from '../types';
import {
  categoryInfo,
  dayLabel,
  duration,
  formatDuration,
  logMinutes,
  shiftDate,
  statusInfo,
  type Category,
  type Task,
  type TaskStatus,
  type WorkLog,
} from './model';
import { endTime, localDate, localTime, segmentsToLogs, type TimedSegment } from './flow';

export function PlanFields({
  task,
  anchor,
  onChange,
}: {
  task: Task;
  anchor: string;
  onChange: (patch: Partial<Task>) => void;
}) {
  const [customDate, setCustomDate] = useState(false);
  const length = task.start && task.end ? duration(task.start, task.end) : 30;
  const [customLength, setCustomLength] = useState(length || 30);
  const setDate = (date: string) => onChange(date ? { date } : { date: '', start: '', end: '' });
  const setLength = (value: number) => {
    setCustomLength(value);
    onChange({ end: endTime(task.start, value) });
  };
  return (
    <section className="av-plan-fields" aria-label="计划安排">
      <div className="av-option-row" role="group" aria-label="快捷计划日期">
        {[
          ['', '不安排'],
          [anchor, '今天'],
          [shiftDate(anchor, 1), '明天'],
        ].map(([value, label]) => (
          <Button
            type="button"
            key={label}
            aria-pressed={task.date === value}
            className={`av-chip ${task.date === value ? 'selected' : ''}`}
            onClick={() => setDate(value)}
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          className={`av-chip ${customDate ? 'selected' : ''}`}
          onClick={() => setCustomDate(!customDate)}
        >
          <CalendarDays size={14} />
          {task.date && task.date !== anchor && task.date !== shiftDate(anchor, 1)
            ? dayLabel(task.date)
            : '自选日期'}
        </Button>
      </div>
      {customDate && (
        <label>
          计划日期
          <Input
            name="date"
            type="date"
            value={task.date}
            onInput={(event) => setDate(event.currentTarget.value)}
          />
        </label>
      )}
      {task.date && !task.start && (
        <Button
          type="button"
          className="av-text-button"
          onClick={() => onChange({ start: '09:00', end: endTime('09:00', customLength) })}
        >
          <Timer size={14} />
          设置时间（可选）
        </Button>
      )}
      {task.date && task.start && (
        <div className="av-plan-time">
          <div className="av-form-grid">
            <label>
              开始时间
              <Input
                name="start"
                type="time"
                value={task.start}
                onInput={(event) =>
                  onChange({
                    start: event.currentTarget.value,
                    end: endTime(event.currentTarget.value, customLength),
                  })
                }
              />
            </label>
            <label>
              时长（分钟）
              <Input
                name="length"
                type="number"
                min={1}
                max={1440}
                value={customLength}
                onChange={(event) => setLength(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="av-option-row" role="group" aria-label="快捷计划时长">
            {[15, 30, 60, 90].map((value) => (
              <Button
                key={value}
                type="button"
                aria-pressed={customLength === value}
                className={`av-chip ${customLength === value ? 'selected' : ''}`}
                onClick={() => setLength(value)}
              >
                {value} 分钟
              </Button>
            ))}
            <Button
              type="button"
              className="av-chip"
              onClick={() => onChange({ start: '', end: '' })}
            >
              取消时间
            </Button>
          </div>
          <p className={task.end ? 'av-plan-result' : 'av-error'}>
            {task.end
              ? `${dayLabel(task.date)} · ${task.start}—${task.end}`
              : '请设置有效时长；跨日任务可分两段安排。'}
          </p>
        </div>
      )}
    </section>
  );
}

export function QuickAdd({
  task,
  anchor,
  onDraft,
  onClose,
  onSave,
}: {
  task: Task;
  anchor: string;
  onDraft: (task: Task) => void;
  onClose: () => void;
  onSave: (task: Task, keepOpen: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [keepOpen, setKeepOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    setError('');
  }, [task.id]);
  const change = (patch: Partial<Task>) => onDraft({ ...task, ...patch });
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!task.title.trim()) return setError('请输入事项名称。');
    if (task.start && (!task.date || !task.end)) return setError('请调整计划时间或取消时间。');
    onSave({ ...task, title: task.title.trim() }, keepOpen);
  };
  return (
    <ModalShell
      title="快速新增"
      className="av-editor av-quick-add"
      initialFocus="[name=title]"
      onClose={onClose}
    >
      <form
        className="av-quick-form"
        onSubmit={save}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <span className="av-tag neutral">
          {task.date
            ? `${dayLabel(task.date)} · ${task.start ? `${task.start}—${task.end}` : '未定时间'}`
            : '收件箱'}
          {task.status !== 'todo' && ` · ${statusInfo[task.status]}`}
        </span>
        <label className="av-quick-title">
          事项名称
          <Input
            ref={titleRef}
            name="title"
            maxLength={160}
            placeholder="输入事项名称，回车保存"
            value={task.title}
            onChange={(event) => {
              setError('');
              change({ title: event.target.value });
            }}
            required
          />
        </label>
        <PlanFields key={task.id} task={task} anchor={anchor} onChange={change} />
        <Disclosure className="av-more-properties">
          <summary>
            更多属性
            {task.category !== 'uncategorized' || task.project || task.deadline || task.notes
              ? ' · 已设置'
              : ''}
          </summary>
          <div className="av-form-grid">
            <label>
              分类
              <ChoiceSelect
                aria-label="分类"
                name="category"
                value={task.category}
                onChange={(event) => change({ category: event.target.value as Category })}
              >
                {Object.entries(categoryInfo).map(([key, info]) => (
                  <option value={key} key={key}>
                    {info.label}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
            <label>
              项目
              <Input
                name="project"
                value={task.project}
                onChange={(event) => change({ project: event.target.value })}
                placeholder="可稍后添加"
              />
            </label>
            <label>
              截止日期
              <Input
                type="date"
                name="deadline"
                value={task.deadline}
                onInput={(event) => change({ deadline: event.currentTarget.value })}
              />
            </label>
            <label>
              优先级
              <ChoiceSelect
                aria-label="优先级"
                name="priority"
                value={task.priority}
                onChange={(event) => change({ priority: event.target.value as Task['priority'] })}
              >
                <option value="normal">普通</option>
                <option value="high">重要</option>
              </ChoiceSelect>
            </label>
          </div>
          <label>
            备注
            <Textarea
              name="notes"
              rows={2}
              value={task.notes}
              onChange={(event) => change({ notes: event.target.value })}
              placeholder="任务要求或下一步"
            />
          </label>
        </Disclosure>
        {error && (
          <p role="alert" className="av-error">
            {error}
          </p>
        )}
        <div className="av-quick-footer">
          <label className="av-inline-check">
            <Input
              type="checkbox"
              checked={keepOpen}
              onChange={(event) => setKeepOpen(event.target.checked)}
            />
            连续添加
          </label>
          <Button type="submit" className="av-button primary">
            <Plus size={15} />
            添加事项
          </Button>
        </div>
        <p className="av-session-note">只填名称即可添加；日期和属性可稍后补充。</p>
      </form>
    </ModalShell>
  );
}

export function TaskDetails({
  task,
  logs,
  anchor,
  onClose,
  onChange,
  onLog,
  onEditLog,
  onFocus,
  onDelete,
  onAsset,
}: {
  task: Task;
  logs: WorkLog[];
  anchor: string;
  onClose: () => void;
  onChange: (task: Task) => void;
  onLog: () => void;
  onEditLog: (log: WorkLog) => void;
  onFocus: () => void;
  onDelete: () => void;
  onAsset: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState('');
  const [assets, setAssets] = useState<State>({ prompts: [], skills: [], root: '', schema: 3 });
  useEffect(() => {
    libraryCall<State>('state')
      .then(setAssets)
      .catch((e) => setError(e.message));
  }, []);
  const change = (patch: Partial<Task>) => {
    if ((patch.start === undefined ? task.start : patch.start) && patch.end === '')
      return setError('时长无效，请选择较短时长。');
    setError('');
    onChange({ ...task, ...patch });
  };
  const related = logs.filter((log) => log.taskId === task.id);
  const saveTitle = () => {
    if (title.trim()) {
      if (title.trim() !== task.title) change({ title: title.trim() });
    } else {
      setTitle(task.title);
      setError('事项名称不能为空。');
    }
  };
  return (
    <ModalShell
      title="事项详情"
      className="av-editor av-task-drawer"
      overlayClassName="av-drawer-overlay"
      initialFocus="[name=title]"
      onClose={() => {
        saveTitle();
        onClose();
      }}
    >
      <div className="av-detail-body">
        <label className="av-detail-title">
          <span className="av-sr-only">事项名称</span>
          <Input
            name="title"
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                event.currentTarget.blur();
            }}
          />
        </label>
        <div className="av-detail-status">
          <label>
            <span className="av-sr-only">事项状态</span>
            <ChoiceSelect
              aria-label="事项状态"
              value={task.status}
              onChange={(event) => change({ status: event.target.value as TaskStatus })}
            >
              {Object.entries(statusInfo).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </ChoiceSelect>
          </label>
          <Button
            className={`av-chip ${task.priority === 'high' ? 'selected' : ''}`}
            aria-pressed={task.priority === 'high'}
            onClick={() => change({ priority: task.priority === 'high' ? 'normal' : 'high' })}
          >
            <Flag size={14} />
            重要
          </Button>
        </div>
        <div className="av-detail-section">
          <h3>
            <CalendarDays size={16} />
            计划安排
          </h3>
          <PlanFields task={task} anchor={anchor} onChange={change} />
        </div>
        <Disclosure className="av-more-properties">
          <summary>分类、项目与截止日期</summary>
          <div className="av-form-grid">
            <label>
              分类
              <ChoiceSelect
                aria-label="分类"
                value={task.category}
                onChange={(event) => change({ category: event.target.value as Category })}
              >
                {Object.entries(categoryInfo).map(([key, info]) => (
                  <option key={key} value={key}>
                    {info.label}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
            <label>
              项目
              <Input
                value={task.project}
                onChange={(event) => change({ project: event.target.value })}
                placeholder="未设置项目"
              />
            </label>
          </div>
          <label>
            截止日期
            <Input
              type="date"
              value={task.deadline}
              onInput={(event) => change({ deadline: event.currentTarget.value })}
            />
          </label>
        </Disclosure>
        <label>
          备注
          <Textarea
            rows={3}
            maxLength={20000}
            value={task.notes}
            placeholder="补充任务要求或下一步"
            onChange={(event) => change({ notes: event.target.value })}
          />
        </label>
        <div className="av-form-grid">
          <label>
            重复规则
            <ChoiceSelect
              aria-label="重复规则"
              value={task.repeat || 'none'}
              onChange={(event) => change({ repeat: event.target.value as Task['repeat'] })}
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekdays">工作日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </ChoiceSelect>
          </label>
          <label className="av-inline-check">
            <Input
              type="checkbox"
              checked={!!task.remind}
              onChange={(event) => change({ remind: event.target.checked })}
            />
            桌面提醒
          </label>
        </div>
        <p className="av-muted">
          重复事项完成后生成下一次。桌面提醒在计划时间触发；未定时间的当天事项在 09:00
          提醒。需保持桌面软件运行。
        </p>
        <label>
          关联工具
          <ChoiceSelect
            aria-label="关联工具"
            value={task.assetId ? `${task.assetKind}:${task.assetId}` : ''}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(':');
              const record =
                kind === 'prompt'
                  ? assets.prompts.find((p) => p.id === id)
                  : assets.skills.find((s) => s.id === id);
              change({
                assetId: id || undefined,
                assetKind: id ? (kind as 'prompt' | 'skill') : undefined,
                asset: record ? ('title' in record ? record.title : record.name) : undefined,
              });
            }}
          >
            <option value="">不关联</option>
            {assets.prompts.map((p) => (
              <option key={p.id} value={`prompt:${p.id}`}>
                {p.kind === 'text' ? 'Prompt' : '图片提示词'} · {p.title}
              </option>
            ))}
            {assets.skills.map((s) => (
              <option key={s.id} value={`skill:${s.id}`}>
                Skill · {s.name}
              </option>
            ))}
          </ChoiceSelect>
        </label>
        {task.assetId && (
          <Button className="av-text-button" onClick={onAsset}>
            <BookOpen size={16} />
            打开关联工具
          </Button>
        )}
        <div className="av-detail-section">
          <h3>
            <Timer size={16} />
            执行记录
            <span>
              {formatDuration(related.reduce((total, log) => total + logMinutes(log), 0))}
            </span>
          </h3>
          {related.length ? (
            related.map((log) => (
              <Button
                className="av-log-entry"
                key={log.id}
                onClick={() => onEditLog(log)}
                aria-label={`编辑 ${dayLabel(log.date)} ${log.start} 的小计`}
              >
                <span>
                  {dayLabel(log.date)} · {log.start}—{log.end}
                  <b>{formatDuration(logMinutes(log))}</b>
                </span>
                <p>{log.summary || '待补充小计'}</p>
                <small>编辑小计</small>
              </Button>
            ))
          ) : (
            <p className="av-muted">暂无执行记录</p>
          )}
          <Button className="av-text-button" onClick={onLog}>
            <Plus size={14} />
            添加执行小计
          </Button>
        </div>
        {error && (
          <p role="alert" className="av-error">
            {error}
          </p>
        )}
      </div>
      <div className="av-detail-footer">
        <span>
          <Check size={13} />
          修改自动保存
        </span>
        <div>
          <Button danger onClick={onDelete}>
            删除事项
          </Button>
          <Button className="av-button" onClick={onFocus} disabled={task.status === 'done'}>
            <Play size={14} />
            开始专注
          </Button>
          <Button className="av-button primary" onClick={onLog}>
            <BookOpen size={14} />
            记录小计
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function LogEditor({
  task,
  date,
  segments,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  date: string;
  segments: TimedSegment[];
  existing?: WorkLog;
  onClose: () => void;
  onSave: (entries: WorkLog[], complete: boolean, timed: boolean) => void;
  onDelete: () => void;
}) {
  const [useTimer, setUseTimer] = useState(segments.length > 0);
  const [recordDate, setRecordDate] = useState(existing?.date || date);
  const [start, setStart] = useState(existing?.start || '');
  const [length, setLength] = useState(existing ? logMinutes(existing) : 30);
  const [summary, setSummary] = useState(existing?.summary || '');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [recent, setRecent] = useState<TimedSegment[] | null>(null);
  const timedEntries = segmentsToLogs(task.id, segments, summary.trim());
  const end = endTime(start, length);
  const justNow = (value: number) => {
    const end = Date.now();
    setUseTimer(false);
    setRecent([{ start: end - value * 60000, end }]);
    setRecordDate(localDate(end - value * 60000));
    setStart(localTime(end - value * 60000));
    setLength(value);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    let entries: WorkLog[];
    if (
      existing &&
      !recent &&
      recordDate === existing.date &&
      start === existing.start &&
      length === logMinutes(existing)
    )
      entries = [{ ...existing, summary: summary.trim() }];
    else if (useTimer) entries = timedEntries;
    else if (recent)
      entries = segmentsToLogs(task.id, recent, summary.trim()).map((log) => ({
        ...log,
        source: 'manual',
      }));
    else {
      if (!recordDate || !start || !end)
        return setError('请设置实际开始时间和有效时长，或选择“刚刚”快捷补录。');
      entries = [
        {
          id: crypto.randomUUID(),
          taskId: task.id,
          date: recordDate,
          start,
          end,
          summary: summary.trim(),
          source: 'manual',
        },
      ];
    }
    if (!entries.length) return setError('计时时间不足，请继续计时或手动补录。');
    onSave(entries, complete, segments.length > 0);
  };
  return (
    <ModalShell
      title={existing ? '编辑执行小计' : '记录执行小计'}
      className="av-editor av-quick-log"
      initialFocus="[name=summary]"
      onClose={onClose}
    >
      <form className="av-quick-form" onSubmit={save}>
        <h3 className="av-log-task-name">{task.title}</h3>
        {useTimer ? (
          <div className="av-timer-summary">
            <span>
              <Timer size={16} />
              计时记录 ·{' '}
              {formatDuration(timedEntries.reduce((sum, log) => sum + logMinutes(log), 0))}
            </span>
            {timedEntries.map((log) => (
              <p key={`${log.date}-${log.start}-${log.seconds}`}>
                {dayLabel(log.date)} · {log.start}—{log.end} · {formatDuration(logMinutes(log))}
              </p>
            ))}
            <Button type="button" className="av-text-button" onClick={() => setUseTimer(false)}>
              改为手动补录
            </Button>
          </div>
        ) : (
          <>
            <div className="av-option-row" role="group" aria-label="快捷补录">
              {[15, 30, 60].map((value) => (
                <Button
                  type="button"
                  key={value}
                  className={`av-chip ${recent && length === value ? 'selected' : ''}`}
                  onClick={() => justNow(value)}
                >
                  刚刚 {value} 分钟
                </Button>
              ))}
            </div>
            <div className="av-form-grid three">
              <label>
                记录日期
                <Input
                  type="date"
                  name="logDate"
                  value={recordDate}
                  onInput={(event) => {
                    setRecent(null);
                    setRecordDate(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                实际开始
                <Input
                  type="time"
                  name="logStart"
                  value={start}
                  onInput={(event) => {
                    setRecent(null);
                    setStart(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                时长（分钟）
                <Input
                  type="number"
                  name="logLength"
                  min={1}
                  max={1440}
                  value={length}
                  onChange={(event) => {
                    setRecent(null);
                    setLength(Number(event.target.value));
                  }}
                />
              </label>
            </div>
            <p className="av-plan-result">
              {recent
                ? `${dayLabel(localDate(recent[0].start))} ${localTime(recent[0].start)} — ${dayLabel(localDate(recent[0].end))} ${localTime(recent[0].end)}`
                : recordDate && start && end
                  ? `${dayLabel(recordDate)} · ${start}—${end}`
                  : '选择快捷补录，或填写实际开始与时长。'}
            </p>
          </>
        )}
        <label className="av-log-summary-label">
          成果与下一步 <span>可稍后补充</span>
          <Textarea
            name="summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="完成了什么，还有什么待处理"
          />
        </label>
        {error && (
          <p role="alert" className="av-error">
            {error}
          </p>
        )}
        <div className="av-quick-footer">
          {existing && (
            <Button danger onClick={onDelete}>
              删除小计
            </Button>
          )}
          <label className="av-inline-check">
            <Input
              type="checkbox"
              checked={complete}
              onChange={(event) => setComplete(event.target.checked)}
            />
            同时标记完成
          </label>
          <Button className="av-button primary" type="submit">
            保存小计
            <ArrowRight size={14} />
          </Button>
        </div>
        <p className="av-session-note">核对实际时间后保存，不会自动采用计划时间。</p>
      </form>
    </ModalShell>
  );
}
