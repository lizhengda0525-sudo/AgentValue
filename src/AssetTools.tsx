import { useState } from 'react';
import { ModalShell } from './ModalShell';
import { resolveTemplate, templateVariables } from './template';
import type { BackupPreview, Media } from './types';

export function TemplateForm({
  content,
  onClose,
  onCopy,
}: {
  content: string;
  onClose: () => void;
  onCopy: (text: string) => Promise<void>;
}) {
  const names = templateVariables(content);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const preview = resolveTemplate(content, values);
  const value = (name: string) => (Object.hasOwn(values, name) ? values[name] : '');
  return (
    <ModalShell
      title="填写模板变量"
      subtitle="填写后复制本次内容，原模板保持不变。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="asset-form form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await onCopy(preview);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="variable-fields">
          {names.map((name) => (
            <label key={name}>
              {name}
              <textarea
                required
                rows={2}
                maxLength={20000}
                value={value(name)}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <label>
          复制预览
          <textarea readOnly rows={6} value={preview} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || names.some((n) => !value(n).trim()) || preview.length > 200000}
          >
            填写并复制
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function RestoreForm({
  preview,
  busy,
  onClose,
  onRestore,
}: {
  preview: BackupPreview;
  busy: boolean;
  onClose: () => void;
  onRestore: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ModalShell title="恢复收藏库" subtitle="先确认备份内容，再替换当前收藏库。" onClose={onClose}>
      <div className="asset-form form">
        <div className="path-display">{preview.root}</div>
        <p>
          备份时间：
          {preview.createdAt ? new Date(preview.createdAt).toLocaleString('zh-CN') : '未知'} · 格式{' '}
          {preview.schema}
        </p>
        <div className="restore-counts">
          <span>{preview.counts.prompts} 条 Prompt</span>
          <span>{preview.counts.skills} 个 Skill</span>
          <span>{preview.counts.images} 张图片</span>
          <span>{preview.counts.generations} 次实验</span>
        </div>
        <p>
          {preview.verified
            ? '文件完整性校验通过。'
            : '这是旧版备份：数据库与引用文件检查通过，原备份没有文件校验和。'}
        </p>
        <p>当前库会先自动备份到数据目录旁的 recovery 文件夹。恢复失败或替换中断时会回退。</p>
        <label className="restore-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我确认用此备份替换当前收藏库
        </label>
        <div className="form-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy || !confirmed} onClick={onRestore}>
            {busy ? '正在恢复…' : '确认恢复'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function ImageTools({
  image,
  isCover,
  busy,
  onView,
  onAction,
}: {
  image: Media;
  isCover: boolean;
  busy: boolean;
  onView: () => void;
  onAction: (action: string, direction?: number) => Promise<unknown>;
}) {
  return (
    <div className="managed-image">
      <button className="image-view" onClick={onView} aria-label={`查看 ${image.name}`}>
        <img src={image.thumbnail} loading="lazy" alt={image.name} />
      </button>
      <span className="image-name" title={image.name}>
        {image.name}
      </span>
      <div className="image-actions">
        <button
          disabled={busy}
          onClick={() => onAction('cover')}
          aria-label={`设为封面 ${image.name}`}
        >
          {isCover ? '✓ 封面' : '设为封面'}
        </button>
        <button
          disabled={busy}
          onClick={() => onAction('move', -1)}
          aria-label={`前移 ${image.name}`}
        >
          ←
        </button>
        <button
          disabled={busy}
          onClick={() => onAction('move', 1)}
          aria-label={`后移 ${image.name}`}
        >
          →
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => onAction('delete')}
          aria-label={`移除图片 ${image.name}`}
        >
          移除
        </button>
      </div>
    </div>
  );
}
