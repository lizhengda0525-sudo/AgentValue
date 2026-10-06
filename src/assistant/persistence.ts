import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { backendCall } from '../backend-client';
import type { Task, WorkLog, Category } from './model';
import type { TimedSegment } from './flow';
export type Goal = {
  id: string;
  title: string;
  category: Category;
  project: string;
  hint: string;
  month: string;
  period?: 'month' | 'year';
};
export type AssistantState = {
  tasks: Task[];
  logs: WorkLog[];
  goals: Goal[];
  reviews: Record<string, string>;
  savedReviews: Record<string, { text: string; signature: string }>;
  timer: { taskId: string | null; startedAt: number | null; segments: TimedSegment[] };
};
const empty = (): AssistantState => ({
  tasks: [],
  logs: [],
  goals: [],
  reviews: {},
  savedReviews: {},
  timer: { taskId: null, startedAt: null, segments: [] },
});
export function useAssistant() {
  const [state, render] = useState<AssistantState>(empty);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const current = useRef(state),
    revision = useRef(''),
    dirty = useRef(false),
    busy = useRef(false),
    stopped = useRef(false);
  const loadGeneration = useRef(0);
  const pump = async () => {
    if (busy.current || !dirty.current || stopped.current || !revision.current) return;
    busy.current = true;
    setStatus('saving');
    try {
      while (dirty.current && !stopped.current) {
        const snapshot = current.current;
        dirty.current = false;
        try {
          const result = await backendCall<{ revision: string }>('assistantSave', {
            state: snapshot,
            revision: revision.current,
          });
          revision.current = result.revision;
        } catch (error) {
          dirty.current = true;
          throw error;
        }
      }
      setStatus('saved');
      setError('');
    } catch (error) {
      stopped.current = true;
      setStatus('error');
      setError(error instanceof Error ? error.message : '保存失败');
    } finally {
      busy.current = false;
    }
  };
  const load = async () => {
    const generation = ++loadGeneration.current;
    setStatus('loading');
    try {
      const result = await backendCall<AssistantState & { revision: string }>('assistantState');
      if (generation !== loadGeneration.current) return;
      revision.current = result.revision;
      current.current = result;
      render(result);
      dirty.current = false;
      stopped.current = false;
      setLoaded(true);
      setStatus('saved');
      setError('');
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setStatus('error');
      setError(error instanceof Error ? error.message : '读取失败');
    }
  };
  useEffect(() => {
    void load();
    return () => {
      ++loadGeneration.current;
    };
  }, []);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current || busy.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  useEffect(() => {
    const deleted = (event: Event) => {
      const { kind, id } = (event as CustomEvent).detail;
      change((previous) => ({
        ...previous,
        tasks: previous.tasks.map((task) =>
          task.assetId === id && task.assetKind === kind
            ? { ...task, asset: undefined, assetId: undefined, assetKind: undefined }
            : task,
        ),
      }));
    };
    window.addEventListener('agentvalue-asset-deleted', deleted);
    return () => window.removeEventListener('agentvalue-asset-deleted', deleted);
  }, []);
  const change = (update: (previous: AssistantState) => AssistantState) => {
    if (!revision.current) return;
    current.current = update(current.current);
    render(current.current);
    dirty.current = true;
    void pump();
  };
  const setter =
    <K extends keyof AssistantState>(key: K) =>
    (value: SetStateAction<AssistantState[K]>) =>
      change((previous) => ({
        ...previous,
        [key]:
          typeof value === 'function'
            ? (value as (v: AssistantState[K]) => AssistantState[K])(previous[key])
            : value,
      }));
  return {
    state,
    loaded,
    status,
    error,
    change,
    setter,
    reload: load,
    retry: () => {
      stopped.current = false;
      void pump();
    },
    exportDraft: () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AgentValue-未保存草稿.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
