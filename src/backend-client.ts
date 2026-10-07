import { cloudWorkspace } from './sync/workspace.ts';
let session: Promise<string> | undefined;
export async function backendCall<T = unknown>(operation: string, input?: unknown): Promise<T> {
  const workspace = cloudWorkspace();
  if (workspace) return workspace.call<T>(operation, input);
  return localCall<T>(operation, input);
}
export async function localCall<T = unknown>(operation: string, input?: unknown): Promise<T> {
  if (window.vault) return window.vault.call<T>(operation, input);
  session ||= fetch('/api/session')
    .then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
        throw new Error('本地服务未启动，请启动 AgentValue 本地服务。');
      return (await response.json()).token as string;
    })
    .catch((error) => {
      session = undefined;
      throw error;
    });
  const response = await fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AgentValue-Token': await session },
    body: JSON.stringify({ operation, input }),
  });
  const result = await response.json();
  if (result.error === '无效会话') {
    session = undefined;
    const fresh = await fetch('/api/session');
    if (!fresh.ok) throw new Error('本地服务暂时不可用，请重试');
    session = Promise.resolve((await fresh.json()).token);
    const retry = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AgentValue-Token': await session },
      body: JSON.stringify({ operation, input }),
    });
    const retried = await retry.json();
    if (!retry.ok || !retried.ok) throw new Error(retried.error || '操作失败，请重试');
    return retried.data as T;
  }
  if (!response.ok || !result.ok) throw new Error(result.error || '操作失败，请重试');
  return result.data as T;
}
