import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Database,
  FileText,
  FolderOpen,
  Github,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  Layers3,
  LayoutDashboard,
  List,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Media, Prompt, Scan, Skill, State } from './types';

type Page = 'home' | 'skills' | 'text' | 'image' | 'settings';
type Modal =
  | { type: 'prompt'; kind: 'text' | 'image'; record?: Prompt }
  | { type: 'generation'; record: Prompt }
  | { type: 'import' }
  | { type: 'skill'; record: Skill }
  | null;
const call = <T,>(operation: string, input?: unknown) => window.vault.call<T>(operation, input);
const date = (s: string) =>
  new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(s));
const splitTags = (s: string) =>
  s
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);
const cover = (p: Prompt) =>
  p.generations.find((g) => g.images.length)?.images[0] ||
  p.images.find((i) => i.role === 'reference');
const titles: Record<Page, string> = {
  home: '收藏概览',
  skills: 'Skills',
  text: '文本 Prompt',
  image: '图片 Prompt',
  settings: '设置',
};
function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" aria-label={`${rating} 星`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={12}
          fill={i < rating ? 'currentColor' : 'none'}
          className={i < rating ? '' : 'muted-star'}
        />
      ))}
    </span>
  );
}
function Tags({ items }: { items: string[] }) {
  return (
    <span className="tags">
      {items.slice(0, 5).map((t) => (
        <span key={t}>{t}</span>
      ))}
    </span>
  );
}
function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input,textarea,button')?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const controls = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,[tabindex="0"]',
          ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function FileDrop({
  label,
  files,
  setFiles,
}: {
  label: string;
  files: string[];
  setFiles: (v: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState('');
  const add = (paths: string[]) => {
    setError('');
    setFiles([...new Set([...files, ...paths])].slice(0, 30));
  };
  return (
    <div className="upload-group">
      <label>
        {label} <span className="subtle">· 可多选</span>
      </label>
      <div
        className={`dropzone ${hover ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          try {
            add(Array.from(e.dataTransfer.files).map((f) => window.vault.filePath(f)));
          } catch {
            setError('无法读取拖入文件，请点击选择图片');
          }
        }}
      >
        <Upload size={22} />
        <button type="button" className="link" onClick={() => input.current?.click()}>
          点击选择图片
        </button>
        <span>或拖放到这里</span>
        <small>PNG / JPG / WebP / GIF，每张最多 30 MB</small>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".png,.jpg,.jpeg,.webp,.gif"
          aria-label={label}
          onChange={(e) => {
            try {
              add(Array.from(e.target.files || []).map((f) => window.vault.filePath(f)));
            } catch {
              setError('无法读取文件');
            }
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      {files.length > 0 && (
        <div className="file-pills">
          {files.map((f) => (
            <span key={f}>
              <ImageIcon size={13} />
              {f.split(/[/\\]/).pop()}
              <button
                type="button"
                aria-label={`移除 ${f.split(/[/\\]/).pop()}`}
                onClick={() => setFiles(files.filter((p) => p !== f))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function GenerationFields({
  outputs,
  setOutputs,
}: {
  outputs: string[];
  setOutputs: (v: string[]) => void;
}) {
  return (
    <>
      <FileDrop label="效果图" files={outputs} setFiles={setOutputs} />
      <div className="form-row three">
        <label>
          生成模型
          <input name="model" placeholder="例如 GPT Image" maxLength={120} />
        </label>
        <label>
          画面比例
          <input name="ratio" placeholder="例如 16:9" maxLength={40} />
        </label>
        <label>
          图片尺寸
          <input name="size" placeholder="例如 1536 × 1024" maxLength={80} />
        </label>
      </div>
      <div className="form-row">
        <label>
          效果评分
          <select name="rating" defaultValue="0">
            <option value="0">暂不评分</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option value={n} key={n}>
                {'★'.repeat(n)} · {n} 星
              </option>
            ))}
          </select>
        </label>
        <label>
          生成参数
          <input name="parameters" placeholder="Seed、风格、负面提示词…" maxLength={10000} />
        </label>
      </div>
      <label>
        实验备注
        <textarea
          name="generationNotes"
          rows={2}
          placeholder="记录这次效果，以及下次想调整的地方"
          maxLength={10000}
        />
      </label>
    </>
  );
}
function PromptForm({
  modal,
  onClose,
  onSave,
  busy,
}: {
  modal: Extract<Modal, { type: 'prompt' | 'generation' }>;
  onClose: () => void;
  onSave: (op: string, data: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const [references, setReferences] = useState<string[]>([]),
    [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const generationOnly = modal.type === 'generation',
    record = modal.record,
    isImage = generationOnly || modal.kind === 'image';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const value = (k: string) => String(fd.get(k) || '');
    const gen = {
      model: value('model'),
      ratio: value('ratio'),
      size: value('size'),
      rating: Number(value('rating')),
      parameters: value('parameters'),
      notes: value('generationNotes'),
      outputs,
    };
    if (generationOnly) {
      if (!outputs.length) {
        setError('请添加至少一张效果图，再保存这次实验。');
        return;
      }
      await onSave('addGeneration', { promptId: record!.id, snapshot: value('snapshot'), ...gen });
    } else {
      const hasGen =
        outputs.length > 0 || Object.entries(gen).some(([k, v]) => k !== 'outputs' && !!v);
      await onSave('savePrompt', {
        id: record?.id,
        kind: modal.kind,
        title: value('title'),
        content: value('content'),
        category: value('category'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        references,
        generation: isImage && hasGen ? gen : undefined,
      });
    }
  };
  return (
    <ModalShell
      title={
        generationOnly
          ? '记录一次新实验'
          : record
            ? '编辑 Prompt'
            : isImage
              ? '收藏图片 Prompt'
              : '收藏文本 Prompt'
      }
      subtitle={
        generationOnly
          ? '保存这次使用的正文、参数和效果，方便以后复现。'
          : '把值得复用的灵感，放进自己的收藏库。'
      }
      onClose={onClose}
      wide={isImage}
    >
      <form onSubmit={submit} className="form">
        <div className="form-scroll">
          {!generationOnly ? (
            <>
              <label>
                标题 <b>*</b>
                <input
                  name="title"
                  defaultValue={record?.title}
                  placeholder={isImage ? '给这份视觉灵感起个名字' : '例如：让代码审查更有条理'}
                  required
                  maxLength={160}
                />
              </label>
              <label>
                Prompt 正文 <b>*</b>
                <textarea
                  name="content"
                  defaultValue={record?.content}
                  placeholder={
                    isImage ? '粘贴生成图片时使用的完整 Prompt…' : '粘贴或写下你的 Prompt…'
                  }
                  required
                  rows={7}
                  maxLength={200000}
                  className="prompt-input"
                />
              </label>
              <div className="form-row">
                <label>
                  分类
                  <input
                    name="category"
                    defaultValue={record?.category}
                    placeholder="例如 写作 / 开发 / 摄影"
                    maxLength={80}
                  />
                </label>
                <label>
                  标签
                  <input
                    name="tags"
                    defaultValue={record?.tags.join('，')}
                    placeholder="用逗号分隔，例如 水彩，风景"
                  />
                </label>
              </div>
              <label>
                备注
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={record?.notes}
                  placeholder="使用场景、使用方法，或值得保留的小技巧"
                  maxLength={10000}
                />
              </label>
              {isImage && (
                <>
                  <div className="form-divider">
                    <span>图片与效果记录</span>
                    <small>{record ? '新选择的图片会追加保存' : '可选，之后也可以继续添加'}</small>
                  </div>
                  <FileDrop label="参考图" files={references} setFiles={setReferences} />
                  <GenerationFields outputs={outputs} setOutputs={setOutputs} />
                </>
              )}
            </>
          ) : (
            <>
              <label>
                本次使用的 Prompt
                <textarea
                  name="snapshot"
                  defaultValue={record?.content}
                  rows={5}
                  required
                  maxLength={200000}
                />
              </label>
              <GenerationFields outputs={outputs} setOutputs={setOutputs} />
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <span>
            <HardDrive size={14} /> 仅保存在本机
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存
            {generationOnly ? '实验' : '收藏'}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}
function ImportForm({
  onClose,
  onRun,
  busy,
}: {
  onClose: () => void;
  onRun: <T>(op: string, data?: unknown) => Promise<T | undefined>;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'local' | 'github'>('local'),
    [url, setUrl] = useState(''),
    [scan, setScan] = useState<Scan | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const doScan = async () => {
    const result = await onRun<Scan>(mode === 'local' ? 'scanLocal' : 'scanGithub', { url });
    if (result) {
      setScan(result);
      setSelected(result.candidates.map((c) => c.key));
    }
  };
  return (
    <ModalShell
      title="导入 Skill"
      subtitle="收藏一个本地副本，随时复制到你的项目。"
      onClose={onClose}
    >
      <div className="import-body">
        <div className="segmented">
          <button
            className={mode === 'local' ? 'active' : ''}
            onClick={() => {
              setMode('local');
              setScan(null);
            }}
          >
            <FolderOpen size={16} />
            本地文件夹
          </button>
          <button
            className={mode === 'github' ? 'active' : ''}
            onClick={() => {
              setMode('github');
              setScan(null);
            }}
          >
            <Github size={16} />
            GitHub 仓库
          </button>
        </div>
        {mode === 'github' ? (
          <label>
            公开仓库地址
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
            <small>支持仓库根地址。扫描后可以选择其中的 Skill。</small>
          </label>
        ) : (
          <div className="import-hint">
            <div className="feature-icon">
              <FolderOpen size={25} />
            </div>
            <h3>选择你的 Skill 文件夹</h3>
            <p>
              可以选择包含 SKILL.md 的文件夹，
              <br />
              也可以扫描包含多个 Skill 的父目录。
            </p>
          </div>
        )}
        <button className="button secondary full" disabled={busy} onClick={doScan}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{' '}
          {scan ? '重新扫描' : mode === 'local' ? '选择文件夹并扫描' : '扫描仓库'}
        </button>
        {scan && (
          <div className="scan-list">
            <p>
              发现 {scan.candidates.length} 个 Skill · 已选择 {selected.length} 个
            </p>
            {scan.candidates.map((c) => (
              <label className="scan-item" key={c.key}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, c.key] : selected.filter((k) => k !== c.key),
                    )
                  }
                />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.description || c.key} · {c.count} 个文件
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span>
          <ShieldCheck size={14} /> 只读取文件，不执行 Skill
        </span>
        <button
          className="button primary"
          disabled={busy || !scan || !selected.length}
          onClick={async () => {
            const result = await onRun('importSkills', { token: scan!.token, keys: selected });
            if (result) onClose();
          }}
        >
          <ArrowDownToLine size={16} />
          导入收藏库
        </button>
      </footer>
    </ModalShell>
  );
}
function SkillForm({
  record,
  onClose,
  onSave,
  busy,
}: {
  record: Skill;
  onClose: () => void;
  onSave: (op: string, data: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  return (
    <ModalShell title="编辑 Skill 信息" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await onSave('saveSkill', {
            id: record.id,
            name: f.get('name'),
            description: f.get('description'),
            tags: splitTags(String(f.get('tags') || '')),
          });
        }}
      >
        <div className="form-scroll">
          <label>
            名称
            <input name="name" defaultValue={record.name} required maxLength={120} />
          </label>
          <label>
            描述
            <textarea
              name="description"
              defaultValue={record.description}
              rows={4}
              maxLength={2000}
            />
          </label>
          <label>
            标签
            <input
              name="tags"
              defaultValue={record.tags.join('，')}
              placeholder="多个标签用逗号分隔"
            />
          </label>
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存信息
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ prompts: [], skills: [], root: '', schema: 1 });
  const [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState('');
  const [page, setPage] = useState<Page>('home'),
    [query, setQuery] = useState(''),
    [favoriteOnly, setFavoriteOnly] = useState(false),
    [tag, setTag] = useState(''),
    [sort, setSort] = useState('newest'),
    [layout, setLayout] = useState('grid');
  const [modal, setModal] = useState<Modal>(null),
    [detail, setDetail] = useState<{ type: 'prompt' | 'skill'; id: string } | null>(null),
    [lightbox, setLightbox] = useState<Media | null>(null),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => {
    setToast({ text, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), error ? 9000 : 3500);
  };
  const refresh = async () => {
    setState(await call<State>('state'));
  };
  useEffect(() => {
    if (!window.vault) {
      setFatal('请通过 AgentVault 桌面启动器打开应用。');
      setLoading(false);
      return;
    }
    refresh()
      .catch((e) => setFatal(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else if (!modal) setDetail(null);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [modal, lightbox]);
  const perform = async <T,>(operation: string, input?: unknown): Promise<T | undefined> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await call<T>(operation, input);
      await refresh();
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败', true);
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = async (op: string, input: unknown) => {
    const result = await perform(op, input);
    if (result !== undefined) {
      setModal(null);
      notify(op === 'addGeneration' ? '实验已保存，正文快照已保留' : '已保存到收藏库');
      return true;
    }
    return false;
  };
  const saveSkill = async (op: string, input: unknown) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await call(op, input);
      await refresh();
      setModal(null);
      notify('Skill 信息已更新');
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const toggle = async (kind: 'prompt' | 'skill', id: string) => {
    await perform('favorite', { kind, id });
  };
  const copy = async (text: string, id?: string) => {
    try {
      await call('copy', { text, id });
      notify('已复制到剪贴板');
      await refresh();
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const go = (next: Page) => {
    setPage(next);
    setQuery('');
    setTag('');
    setFavoriteOnly(false);
    setDetail(null);
  };
  const q = query.trim().toLocaleLowerCase();
  const match = (item: Prompt | Skill) => {
    const content =
      'title' in item
        ? `${item.title} ${item.content} ${item.category} ${item.notes}`
        : `${item.name} ${item.description} ${item.content}`;
    return (
      (!favoriteOnly || item.favorite) &&
      (!tag || item.tags.includes(tag)) &&
      (!q || `${content} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(q))
    );
  };
  const sorted = <T extends { updated_at: string; favorite: boolean }>(items: T[]) =>
    [...items].sort((a, b) =>
      sort === 'favorite'
        ? Number(b.favorite) - Number(a.favorite) || b.updated_at.localeCompare(a.updated_at)
        : sort === 'oldest'
          ? a.updated_at.localeCompare(b.updated_at)
          : b.updated_at.localeCompare(a.updated_at),
    );
  const prompts = sorted(
    state.prompts
      .filter(match)
      .filter(
        (p) =>
          q ||
          page === 'home' ||
          (page === 'text' ? p.kind === 'text' : page === 'image' ? p.kind === 'image' : false),
      ),
  );
  const skills = sorted(state.skills.filter(match));
  const allTags = [
    ...new Set(
      (q
        ? [...state.prompts, ...state.skills]
        : page === 'skills'
          ? state.skills
          : state.prompts.filter((p) => p.kind === page)
      ).flatMap((i) => i.tags),
    ),
  ].sort();
  const textCount = state.prompts.filter((p) => p.kind === 'text').length,
    imageCount = state.prompts.filter((p) => p.kind === 'image').length;
  const selectedPrompt =
      detail?.type === 'prompt' ? state.prompts.find((p) => p.id === detail.id) : undefined,
    selectedSkill =
      detail?.type === 'skill' ? state.skills.find((s) => s.id === detail.id) : undefined;
  const newPrompt = (kind: 'text' | 'image') => setModal({ type: 'prompt', kind });
  const importRun = async <T,>(op: string, data?: unknown) => {
    const result = await perform<T>(op, data);
    if (op === 'importSkills' && result) {
      const r = result as unknown as { imported: number; skipped: number };
      notify(`已导入 ${r.imported} 个 Skill${r.skipped ? `，跳过 ${r.skipped} 个重复项` : ''}`);
    }
    return result;
  };
  const promptCard = (p: Prompt) => {
    const img = cover(p);
    return (
      <article
        className={`asset-card ${p.kind === 'image' ? 'image-card' : 'text-card'}`}
        key={p.id}
      >
        <button
          className={`favorite-button ${p.favorite ? 'is-favorite' : ''}`}
          title={p.favorite ? '取消收藏' : '标记收藏'}
          aria-label={`${p.favorite ? '取消收藏' : '收藏'} ${p.title}`}
          onClick={() => toggle('prompt', p.id)}
        >
          <Star size={17} fill={p.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className="card-main" onClick={() => setDetail({ type: 'prompt', id: p.id })}>
          {p.kind === 'image' ? (
            <div className="card-image">
              {img ? (
                <img src={img.url} alt={p.title} loading="lazy" />
              ) : (
                <div className="image-placeholder">
                  <ImageIcon size={34} />
                  <span>等待一张好作品</span>
                </div>
              )}
              <span className="image-count">
                <ImageIcon size={12} />
                {p.images.filter((i) => i.role === 'output').length} 张效果图
              </span>
            </div>
          ) : (
            <div className="card-top">
              <span className="asset-icon">
                <FileText size={21} />
              </span>
              <span className="eyebrow">{p.category || '未分类'}</span>
            </div>
          )}
          <div className="card-body">
            <h3>{p.title}</h3>
            {p.kind === 'text' ? (
              <p className="card-excerpt">{p.content}</p>
            ) : (
              <div className="image-meta">
                <span>{p.generations[0]?.model || '未记录模型'}</span>
                <Stars rating={p.generations[0]?.rating || 0} />
              </div>
            )}
            <Tags items={p.tags} />
          </div>
        </button>
        <div className="card-footer">
          <span>{date(p.updated_at)}更新</span>
          <button
            onClick={() => copy(p.content, p.id)}
            className="copy-button"
            aria-label={`复制 ${p.title}`}
          >
            <Copy size={14} />
            复制 Prompt
          </button>
        </div>
      </article>
    );
  };
  const skillCard = (s: Skill) => (
    <article className="asset-card skill-card" key={s.id}>
      <button
        className={`favorite-button ${s.favorite ? 'is-favorite' : ''}`}
        aria-label={`${s.favorite ? '取消收藏' : '收藏'} ${s.name}`}
        onClick={() => toggle('skill', s.id)}
      >
        <Star size={17} fill={s.favorite ? 'currentColor' : 'none'} />
      </button>
      <button className="card-main" onClick={() => setDetail({ type: 'skill', id: s.id })}>
        <div className="card-top">
          <span className="asset-icon mint">
            <Code2 size={23} />
          </span>
          <span className="eyebrow">
            {s.source === 'github' ? (
              <>
                <Github size={13} /> GITHUB
              </>
            ) : (
              '本地导入'
            )}
          </span>
        </div>
        <div className="card-body">
          <h3>{s.name}</h3>
          <p className="card-excerpt">{s.description || '打开查看 SKILL.md 和文件内容'}</p>
          <Tags items={s.tags} />
        </div>
      </button>
      <div className="card-footer">
        <span>
          {s.files.length} 个文件
          {s.latest_commit !== s.commit_hash && <i className="update-dot" title="有新版本" />}
        </span>
        <button className="copy-button" onClick={() => setDetail({ type: 'skill', id: s.id })}>
          查看 Skill
          <ArrowUpRight size={14} />
        </button>
      </div>
    </article>
  );
  const empty = (kind: 'text' | 'image' | 'skills', filtered = false) => (
    <div className="empty">
      <div className={`empty-art ${kind}`}>
        <div />
        {kind === 'skills' ? (
          <Code2 size={36} />
        ) : kind === 'image' ? (
          <ImageIcon size={36} />
        ) : (
          <FileText size={36} />
        )}
        <Sparkles size={18} />
      </div>
      <h3>
        {filtered
          ? '还没有找到匹配的收藏'
          : kind === 'skills'
            ? '让好用的 Skill 随时就位'
            : kind === 'image'
              ? '留住每一次满意的生成'
              : '下一次好用的 Prompt，从这里开始'}
      </h3>
      <p>
        {filtered
          ? '试试其他关键词，或清除标签与收藏筛选。'
          : kind === 'skills'
            ? '导入本地或 GitHub 的 Skill，整理后复制到项目。'
            : kind === 'image'
              ? '把 Prompt、参考图和效果放在一起，让灵感可以重现。'
              : '收藏常用指令，分类、打标签，随时一键复制。'}
      </p>
      <button
        className="button primary"
        onClick={() =>
          filtered
            ? (setQuery(''), setTag(''), setFavoriteOnly(false))
            : kind === 'skills'
              ? setModal({ type: 'import' })
              : newPrompt(kind)
        }
      >
        {filtered ? <RefreshCw size={16} /> : <Plus size={16} />}{' '}
        {filtered
          ? '清除筛选'
          : kind === 'skills'
            ? '导入第一个 Skill'
            : kind === 'image'
              ? '收藏第一个图片 Prompt'
              : '收藏第一个 Prompt'}
      </button>
    </div>
  );
  if (fatal)
    return (
      <div className="fatal">
        <Archive size={38} />
        <h1>AgentVault</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>重试</button>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go('home')}>
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          <span>
            AgentVault<small>你的 AI 资产收藏库</small>
          </span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">A</span>
          <span>
            个人空间<small>Personal library</small>
          </span>
          <span className="local-dot" />
        </div>
        <nav aria-label="主导航">
          <button className={page === 'home' ? 'nav active' : 'nav'} onClick={() => go('home')}>
            <LayoutDashboard size={18} />
            首页
          </button>
          <div className="nav-label">
            收藏库 <span>LIBRARY</span>
          </div>
          <button className={page === 'skills' ? 'nav active' : 'nav'} onClick={() => go('skills')}>
            <Code2 size={19} />
            Skills<span className="count">{state.skills.length}</span>
          </button>
          <button className={page === 'text' ? 'nav active' : 'nav'} onClick={() => go('text')}>
            <FileText size={18} />
            文本 Prompt<span className="count">{textCount}</span>
          </button>
          <button className={page === 'image' ? 'nav active' : 'nav'} onClick={() => go('image')}>
            <ImageIcon size={18} />
            图片 Prompt<span className="count">{imageCount}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <strong>灵感归你，数据也归你。</strong>
            <p>所有收藏，安心留在本机。</p>
          </div>
          <button
            className={page === 'settings' ? 'nav active' : 'nav'}
            onClick={() => go('settings')}
          >
            <Settings2 size={18} />
            设置<span className="version">v0.1</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            个人空间
            <ChevronRight size={13} />
            <span>{q ? '搜索结果' : titles[page]}</span>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 Skill、Prompt 或标签…"
              aria-label="全局搜索"
            />
            {query ? (
              <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <span className="offline-badge">
            <span /> 本地模式
          </span>
        </header>
        <main>
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在打开你的收藏库…
            </div>
          ) : q || ['skills', 'text', 'image'].includes(page) ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {q
                      ? 'SEARCH YOUR LIBRARY'
                      : page === 'skills'
                        ? 'REUSABLE CAPABILITIES'
                        : page === 'image'
                          ? 'A VISUAL COLLECTION'
                          : 'WORDS THAT WORK'}
                  </div>
                  <h1>
                    {q ? '搜索收藏' : titles[page]}
                    <span className="heading-count">
                      {q
                        ? prompts.length + skills.length
                        : page === 'skills'
                          ? skills.length
                          : prompts.length}
                    </span>
                  </h1>
                  <p>
                    {q
                      ? `在所有 Skill、Prompt 正文和标签中查找「${query}」`
                      : page === 'skills'
                        ? '把常用能力整理好，下一次开工更从容。'
                        : page === 'image'
                          ? '从一张好作品，找回创造它的灵感。'
                          : '让好用的指令，不止用一次。'}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    page === 'skills'
                      ? setModal({ type: 'import' })
                      : newPrompt(page === 'image' ? 'image' : 'text')
                  }
                >
                  <Plus size={17} />
                  {page === 'skills' ? '导入 Skill' : '新增 Prompt'}
                </button>
              </div>
              <div className="toolbar">
                <div className="filter-tabs">
                  <button
                    className={!favoriteOnly ? 'selected' : ''}
                    onClick={() => setFavoriteOnly(false)}
                  >
                    全部收藏
                  </button>
                  <button
                    className={favoriteOnly ? 'selected' : ''}
                    onClick={() => setFavoriteOnly(true)}
                  >
                    <Star size={14} />
                    仅看星标
                  </button>
                </div>
                <div className="toolbar-end">
                  <label className="select-inline">
                    <Tag size={14} />
                    <select
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      aria-label="标签筛选"
                    >
                      <option value="">所有标签</option>
                      {allTags.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="select-inline">
                    <SlidersHorizontal size={14} />
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      aria-label="排序"
                    >
                      <option value="newest">最近更新</option>
                      <option value="oldest">最早更新</option>
                      <option value="favorite">星标优先</option>
                    </select>
                  </label>
                  <div className="view-toggle">
                    <button
                      aria-label="卡片视图"
                      className={layout === 'grid' ? 'selected' : ''}
                      onClick={() => setLayout('grid')}
                    >
                      <Grid2X2 size={16} />
                    </button>
                    <button
                      aria-label="列表视图"
                      className={layout === 'list' ? 'selected' : ''}
                      onClick={() => setLayout('list')}
                    >
                      <List size={16} />
                    </button>
                  </div>
                </div>
              </div>
              {q ? (
                <>
                  {skills.length > 0 && (
                    <>
                      <h3 className="results-label">
                        Skills <span>{skills.length}</span>
                      </h3>
                      <div className={`asset-grid ${layout}`}>{skills.map(skillCard)}</div>
                    </>
                  )}
                  {prompts.length > 0 && (
                    <>
                      <h3 className="results-label">
                        Prompts <span>{prompts.length}</span>
                      </h3>
                      <div className={`asset-grid ${layout}`}>{prompts.map(promptCard)}</div>
                    </>
                  )}
                  {!skills.length && !prompts.length && empty('text', true)}
                </>
              ) : page === 'skills' ? (
                skills.length ? (
                  <div className={`asset-grid ${layout}`}>{skills.map(skillCard)}</div>
                ) : (
                  empty('skills', !!tag || favoriteOnly)
                )
              ) : prompts.length ? (
                <div className={`asset-grid ${page === 'image' ? 'gallery' : ''} ${layout}`}>
                  {prompts.map(promptCard)}
                </div>
              ) : (
                empty(page === 'image' ? 'image' : 'text', !!tag || favoriteOnly)
              )}
            </>
          ) : page === 'home' ? (
            <>
              <div className="page-heading home-heading">
                <div>
                  <div className="eyebrow">A HOME FOR YOUR AI ASSETS</div>
                  <h1>
                    好灵感，值得被收藏<span className="heading-dot">.</span>
                  </h1>
                  <p>你的 Skill、Prompt 和视觉探索，都在这里。</p>
                </div>
                <span className="today">
                  {new Intl.DateTimeFormat('zh-CN', {
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long',
                  }).format(new Date())}
                </span>
              </div>
              <div className="stats-row">
                {(
                  [
                    {
                      page: 'skills',
                      title: 'Skills',
                      value: state.skills.length,
                      icon: Code2,
                      color: 'mint',
                      desc: '随时就绪的能力',
                    },
                    {
                      page: 'text',
                      title: '文本 Prompt',
                      value: textCount,
                      icon: FileText,
                      color: 'violet',
                      desc: '值得复用的好指令',
                    },
                    {
                      page: 'image',
                      title: '图片 Prompt',
                      value: imageCount,
                      icon: ImageIcon,
                      color: 'peach',
                      desc: '可以重现的视觉灵感',
                    },
                  ] as const
                ).map((s) => (
                  <button className="stat-card" key={s.page} onClick={() => go(s.page)}>
                    <div>
                      <span className={`asset-icon ${s.color}`}>
                        <s.icon size={21} />
                      </span>
                      <span>{s.title}</span>
                      <ArrowUpRight className="stat-arrow" size={17} />
                    </div>
                    <strong>{String(s.value).padStart(2, '0')}</strong>
                    <small>{s.desc}</small>
                  </button>
                ))}
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-label">
                    <Sparkles size={13} /> 从灵感到收藏，只差一步
                  </span>
                  <h2>
                    让每一次灵光乍现，
                    <br />
                    都有迹可循。
                  </h2>
                  <p>存下好用的 Prompt，也留住它带来的好作品。</p>
                  <button className="button hero-button" onClick={() => newPrompt('image')}>
                    <Plus size={17} />
                    收藏图片 Prompt
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit one" />
                  <div className="orbit two" />
                  <div className="floating-card behind">
                    <span className="art-window">
                      <i />
                      <i />
                      <i />
                    </span>
                    <div className="art-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="art-code">
                      Make something
                      <br />
                      worth keeping.
                    </span>
                  </div>
                  <div className="floating-card front">
                    <div className="art-landscape">
                      <div className="sun" />
                      <div className="mountain m1" />
                      <div className="mountain m2" />
                      <div className="mountain m3" />
                      <Sparkles size={20} />
                    </div>
                    <div className="art-caption">
                      <span>A little inspiration</span>
                      <Star fill="currentColor" size={12} />
                    </div>
                  </div>
                  <span className="floating-chip">
                    <Check size={13} /> 灵感已收好
                  </span>
                </div>
              </section>
              <div className="home-columns">
                <section className="home-section">
                  <div className="section-title">
                    <h2>
                      <Clock3 size={17} />
                      最近使用
                    </h2>
                    <button className="link muted" onClick={() => go('text')}>
                      全部 Prompt
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {state.prompts.some((p) => p.used_at) ? (
                    <div className="recent-list">
                      {[...state.prompts]
                        .filter((p) => p.used_at)
                        .sort((a, b) => b.used_at!.localeCompare(a.used_at!))
                        .slice(0, 4)
                        .map((p) => (
                          <div className="recent-item" key={p.id}>
                            <span className="asset-icon small">
                              <FileText size={17} />
                            </span>
                            <button
                              className="recent-name"
                              onClick={() => setDetail({ type: 'prompt', id: p.id })}
                            >
                              <strong>{p.title}</strong>
                              <small>
                                {p.category || '未分类'} · {date(p.used_at!)}
                              </small>
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`复制 ${p.title}`}
                              onClick={() => copy(p.content, p.id)}
                            >
                              <Copy size={15} />
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="small-empty">
                      <Copy size={23} />
                      <strong>下一次，直接复制就好</strong>
                      <p>使用过的 Prompt 会出现在这里。</p>
                      <button className="link" onClick={() => newPrompt('text')}>
                        添加文本 Prompt
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="home-section">
                  <div className="section-title">
                    <h2>
                      <Code2 size={18} />
                      最近添加的 Skill
                    </h2>
                    <button className="link muted" onClick={() => go('skills')}>
                      查看全部
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {state.skills.length ? (
                    <div className="recent-list">
                      {state.skills.slice(0, 4).map((s) => (
                        <div className="recent-item" key={s.id}>
                          <span className="asset-icon small mint">
                            <Code2 size={17} />
                          </span>
                          <button
                            className="recent-name"
                            onClick={() => setDetail({ type: 'skill', id: s.id })}
                          >
                            <strong>{s.name}</strong>
                            <small>
                              {s.source === 'github' ? 'GitHub' : '本地'} · {s.files.length} 个文件
                            </small>
                          </button>
                          <ChevronRight size={16} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="small-empty">
                      <FolderOpen size={24} />
                      <strong>把你的常用能力装进来</strong>
                      <p>支持本地文件夹和 GitHub 仓库。</p>
                      <button className="link" onClick={() => setModal({ type: 'import' })}>
                        导入 Skill
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <section className="home-section latest-images">
                <div className="section-title">
                  <h2>
                    <ImageIcon size={18} />
                    最近保存的视觉灵感
                  </h2>
                  <button className="link muted" onClick={() => go('image')}>
                    打开画廊
                    <ArrowRight size={14} />
                  </button>
                </div>
                {imageCount ? (
                  <div className="asset-grid gallery">
                    {state.prompts
                      .filter((p) => p.kind === 'image')
                      .slice(0, 3)
                      .map(promptCard)}
                  </div>
                ) : (
                  <button className="image-empty-strip" onClick={() => newPrompt('image')}>
                    <span>
                      <ImageIcon size={23} />
                    </span>
                    <div>
                      <strong>这里，将是你的灵感画廊</strong>
                      <p>收藏第一张效果图，连同创造它的 Prompt。</p>
                    </div>
                    <ArrowUpRight size={20} />
                  </button>
                )}
              </section>
              <footer className="page-footer">
                <span>
                  <HardDrive size={13} />
                  本地保存 · 随时复用
                </span>
                <span>Made for your next idea.</span>
              </footer>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR LIBRARY, YOUR CONTROL</div>
                  <h1>设置</h1>
                  <p>收藏属于你，文件也始终在你手里。</p>
                </div>
              </div>
              <div className="settings-card">
                <div className="section-title">
                  <h2>
                    <Database size={19} />
                    本地数据
                  </h2>
                  <span className="status-pill">已就绪</span>
                </div>
                <p>Prompt 与实验记录保存在 SQLite；图片和 Skill 保存为独立文件。</p>
                <label>
                  数据目录<div className="path-display">{state.root}</div>
                </label>
                <button className="button secondary" onClick={() => perform('openData')}>
                  <FolderOpen size={16} />
                  打开数据目录
                </button>
              </div>
              <div className="settings-card">
                <h2>
                  <Archive size={19} />
                  备份收藏库
                </h2>
                <p>导出数据库、图片、Skill 和一份可阅读的 JSON 清单。备份包含全部本地资产。</p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    const destination = await perform<string>('backup');
                    if (destination) notify(`备份已保存至 ${destination}`);
                  }}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  导出完整备份
                </button>
                <small>
                  恢复方法：退出应用，先另存旧数据，再将备份中的数据库、skills 和 images
                  放回数据目录。
                </small>
              </div>
              <div className="settings-card">
                <h2>
                  <Sparkles size={19} />
                  从几个例子开始
                </h2>
                <p>添加两条文本示例，体验标签、搜索和一键复制。示例会明确标注，可以随时删除。</p>
                <button
                  className="button secondary"
                  disabled={busy || state.prompts.some((p) => p.tags.includes('示例'))}
                  onClick={async () => {
                    for (const sample of [
                      {
                        title: '示例 · 结构化代码审查',
                        content:
                          '请审查以下代码，依次检查正确性、边界条件、可维护性和性能。\n\n每项问题请给出：位置、触发场景、影响和最小修复建议。对于不确定的问题，请明确说明需要补充的信息。\n\n代码：\n[粘贴代码]',
                        category: '开发',
                        tags: ['示例', '代码审查'],
                      },
                      {
                        title: '示例 · 把复杂概念讲清楚',
                        content:
                          '请向一个没有相关背景的读者解释 [概念]。\n\n先用一句话说明它解决什么问题，再用一个具体例子解释工作原理，最后指出适用范围和常见误解。避免不必要的术语。',
                        category: '学习',
                        tags: ['示例', '学习'],
                      },
                    ]) {
                      const result = await perform('savePrompt', { kind: 'text', ...sample });
                      if (!result) return;
                    }
                    notify('已添加 2 条文本示例');
                  }}
                >
                  <Plus size={16} />
                  添加文本示例
                </button>
              </div>
              <p className="settings-version">
                AgentVault 0.1.0 · Schema {state.schema} · 个人本地收藏工具
              </p>
            </>
          )}
        </main>
      </div>
      {detail && (selectedPrompt || selectedSkill) && (
        <div
          className="drawer-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="收藏详情">
            <header className="drawer-header">
              <span>
                {selectedSkill ? (
                  <>
                    <Code2 size={17} />
                    SKILL
                  </>
                ) : selectedPrompt?.kind === 'image' ? (
                  <>
                    <ImageIcon size={17} />
                    图片 PROMPT
                  </>
                ) : (
                  <>
                    <FileText size={17} />
                    文本 PROMPT
                  </>
                )}
              </span>
              <button className="icon-button" aria-label="关闭详情" onClick={() => setDetail(null)}>
                <X size={21} />
              </button>
            </header>
            <div className="drawer-content">
              {selectedPrompt ? (
                <>
                  <div className="detail-title">
                    <h1>{selectedPrompt.title}</h1>
                    <button
                      className={`icon-button ${selectedPrompt.favorite ? 'is-favorite' : ''}`}
                      aria-label="切换收藏"
                      onClick={() => toggle('prompt', selectedPrompt.id)}
                    >
                      <Star size={22} fill={selectedPrompt.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="detail-meta">
                    {selectedPrompt.category || '未分类'}
                    <span>·</span>
                    {date(selectedPrompt.updated_at)}更新
                  </div>
                  <Tags items={selectedPrompt.tags} />
                  <div className="detail-actions">
                    <button
                      className="button primary"
                      onClick={() => copy(selectedPrompt.content, selectedPrompt.id)}
                    >
                      <Copy size={16} />
                      复制 Prompt
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setModal({
                          type: 'prompt',
                          kind: selectedPrompt.kind,
                          record: selectedPrompt,
                        })
                      }
                    >
                      编辑
                    </button>
                    {selectedPrompt.kind === 'image' && (
                      <button
                        className="button secondary"
                        onClick={() => setModal({ type: 'generation', record: selectedPrompt })}
                      >
                        <Plus size={15} />
                        记录新实验
                      </button>
                    )}
                  </div>
                  <section className="detail-section">
                    <h3>Prompt 正文</h3>
                    <pre className="prompt-code">{selectedPrompt.content}</pre>
                  </section>
                  {selectedPrompt.notes && (
                    <section className="detail-section">
                      <h3>备注</h3>
                      <p className="preserve">{selectedPrompt.notes}</p>
                    </section>
                  )}
                  {selectedPrompt.kind === 'image' && (
                    <>
                      <section className="detail-section">
                        <div className="section-title">
                          <h3>
                            参考图{' '}
                            <span>
                              {selectedPrompt.images.filter((i) => i.role === 'reference').length}
                            </span>
                          </h3>
                          <button
                            className="link"
                            onClick={() =>
                              setModal({ type: 'prompt', kind: 'image', record: selectedPrompt })
                            }
                          >
                            <Plus size={14} />
                            添加
                          </button>
                        </div>
                        {selectedPrompt.images.some((i) => i.role === 'reference') ? (
                          <div className="media-grid">
                            {selectedPrompt.images
                              .filter((i) => i.role === 'reference')
                              .map((i) => (
                                <button onClick={() => setLightbox(i)} key={i.id}>
                                  <img src={i.url} alt={i.name} />
                                </button>
                              ))}
                          </div>
                        ) : (
                          <p className="section-empty">还没有参考图，可以通过编辑添加。</p>
                        )}
                      </section>
                      <section className="detail-section">
                        <h3>
                          生成实验 <span>{selectedPrompt.generations.length}</span>
                        </h3>
                        {selectedPrompt.generations.length ? (
                          selectedPrompt.generations.map((g, index) => (
                            <article className="generation" key={g.id}>
                              <div className="generation-top">
                                <span className="version-badge">
                                  V{selectedPrompt.generations.length - index}
                                </span>
                                <strong>{g.model || '未记录模型'}</strong>
                                <Stars rating={g.rating} />
                              </div>
                              <div className="detail-meta">
                                {[g.ratio, g.size, date(g.created_at)].filter(Boolean).join(' · ')}
                              </div>
                              <div className="media-grid outputs">
                                {g.images.map((i) => (
                                  <button key={i.id} onClick={() => setLightbox(i)}>
                                    <img src={i.url} alt={i.name} />
                                    <span>{i.name}</span>
                                  </button>
                                ))}
                              </div>
                              {g.parameters && (
                                <p className="generation-parameters">参数：{g.parameters}</p>
                              )}
                              {g.notes && <p className="preserve">{g.notes}</p>}
                              <details>
                                <summary>查看本次 Prompt 快照</summary>
                                <pre className="prompt-code">{g.snapshot}</pre>
                                <button
                                  className="link"
                                  onClick={() => copy(g.snapshot, selectedPrompt.id)}
                                >
                                  <Copy size={13} />
                                  复制本次快照
                                </button>
                              </details>
                            </article>
                          ))
                        ) : (
                          <p className="section-empty">
                            记录第一张效果图，留住模型、参数和当时的 Prompt。
                          </p>
                        )}
                      </section>
                    </>
                  )}
                  <div className="danger-zone">
                    <span>创建于 {date(selectedPrompt.created_at)}</span>
                    <button
                      className="link danger"
                      disabled={busy}
                      onClick={async () => {
                        const removed = await perform<boolean>('delete', {
                          kind: 'prompt',
                          id: selectedPrompt.id,
                        });
                        if (removed) {
                          setDetail(null);
                          notify('收藏已删除');
                        }
                      }}
                    >
                      <Trash2 size={14} />
                      删除收藏
                    </button>
                  </div>
                </>
              ) : (
                selectedSkill && (
                  <>
                    <div className="detail-title">
                      <h1>{selectedSkill.name}</h1>
                      <button
                        className={`icon-button ${selectedSkill.favorite ? 'is-favorite' : ''}`}
                        aria-label="切换收藏"
                        onClick={() => toggle('skill', selectedSkill.id)}
                      >
                        <Star size={22} fill={selectedSkill.favorite ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <p className="preserve description">
                      {selectedSkill.description || '暂无描述'}
                    </p>
                    <Tags items={selectedSkill.tags} />
                    <div className="detail-actions">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={async () => {
                          const target = await perform<string>('exportSkill', {
                            id: selectedSkill.id,
                          });
                          if (target) notify(`已复制至 ${target}`);
                        }}
                      >
                        <Copy size={16} />
                        复制到项目
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => perform('openSkill', { id: selectedSkill.id })}
                      >
                        <FolderOpen size={16} />
                        打开目录
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setModal({ type: 'skill', record: selectedSkill })}
                      >
                        编辑信息
                      </button>
                    </div>
                    <section className="detail-section">
                      <h3>来源与版本</h3>
                      <div className="source-box">
                        <span>
                          {selectedSkill.source === 'github' ? (
                            <Github size={17} />
                          ) : (
                            <FolderOpen size={17} />
                          )}
                        </span>
                        <div>
                          <strong>{selectedSkill.repo || '本地文件夹'}</strong>
                          <small>{selectedSkill.relative_path}</small>
                          {selectedSkill.commit_hash && (
                            <small>
                              当前 {selectedSkill.commit_hash.slice(0, 10)} · 最新{' '}
                              {selectedSkill.latest_commit.slice(0, 10)}
                            </small>
                          )}
                        </div>
                      </div>
                      {selectedSkill.source === 'github' && (
                        <div className="update-actions">
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={async () => {
                              const update = await perform<boolean>('checkUpdate', {
                                id: selectedSkill.id,
                              });
                              if (update !== undefined)
                                notify(update ? '发现新版本，可以手动更新' : '当前已是最新版本');
                            }}
                          >
                            <RefreshCw size={14} className={busy ? 'spin' : ''} />
                            检查更新
                          </button>
                          {selectedSkill.latest_commit !== selectedSkill.commit_hash && (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={async () => {
                                const commit = await perform<string>('updateSkill', {
                                  id: selectedSkill.id,
                                });
                                if (commit) notify('Skill 副本已更新，标签和收藏已保留');
                              }}
                            >
                              <ArrowDownToLine size={15} />
                              更新副本
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                    <section className="detail-section">
                      <h3>SKILL.md</h3>
                      <pre className="prompt-code skill-code">{selectedSkill.content}</pre>
                    </section>
                    <section className="detail-section">
                      <h3>
                        文件 <span>{selectedSkill.files.length}</span>
                      </h3>
                      <div className="file-tree">
                        {selectedSkill.files.map((f) => (
                          <div key={f}>
                            <FileText size={14} />
                            {f}
                          </div>
                        ))}
                      </div>
                    </section>
                    <div className="danger-zone">
                      <span>{date(selectedSkill.updated_at)}更新</span>
                      <button
                        className="link danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await perform<boolean>('delete', {
                              kind: 'skill',
                              id: selectedSkill.id,
                            })
                          ) {
                            setDetail(null);
                            notify('Skill 已从收藏库移除');
                          }
                        }}
                      >
                        <Trash2 size={14} />
                        移除 Skill
                      </button>
                    </div>
                  </>
                )
              )}
            </div>
          </aside>
        </div>
      )}
      {modal?.type === 'prompt' || modal?.type === 'generation' ? (
        <PromptForm
          modal={modal}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onSave={save}
          busy={busy}
        />
      ) : modal?.type === 'import' ? (
        <ImportForm
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onRun={importRun}
          busy={busy}
        />
      ) : modal?.type === 'skill' ? (
        <SkillForm
          record={modal.record}
          onClose={() => setModal(null)}
          onSave={saveSkill}
          busy={busy}
        />
      ) : null}
      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-label="图片大图"
          onClick={() => setLightbox(null)}
        >
          <button className="icon-button" aria-label="关闭大图">
            <X size={24} />
          </button>
          <img src={lightbox.url} alt={lightbox.name} />
          <span>{lightbox.name}</span>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <X size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle size={13} className="spin" />
          正在处理…
        </div>
      )}
    </div>
  );
}
