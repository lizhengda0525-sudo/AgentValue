import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SyncEngine, type Transport, type Mutation } from './engine';
import { CloudBackend, assembleAssistant } from './cloud-backend';
import { cloudWorkspace, setWorkspace } from './workspace';

export const standalone = import.meta.env.VITE_STANDALONE === 'true';
const url = import.meta.env.VITE_SUPABASE_URL || '';
const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const configured =
  /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && publishable.startsWith('sb_publishable_');
export const projectHost = configured ? new URL(url).host : '';
const authKey = `AgentValue-auth-${projectHost}`;
const userHintKey = `AgentValue-user-${projectHost}`;
let offlineUser: { id: string; email?: string } | undefined;
let client: SupabaseClient | undefined;
let session: Session | null = null;
let backend: CloudBackend | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let startup: Promise<void> | undefined;
let switchGeneration = 0;
const timedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
export const account = () => session?.user || offlineUser;
export const loginRequired = () => !session || (session.expires_at || 0) <= Date.now() / 1000;
export const cloudBackend = () => backend;
export function supabase() {
  if (!configured) throw new Error('尚未配置 Supabase，请在本地配置项目地址和公开 key 后重新构建');
  client ||= createClient(url, publishable, {
    global: { fetch: timedFetch },
    auth: {
      storageKey: authKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
function describe(error: { message: string; code?: string }) {
  if (/Failed to fetch|fetch failed|NetworkError/i.test(error.message))
    return '网络暂不可用，请联网后重试';
  if (error.code === 'PGRST202' || error.code === '42P01')
    return '云端尚未初始化，请在 Supabase SQL Editor 执行项目的同步脚本';
  if (/Invalid login credentials/i.test(error.message)) return '邮箱或密码不正确';
  if (/Email not confirmed/i.test(error.message)) return '请先点击邮箱中的确认链接，再登录';
  if (/rate limit|too many requests/i.test(error.message)) return '操作过于频繁，请稍后重试';
  return error.message;
}
function transport(userId: string): Transport {
  // Pin each request to this workspace's account. A concurrent login must never upload its records as a new user.
  const client = createClient(url, publishable, {
    global: { fetch: timedFetch },
    accessToken: async () => {
      if (!session || session.user.id !== userId) throw new Error('登录状态已变更，请重新登录');
      return session.access_token;
    },
  });
  const verifyAccount = async () => {
    if (!session || session.user.id !== userId) throw new Error('登录状态已变更，请重新登录');
  };
  return {
    async push(mutation: Mutation) {
      await verifyAccount();
      const { data, error } = await client.rpc('agentvalue_push', { mutation });
      if (error) throw new Error(describe(error));
      return data;
    },
    async pull(cursor: number) {
      await verifyAccount();
      const { data, error } = await client.rpc('agentvalue_pull', {
        after_seq: cursor,
        page_size: 200,
      });
      if (error) throw new Error(describe(error));
      return data;
    },
    async upload(hash, blob) {
      await verifyAccount();
      const path = `${userId}/${hash}`;
      const { error } = await client.storage
        .from('agentvalue-private')
        .upload(path, blob, { upsert: false, contentType: 'application/octet-stream' });
      if (error) {
        // A lost upload reply can leave an existing immutable blob. Confirm its bytes before acknowledging it.
        if (String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message)) {
          const { data, error: readError } = await client.storage
            .from('agentvalue-private')
            .download(path);
          if (readError || !data) throw new Error(describe(readError || error));
          const actual = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer())),
            (n) => n.toString(16).padStart(2, '0'),
          ).join('');
          if (actual !== hash) throw new Error('云端附件校验失败，已暂停上传');
        } else throw new Error(describe(error));
      }
    },
    async download(hash) {
      await verifyAccount();
      const { data, error } = await client.storage
        .from('agentvalue-private')
        .download(`${userId}/${hash}`);
      if (error || !data) throw new Error(error ? describe(error) : '附件暂不可用');
      return data;
    },
  };
}
export async function useCloud() {
  const user = account();
  if (!user) throw new Error('请先登录');
  if (backend && cloudWorkspace()) return;
  const generation = ++switchGeneration,
    userId = user.id;
  const engine = await new SyncEngine(
    `AgentValue-cloud-v1-${projectHost}-${userId}`,
    transport(userId),
  ).open();
  if (generation !== switchGeneration || account()?.id !== userId) {
    engine.close();
    return;
  }
  backend = new CloudBackend(engine);
  const current = backend;
  let lastRevision = (await engine.snapshot()).revision;
  const updateReminders = async () => {
    if (!window.vault || backend !== current) return;
    const snapshot = await engine.snapshot();
    await window.vault
      .call('cloudReminderState', {
        namespace: `${userId}@${projectHost}`,
        state: assembleAssistant(snapshot.rows, snapshot.timer),
      })
      .catch(() => {});
  };
  void updateReminders();
  const unsubscribe = engine.subscribe(() => {
    window.dispatchEvent(new Event('agentvalue-sync-status'));
    void engine
      .snapshot()
      .then((snapshot) => {
        if (backend === current && snapshot.revision !== lastRevision) {
          lastRevision = snapshot.revision;
          window.dispatchEvent(new Event('agentvalue-sync-applied'));
        }
      })
      .catch(() => {});
    void updateReminders();
  });
  setWorkspace({
    engine,
    call: current.call.bind(current),
    dispose: () => {
      unsubscribe();
      current.dispose();
    },
  });
  localStorage.setItem('agentvalue.workspace', 'cloud');
  const synchronize = () => {
    if (backend !== current || !navigator.onLine) return;
    const run = () => engine.sync();
    if (navigator.locks) void navigator.locks.request(engine.name, run);
    else void run();
  };
  synchronize();
  interval = setInterval(synchronize, 20000);
}
export function useLocal() {
  ++switchGeneration;
  if (interval) clearInterval(interval);
  interval = undefined;
  backend = undefined;
  setWorkspace();
  localStorage.setItem('agentvalue.workspace', 'local');
  if (window.vault) void window.vault.call('cloudReminderState', { state: null }).catch(() => {});
}
export async function signIn(email: string, password: string) {
  if (!window.dispatchEvent(new Event('agentvalue-before-switch', { cancelable: true })))
    throw new Error('请先保存或关闭当前编辑窗口，再登录云空间');
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(describe(error));
  session = data.session;
  offlineUser = undefined;
  localStorage.setItem(
    userHintKey,
    JSON.stringify({ id: session.user.id, email: session.user.email }),
  );
  await useCloud();
}
export async function signUp(email: string, password: string) {
  if (!window.dispatchEvent(new Event('agentvalue-before-switch', { cancelable: true })))
    throw new Error('请先保存或关闭当前编辑窗口，再注册');
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error) throw new Error(describe(error));
  if (data.session) {
    session = data.session;
    offlineUser = undefined;
    localStorage.setItem(
      userHintKey,
      JSON.stringify({ id: session.user.id, email: session.user.email }),
    );
    await useCloud();
    return '账号已创建';
  }
  return '已发送确认邮件，请确认邮箱后登录';
}
export async function signOut() {
  // Sign out locally even offline. Durable unsent records remain isolated under this user's cache.
  await supabase().auth.signOut({ scope: 'local' });
  localStorage.removeItem(authKey);
  localStorage.removeItem(userHintKey);
  session = null;
  offlineUser = undefined;
  useLocal();
}
export async function synchronize() {
  const engine = backend?.engine;
  if (!engine) return;
  if (navigator.onLine && loginRequired()) {
    const result = await supabase().auth.getSession();
    if (result.data.session) {
      session = result.data.session;
      offlineUser = undefined;
    }
  }
  if (navigator.locks) await navigator.locks.request(engine.name, () => engine.sync());
  else await engine.sync();
}
export function initializeSync() {
  startup ||= (async () => {
    if (!configured) return;
    const client = supabase();
    if (!navigator.onLine) {
      try {
        const hint = JSON.parse(localStorage.getItem(userHintKey) || 'null');
        if (
          typeof hint?.id === 'string' &&
          /^[a-f0-9-]{36}$/.test(hint.id) &&
          (hint.email === undefined || typeof hint.email === 'string')
        )
          offlineUser = { id: hint.id, email: hint.email };
      } catch {
        /* An invalid identity hint cannot open another account's cache. */
      }
    } else {
      const { data } = await client.auth.getSession();
      session = data.session;
    }
    client.auth.onAuthStateChange((_event, next) => {
      const previous = account()?.id;
      session = next;
      if (next) {
        offlineUser = undefined;
        localStorage.setItem(
          userHintKey,
          JSON.stringify({ id: next.user.id, email: next.user.email }),
        );
      }
      if (_event === 'SIGNED_OUT') {
        offlineUser = undefined;
        localStorage.removeItem(userHintKey);
      }
      if (previous && previous !== account()?.id) {
        useLocal();
      }
      window.dispatchEvent(new Event('agentvalue-account'));
    });
    if (account() && (standalone || localStorage.getItem('agentvalue.workspace') === 'cloud'))
      await useCloud();
    const wake = () => {
      window.dispatchEvent(new Event('agentvalue-sync-status'));
      void synchronize();
    };
    window.addEventListener('online', wake);
    window.addEventListener('offline', () =>
      window.dispatchEvent(new Event('agentvalue-sync-status')),
    );
    window.addEventListener('focus', wake);
  })();
  return startup;
}
