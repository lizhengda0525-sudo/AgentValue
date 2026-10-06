import ICAL from 'ical.js';
import { shiftDate, type Task } from './model.ts';
import { localDate, localTime } from './flow.ts';

export function calendarFile(tasks: Task[]) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//AgentValue//V2.0//ZH');
  for (const task of tasks.filter((item) => item.date)) {
    const event = new ICAL.Component('vevent');
    event.updatePropertyWithValue('uid', `${task.id}@agentvalue.local`);
    event.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
    event.updatePropertyWithValue('summary', task.title);
    event.updatePropertyWithValue('description', task.notes);
    const start = task.start ? `${task.date}T${task.start}:00` : task.date;
    const end =
      task.end && task.end !== '24:00'
        ? `${task.date}T${task.end}:00`
        : `${shiftDate(task.date, 1)}${task.start ? 'T00:00:00' : ''}`;
    event.updatePropertyWithValue(
      'dtstart',
      task.start ? ICAL.Time.fromDateTimeString(start) : ICAL.Time.fromDateString(start),
    );
    event.updatePropertyWithValue(
      'dtend',
      task.start ? ICAL.Time.fromDateTimeString(end) : ICAL.Time.fromDateString(end),
    );
    calendar.addSubcomponent(event);
  }
  return calendar.toString() + '\r\n';
}
export async function parseCalendar(
  text: string,
  anchor: string,
): Promise<{ tasks: Task[]; warnings: string[] }> {
  if (text.length > 2 * 1024 ** 2) throw new Error('日历文件不能超过 2 MB');
  const calendar = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
  if (calendar.name !== 'vcalendar') throw new Error('请选择有效的 ICS 日历文件');
  const components = calendar.getAllSubcomponents('vevent');
  if (components.length > 2000) throw new Error('日历事件超过 2000 个，请分批导入');
  const tasks: Task[] = [],
    warnings: string[] = [];
  const from = new Date(`${anchor}T00:00:00`).getTime(),
    until = new Date(`${shiftDate(anchor, 365)}T00:00:00`).getTime();
  const known = new Set<string>();
  for (const component of components) {
    const event = new ICAL.Event(component);
    if (
      event.isRecurrenceException() &&
      components.some(
        (c) => c.getFirstPropertyValue('uid') === event.uid && !c.hasProperty('recurrence-id'),
      )
    )
      continue;
    const title = event.summary || '日历事项';
    try {
      if (!event.uid || !component.hasProperty('dtstart')) throw new Error('缺少 UID 或开始日期');
      for (const name of ['dtstart', 'dtend']) {
        const prop = component.getFirstProperty(name);
        const tzid = prop?.getParameter('tzid');
        if (tzid && !calendar.getTimeZoneByID(String(tzid)))
          throw new Error(`时区 ${tzid} 缺少 VTIMEZONE 定义`);
      }
      const occurrences = [];
      if (event.isRecurring()) {
        const iterator = event.iterator();
        let count = 0,
          next;
        while ((next = iterator.next())) {
          if (++count > 20000) throw new Error('重复次数过多，请导出有限日期范围');
          const details = event.getOccurrenceDetails(next);
          if (details.startDate.toJSDate().getTime() >= until) break;
          if (details.endDate.toJSDate().getTime() > from) occurrences.push(details);
        }
      } else occurrences.push({ startDate: event.startDate, endDate: event.endDate, item: event });
      const imported: Task[] = [];
      for (const occurrence of occurrences) {
        if (occurrence.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
        const start = occurrence.startDate.toJSDate().getTime(),
          end = occurrence.endDate.toJSDate().getTime();
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end <= start ||
          end - start > 366 * 86400000
        )
          throw new Error('事件时间范围无效或未注明结束时间');
        const allDay = occurrence.startDate.isDate;
        let day = localDate(start);
        const last = localDate(end === start ? end : end - 1);
        while (day <= last) {
          const segmentStart = allDay ? '' : day === localDate(start) ? localTime(start) : '00:00';
          const roundedEnd = Math.ceil(end / 60000) * 60000;
          const segmentEnd = allDay
            ? ''
            : day === localDate(roundedEnd - 1) && localTime(roundedEnd) !== '00:00'
              ? localTime(roundedEnd)
              : '24:00';
          const key = `${event.uid}:${occurrence.startDate.toString()}:${day}`;
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))),
          )
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const own = event.uid.endsWith('@agentvalue.local') ? event.uid.slice(0, -17) : '';
          const id =
            /^[A-Za-z0-9-]{1,100}$/.test(own) && !event.isRecurring() && day === last
              ? own
              : `ics-${digest}`;
          if (!known.has(id))
            imported.push({
              id,
              title: (occurrence.item.summary || title).slice(0, 160),
              category: 'uncategorized',
              project: '',
              status: 'todo',
              priority: 'normal',
              date: day,
              start: segmentStart,
              end: segmentEnd,
              deadline: '',
              notes: String(occurrence.item.description || '').slice(0, 20000),
            });
          known.add(id);
          day = shiftDate(day, 1);
          if (tasks.length + imported.length > 5000)
            throw new Error('展开后超过 5000 条事项，请缩小日期范围');
        }
      }
      tasks.push(...imported);
    } catch (error) {
      warnings.push(`${title}：${error instanceof Error ? error.message : '解析失败'}`);
    }
  }
  return { tasks, warnings };
}
