import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Typography,
} from 'antd';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import {
  account,
  cloudBackend,
  configured,
  initializeSync,
  loginRequired,
  projectHost,
  signIn,
  signOut,
  signUp,
  standalone,
  synchronize,
  useCloud,
  useLocal,
} from './runtime';
import { inCloud } from './workspace';
import { localCall } from '../backend-client';
import type { Conflict } from './engine';
import { categoryInfo, statusInfo } from '../assistant/model';
import './sync.css';

export function SyncControl() {
  const [, render] = useState(0);
  useEffect(() => {
    const changed = () => render((n) => n + 1);
    window.addEventListener('agentvalue-sync-status', changed);
    window.addEventListener('agentvalue-workspace', changed);
    return () => {
      window.removeEventListener('agentvalue-sync-status', changed);
      window.removeEventListener('agentvalue-workspace', changed);
    };
  }, []);
  const status = cloudBackend()?.engine.status;
  const label = !inCloud()
    ? '本机空间'
    : status?.conflicts
      ? '同步冲突'
      : status?.error
        ? '同步待重试'
        : status?.pending
          ? `待同步 ${status.pending}`
          : '云空间';
  return (
    <Badge dot={!!status?.conflicts}>
      <Button
        className="av-sync-control"
        icon={inCloud() ? <Cloud size={16} /> : <CloudOff size={16} />}
        onClick={() => window.dispatchEvent(new Event('agentvalue-open-sync'))}
      >
        {label}
      </Button>
    </Badge>
  );
}
function AuthForm({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<'登录' | '注册'>('登录'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  return (
    <div className="av-auth-form">
      <Segmented
        block
        value={mode}
        options={['登录', '注册']}
        onChange={(v) => {
          setMode(v as typeof mode);
          setError('');
          setNotice('');
        }}
      />
      <Form
        layout="vertical"
        onFinish={async (values) => {
          setBusy(true);
          setError('');
          setNotice('');
          try {
            if (mode === '登录') {
              await signIn(values.email.trim(), values.password);
              onComplete();
            } else {
              const result = await signUp(values.email.trim(), values.password);
              setNotice(result);
              if (inCloud()) onComplete();
            }
          } catch (error) {
            setError(error instanceof Error ? error.message : '登录失败，请重试');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            disabled={busy}
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="账号密码"
          rules={[
            { required: true, message: '请输入账号密码' },
            ...(mode === '注册' ? [{ min: 8, message: '至少 8 位' }] : []),
          ]}
        >
          <Input.Password
            autoComplete={mode === '注册' ? 'new-password' : 'current-password'}
            disabled={busy}
          />
        </Form.Item>
        {error && <Alert type="error" title={error} showIcon />}
        {notice && <Alert type="success" title={notice} showIcon />}
        <Button htmlType="submit" type="primary" block loading={busy}>
          {mode === '登录' ? '登录云空间' : '创建账号'}
        </Button>
      </Form>
      <p className="av-auth-note">电脑和手机使用同一账号。此处填写个人账号密码。</p>
    </div>
  );
}
export function SyncShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false),
    [startupError, setStartupError] = useState(''),
    [generation, setGeneration] = useState(0),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [conflicts, setConflicts] = useState<Conflict[]>([]),
    [orphans, setOrphans] = useState(0);
  const { message, modal } = App.useApp();
  const [install, setInstall] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    initializeSync()
      .catch((error) => {
        if (mounted) setStartupError(error.message);
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const changed = () => setGeneration((n) => n + 1),
      show = () => setOpen(true),
      status = () => {
        setGeneration((n) => n + 1);
        const engine = cloudBackend()?.engine;
        if (engine) {
          void engine.conflicts().then(setConflicts);
          void engine.snapshot().then(({ rows }) => {
            const tasks = new Set(rows.filter((r) => r.kind === 'task').map((r) => r.id));
            setOrphans(rows.filter((r) => r.kind === 'log' && !tasks.has(r.data.taskId)).length);
          });
        } else {
          setConflicts([]);
          setOrphans(0);
        }
      };
    const installable = (event: Event) => {
      event.preventDefault();
      setInstall(event);
    };
    window.addEventListener('agentvalue-workspace', changed);
    window.addEventListener('agentvalue-account', changed);
    window.addEventListener('agentvalue-sync-status', status);
    window.addEventListener('agentvalue-open-sync', show);
    window.addEventListener('beforeinstallprompt', installable);
    return () => {
      window.removeEventListener('agentvalue-workspace', changed);
      window.removeEventListener('agentvalue-account', changed);
      window.removeEventListener('agentvalue-sync-status', status);
      window.removeEventListener('agentvalue-open-sync', show);
      window.removeEventListener('beforeinstallprompt', installable);
    };
  }, []);
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const checkSaved = () => {
    const event = new Event('agentvalue-before-switch', { cancelable: true });
    if (!window.dispatchEvent(event))
      throw new Error('请先保存当前改动，或导出未保存草稿后再切换空间');
  };
  const status = cloudBackend()?.engine.status;
  const gate = standalone && !inCloud();
  if (!ready)
    return (
      <div className="av-sync-loading">
        <Spin />
        <p>正在打开 AgentValue</p>
      </div>
    );
  const contents = (
    <>
      {startupError && <Alert type="error" title={startupError} showIcon />}
      {!configured ? (
        <Alert
          type="info"
          title="未配置云空间"
          description="请配置 Supabase 项目地址和公开 key，然后重新构建应用。"
        />
      ) : !account() ? (
        <AuthForm onComplete={() => setOpen(false)} />
      ) : (
        <div className="av-cloud-settings">
          <div>
            <Typography.Text strong>{account()?.email}</Typography.Text>
            <div className="av-sync-project">{projectHost}</div>
          </div>
          {inCloud() && loginRequired() && navigator.onLine && (
            <>
              <Alert
                type="info"
                title="需要重新登录后继续同步"
                description="本机记录仍可查看和修改。"
              />
              <AuthForm
                onComplete={() => {
                  setOpen(false);
                  void synchronize();
                }}
              />
            </>
          )}
          {!inCloud() ? (
            <Button
              type="primary"
              block
              onClick={() =>
                void run(async () => {
                  checkSaved();
                  await useCloud();
                })
              }
            >
              进入云空间
            </Button>
          ) : (
            <>
              <div className="av-sync-summary">
                <Badge
                  status={
                    status?.error || status?.conflicts
                      ? 'warning'
                      : status?.syncing
                        ? 'processing'
                        : 'success'
                  }
                  text={
                    status?.syncing
                      ? '正在同步'
                      : !navigator.onLine
                        ? '离线：改动保存在本机'
                        : status?.error
                          ? '同步待重试：改动保存在本机'
                          : status?.conflicts
                            ? `${status.conflicts} 条记录存在同步冲突`
                            : status?.pending
                              ? `${status.pending} 条改动等待同步`
                              : status?.lastSync
                                ? '已与云端同步'
                                : '改动已保存在本机，等待首次同步'
                  }
                />
                <span>
                  最近同步：
                  {status?.lastSync
                    ? new Date(status.lastSync).toLocaleString('zh-CN')
                    : '尚未完成'}
                </span>
              </div>
              {status?.error && (
                <Alert type="warning" showIcon title="同步暂未完成" description={status.error} />
              )}
              <Space wrap>
                <Button
                  type="primary"
                  icon={<RefreshCw size={15} />}
                  loading={busy || status?.syncing}
                  onClick={() => void run(synchronize)}
                >
                  立即同步
                </Button>
                <Button
                  onClick={() =>
                    void run(async () => {
                      const result = await cloudBackend()!.backup();
                      download(result);
                    })
                  }
                >
                  导出完整云空间备份
                </Button>
              </Space>
              {!!conflicts.length && (
                <section className="av-conflicts">
                  <h3>{conflicts.length} 条记录需要处理</h3>
                  <p>请核对两端内容。选择后会先下载冲突备份。</p>
                  {conflicts.map((conflict) => (
                    <div className="av-conflict" key={conflict.key}>
                      <strong>
                        {conflict.local.data.title ||
                          conflict.local.data.name ||
                          conflict.local.data.summary ||
                          (
                            {
                              review: '每日回顾',
                              savedReview: '回顾汇总',
                              image: '图片',
                              skillFile: 'Skill 附件',
                              log: '执行小计',
                            } as Record<string, string>
                          )[conflict.local.kind] ||
                          '记录'}
                      </strong>
                      <div className="av-conflict-columns">
                        <div>
                          <span>本机版本{conflict.local.deleted ? '（已删除）' : ''}</span>
                          <ConflictVersion
                            record={conflict.local.data}
                            other={conflict.remote.data}
                            kind={conflict.local.kind}
                          />
                        </div>
                        <div>
                          <span>云端版本{conflict.remote.deleted ? '（已删除）' : ''}</span>
                          <ConflictVersion
                            record={conflict.remote.data}
                            other={conflict.local.data}
                            kind={conflict.local.kind}
                          />
                        </div>
                      </div>
                      <Space wrap>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              backupConflict(conflict);
                              await cloudBackend()!.engine.resolve(conflict.key, 'local');
                              await synchronize();
                            })
                          }
                        >
                          保留本机版本
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              backupConflict(conflict);
                              await cloudBackend()!.engine.resolve(conflict.key, 'remote');
                              window.dispatchEvent(new Event('agentvalue-sync-applied'));
                              await synchronize();
                            })
                          }
                        >
                          使用云端版本
                        </Button>
                      </Space>
                    </div>
                  ))}
                </section>
              )}
              {!!orphans && (
                <Alert
                  type="warning"
                  title={`${orphans} 条执行记录的事项已被其他设备删除`}
                  description="记录仍在云空间备份中。请先导出备份，保留这些小计。"
                />
              )}
              {!standalone && (
                <>
                  <Divider />
                  <h3>导入本机数据</h3>
                  <p>将这台电脑的事项、回顾和资产复制到空云空间。导入前自动备份原有本机库。</p>
                  <Button
                    loading={busy}
                    onClick={() =>
                      modal.confirm({
                        title: '导入本机数据到云空间',
                        content: '仅首次导入到空云空间。本机原数据会保留，并自动生成备份。',
                        okText: '备份并导入',
                        onOk: () =>
                          run(async () => {
                            checkSaved();
                            await synchronize();
                            const data = await localCall<any>('syncExport');
                            await cloudBackend()!.importLocal(data);
                            window.dispatchEvent(new Event('agentvalue-reload'));
                            await synchronize();
                            void message.success(`已复制到云空间，本机备份：${data.backupPath}`);
                          }),
                      })
                    }
                  >
                    备份并导入本机数据
                  </Button>
                </>
              )}
            </>
          )}
          <Divider />
          <Space wrap>
            {!standalone && inCloud() && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    checkSaved();
                    useLocal();
                  })
                }
              >
                切回本机空间
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                modal.confirm({
                  title: '退出云空间',
                  content: status?.pending
                    ? '仍有改动等待同步。退出后保留本机缓存；下次登录同一账号可继续同步。'
                    : '退出后隐藏该账号数据；下次登录同一账号可继续使用本机缓存。',
                  okText: '退出账号',
                  onOk: () =>
                    run(async () => {
                      checkSaved();
                      await signOut();
                    }),
                })
              }
            >
              退出账号
            </Button>
            {install && (
              <Button
                onClick={() =>
                  void run(async () => {
                    await install.prompt();
                    setInstall(null);
                  })
                }
              >
                安装到手机桌面
              </Button>
            )}
          </Space>
        </div>
      )}
    </>
  );
  return (
    <>
      {gate ? (
        <div className="av-auth-page">
          <div className="av-auth-card">
            <img src="./icon.png" alt="AgentValue" />
            <h1>AgentValue</h1>
            <h2>云空间</h2>
            {contents}
          </div>
        </div>
      ) : (
        children
      )}
      <Modal
        title={
          <Space>
            <Cloud size={20} />
            多端同步
          </Space>
        }
        open={open && !gate}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        footer={null}
        width={650}
        className="av-sync-modal"
        styles={{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        {contents}
      </Modal>
    </>
  );
}
function ConflictVersion({
  record,
  other,
  kind,
}: {
  record: Record<string, any>;
  other: Record<string, any>;
  kind: string;
}) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState('');
  useEffect(() => {
    let alive = true,
      url = '';
    if (kind === 'image' && record.blob && /^image\/(png|jpeg|webp|gif)$/.test(record.type))
      void cloudBackend()
        ?.engine.blob(record.blob)
        .then((blob) => {
          url = URL.createObjectURL(new Blob([blob], { type: record.type }));
          if (alive) setPreview(url);
          else URL.revokeObjectURL(url);
        })
        .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [record.blob, record.type, kind]);
  const labels: Record<string, string> = {
    title: '事项名称',
    name: '名称',
    summary: '执行小计',
    content: '正文',
    snapshot: '提示词快照',
    value: '回顾正文',
    text: '汇总正文',
    notes: '备注',
    project: '项目',
    date: '日期',
    start: '开始时间',
    end: '结束时间',
    deadline: '截止日期',
    category: '分类',
    status: '状态',
    priority: '优先级',
    repeat: '重复',
    remind: '提醒',
    asset: '关联工具',
    description: '说明',
    tags: '标签',
    favorite: '收藏',
    model: '模型',
    rating: '评分',
    size: '尺寸',
    ratio: '比例',
    parameters: '生成参数',
    hint: '目标说明',
    month: '目标月份',
    path: '附件路径',
    files: 'Skill 文件',
    role: '图片用途',
  };
  const display = (key: string, value: any): string => {
    if (value === undefined || value === null || value === '') return '未填写';
    if (key === 'category') return (categoryInfo as any)[value]?.label || value;
    if (key === 'status') return (statusInfo as any)[value] || value;
    if (key === 'priority') return value === 'high' ? '重要' : '普通';
    if (key === 'repeat')
      return (
        (
          {
            none: '不重复',
            daily: '每天',
            weekdays: '工作日',
            weekly: '每周',
            monthly: '每月',
          } as any
        )[value] || value
      );
    if (key === 'role') return value === 'reference' ? '参考图' : '效果图';
    if (typeof value === 'boolean') return value ? '开启' : '关闭';
    if (Array.isArray(value)) return value.join('、') || '无';
    return String(value);
  };
  const entries = Object.keys(labels).filter(
    (key) =>
      JSON.stringify(record[key]) !== JSON.stringify(other[key]) ||
      (['title', 'name', 'summary', 'path'].includes(key) && record[key]),
  );
  return (
    <>
      <dl className="av-conflict-fields">
        {entries.map((key) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>{display(key, record[key])}</dd>
          </div>
        ))}
      </dl>
      {preview && (
        <img className="av-conflict-image" src={preview} alt={record.name || '图片版本'} />
      )}{' '}
      {!!record.blob && (
        <Button
          size="small"
          onClick={() =>
            void cloudBackend()
              ?.engine.blob(record.blob)
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                download({
                  download: url,
                  name: record.name || record.path?.split('/').pop() || '附件',
                });
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              })
              .catch((error) => message.error(error.message))
          }
        >
          下载此版本附件
        </Button>
      )}
      {!entries.length && !record.blob && <p>正文相同，保存版本不同。</p>}
    </>
  );
}
function download(result: { download: string; name: string }) {
  const a = document.createElement('a');
  a.href = result.download;
  a.download = result.name;
  a.click();
}
function backupConflict(conflict: Conflict) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(conflict, null, 2)], { type: 'application/json' }),
  );
  download({ download: url, name: `AgentValue-冲突备份-${Date.now()}.json` });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
