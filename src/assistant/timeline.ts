import type { CSSProperties } from 'react';
import { minutes } from './model.ts';

type TimedItem = { id: string; start: string; end: string };
export function getTimeRange(items: { start: string; end: string }[]) {
  const timed = items.filter((item) => item.start && item.end);
  const firstHour = Math.min(8, ...timed.map((item) => Math.floor(minutes(item.start) / 60)));
  const lastHour = Math.max(21, ...timed.map((item) => Math.ceil(minutes(item.end) / 60)));
  return {
    firstHour,
    hours: lastHour - firstHour,
    start: firstHour * 60,
    span: (lastHour - firstHour) * 60,
  };
}
export function timeStyle(
  start: string,
  end: string,
  range: ReturnType<typeof getTimeRange>,
): CSSProperties {
  return {
    top: `${((minutes(start) - range.start) / range.span) * 100}%`,
    height: `${((minutes(end) - minutes(start)) / range.span) * 100}%`,
  };
}
export function layoutTimeBlocks(items: TimedItem[], minimumVisibleMinutes = 0) {
  const styles = new Map<string, CSSProperties>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const item of cluster)
      styles.set(item.id, {
        left: `calc(${(item.lane / laneEnds.length) * 100}% + 5px)`,
        right: 'auto',
        width: `calc(${100 / laneEnds.length}% - 10px)`,
      });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };
  const ordered = items
    .filter((item) => item.start && item.end)
    .sort(
      (a, b) =>
        minutes(a.start) - minutes(b.start) ||
        minutes(a.end) - minutes(b.end) ||
        a.id.localeCompare(b.id),
    );
  for (const item of ordered) {
    const start = minutes(item.start);
    const end = Math.max(minutes(item.end), start + minimumVisibleMinutes);
    if (cluster.length && start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((lastEnd) => lastEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    cluster.push({ id: item.id, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return styles;
}
