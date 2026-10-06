import { minutes, type WorkLog } from './model.ts';

export type TimedSegment = { start: number; end: number };
export const localDate = (value: number) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const localTime = (value: number) => {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export function endTime(start: string, length: number) {
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !Number.isInteger(length) ||
    length <= 0 ||
    minutes(start) + length > 1440
  )
    return '';
  const end = minutes(start) + length;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}
export function segmentsToLogs(
  taskId: string,
  segments: TimedSegment[],
  summary: string,
): WorkLog[] {
  return segments.flatMap((segment) => {
    const result: WorkLog[] = [];
    let start = segment.start;
    while (start < segment.end) {
      const boundary = new Date(start);
      boundary.setHours(24, 0, 0, 0);
      const end = Math.min(boundary.getTime(), segment.end);
      result.push({
        id: crypto.randomUUID(),
        taskId,
        date: localDate(start),
        start: localTime(start),
        end: end === boundary.getTime() ? '24:00' : localTime(end),
        seconds: (end - start) / 1000,
        source: 'timer',
        summary,
      });
      start = end;
    }
    return result;
  });
}
