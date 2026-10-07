import { parse } from 'yaml';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { emptyAssistant, validateAssistant } from '../../shared/assistant-validation.js';
import type { AssistantState } from '../assistant/persistence';
import type { State, Scan, BackupPreview } from '../types';
import {
  SyncEngine,
  blobReferences,
  validateEdit,
  type Edit,
  type Kind,
  type Data,
} from './engine.ts';
const assistantKinds: Kind[] = ['task', 'log', 'goal', 'review', 'savedReview'];
const now = () => new Date().toISOString();
const ensure: (ok: unknown, text: string) => asserts ok = (ok, text) => {
  if (!ok) throw new Error(text);
};
const text = (value: unknown, max: number, required = false) => {
  ensure(
    typeof value === 'string' && value.length <= max && (!required || value.trim()),
    '填写内容无效或过长',
  );
  return value;
};
const tags = (values: unknown) => {
  ensure(
    Array.isArray(values) &&
      values.length <= 30 &&
      values.every((v) => typeof v === 'string' && v.length <= 80),
    '标签无效',
  );
  return [...new Set(values as string[])];
};
export function assistantEdits(state: AssistantState): Edit[] {
  return [
    ...state.tasks.map((data) => ({ kind: 'task' as const, id: data.id, data })),
    ...state.logs.map((data) => ({ kind: 'log' as const, id: data.id, data })),
    ...state.goals.map((data) => ({ kind: 'goal' as const, id: data.id, data })),
    ...Object.entries(state.reviews).map(([id, value]) => ({
      kind: 'review' as const,
      id,
      data: { value },
    })),
    ...Object.entries(state.savedReviews).map(([id, data]) => ({
      kind: 'savedReview' as const,
      id,
      data,
    })),
  ];
}
export function assembleAssistant(rows: Edit[], timer?: AssistantState['timer']) {
  const state = emptyAssistant();
  for (const r of rows) {
    if (r.kind === 'task') state.tasks.push(r.data as AssistantState['tasks'][number]);
    if (r.kind === 'log') state.logs.push(r.data as AssistantState['logs'][number]);
    if (r.kind === 'goal') state.goals.push(r.data as AssistantState['goals'][number]);
    if (r.kind === 'review') state.reviews[r.id] = r.data.value;
    if (r.kind === 'savedReview')
      state.savedReviews[r.id] = r.data as AssistantState['savedReviews'][string];
  }
  // An offline log may arrive after its task was removed on another device. Retain it in records and backups.
  // It is surfaced in the sync panel's unlinked-record export instead of inventing a new task.
  state.logs = state.logs.filter((log) => state.tasks.some((t) => t.id === log.taskId));
  if (timer?.taskId && state.tasks.some((t) => t.id === timer.taskId)) state.timer = timer;
  return validateAssistant(state);
}
export function bytesFromBase64(base64: string) {
  ensure(
    typeof base64 === 'string' &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(base64) &&
      base64.length <= 42 * 1024 ** 2,
    '文件编码无效或超过 30 MB',
  );
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
export function safePath(value: string) {
  ensure(
    typeof value === 'string' &&
      value.length <= 1000 &&
      !/[:\\\x00-\x1f]/.test(value) &&
      !value.split('/').some((v) => !v || v === '.' || v === '..'),
    '文件路径无效',
  );
  return value;
}
type FileEntry = { path: string; bytes: Uint8Array };
type ScanSession = {
  files: FileEntry[];
  source: string;
  repo: string;
  commit: string;
  candidates: Scan['candidates'];
};
function skillInfo(files: FileEntry[], directory: string) {
  const prefix = directory ? `${directory}/` : '';
  const selected = files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  const main = selected.find((f) => f.path === 'SKILL.md');
  ensure(main, '未发现 SKILL.md');
  const content = new TextDecoder().decode(main.bytes);
  ensure(content.length <= 1_000_000, 'SKILL.md 过大');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = match ? parse(match[1], { maxAliasCount: 20 }) : {};
  return {
    content,
    name: text(
      typeof meta?.name === 'string' ? meta.name : directory.split('/').pop() || 'skill',
      120,
      true,
    ),
    description: text(typeof meta?.description === 'string' ? meta.description : '', 2000),
    files: selected,
  };
}
export class CloudBackend {
  readonly engine: SyncEngine;
  private urls = new Map<string, string>();
  private uploads = new Map<string, { blob: string; name: string; type: string }>();
  private scans = new Map<string, ScanSession>();
  private restore?: { rows: Edit[]; blobs: Record<string, Uint8Array> };
  constructor(engine: SyncEngine) {
    this.engine = engine;
  }
  dispose() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.engine.close();
  }
  private async imageUrl(hash: string, type: string) {
    if (this.urls.has(hash)) return this.urls.get(hash)!;
    try {
      const source = await this.engine.blob(hash);
      const url = URL.createObjectURL(new Blob([source], { type }));
      this.urls.set(hash, url);
      return url;
    } catch {
      return '';
    } // Offline metadata is usable; missing attachments are visibly labelled in the UI.
  }
  private async state(): Promise<State> {
    const { rows, revision } = await this.engine.snapshot();
    const images: Data[] = await Promise.all(
      rows
        .filter((r) => r.kind === 'image')
        .map(async (r) => ({
          ...r.data,
          id: r.id,
          url: await this.imageUrl(r.data.blob, r.data.type),
          thumbnail: await this.imageUrl(r.data.blob, r.data.type),
        })),
    );
    const prompts = rows
      .filter((r) => r.kind === 'prompt')
      .map((r) => ({
        ...r.data,
        id: r.id,
        images: images.filter((i) => i.prompt_id === r.id).sort((a, b) => a.position - b.position),
        generations: rows
          .filter((g) => g.kind === 'generation' && g.data.prompt_id === r.id)
          .map(
            (g) =>
              ({
                ...g.data,
                id: g.id,
                images: images
                  .filter((i) => i.generation_id === g.id)
                  .sort((a, b) => a.position - b.position),
              }) as Data,
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }));
    return {
      schema: 4,
      root: '云空间 · 离线可用',
      syncRevision: revision,
      prompts,
      skills: rows
        .filter((r) => r.kind === 'skill')
        .map((r) => ({ ...r.data, id: r.id, directory: '云空间（导出 ZIP 后可在项目中使用）' })),
    } as State;
  }
  async call<T = unknown>(operation: string, value?: unknown): Promise<T> {
    if (
      typeof window !== 'undefined' &&
      window.vault &&
      [
        'softwareStatus',
        'checkSoftwareUpdate',
        'downloadSoftwareUpdate',
        'installSoftwareUpdate',
        'uninstallSoftware',
      ].includes(operation)
    )
      return window.vault.call<T>(operation, value);
    const input = (value || {}) as Data;
    const snapshot = await this.engine.snapshot();
    const rows = snapshot.rows;
    const edits: Edit[] = [];
    const find = (kind: Kind, id: string) => {
      const r = rows.find((r) => r.kind === kind && r.id === id);
      ensure(r, '记录不存在或已被其他设备删除');
      return r;
    };
    const update = (kind: Kind, id: string, data: Data) =>
      edits.push({ kind, id, data: { ...find(kind, id).data, ...data } });
    const remove = (r: Edit) => edits.push({ ...r, deleted: true });
    let result: unknown = true;
    switch (operation) {
      case 'state':
        return (await this.state()) as T;
      case 'assistantState':
        return { ...assembleAssistant(rows, snapshot.timer), revision: snapshot.revision } as T;
      case 'assistantSave': {
        const state = validateAssistant(input.state),
          next = assistantEdits(state);
        const ids = new Set(next.map((r) => `${r.kind}:${r.id}`));
        const deletes = rows.filter(
          (r) => assistantKinds.includes(r.kind) && !ids.has(`${r.kind}:${r.id}`),
        );
        // Preserve unlinked logs until the user recovers or explicitly deletes them in sync settings.
        const taskIds = new Set(rows.filter((r) => r.kind === 'task').map((r) => r.id));
        for (const r of deletes)
          if (r.kind !== 'log' || taskIds.has(r.data.taskId)) edits.push({ ...r, deleted: true });
        edits.push(...next);
        return { revision: await this.engine.commit(edits, input.revision, state.timer) } as T;
      }
      case 'uploadImage': {
        const bytes = bytesFromBase64(input.base64),
          name = text(input.name, 255, true);
        const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10',
          jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
          gif = /^GIF8[79]a/.test(new TextDecoder().decode(bytes.slice(0, 6))),
          webp =
            new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
            new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
        const type = png
          ? 'image/png'
          : jpeg
            ? 'image/jpeg'
            : gif
              ? 'image/gif'
              : webp
                ? 'image/webp'
                : '';
        ensure(type, '仅支持内容有效的 PNG、JPG、GIF、WebP 图片');
        const blob = await this.engine.storeBlob(new Blob([new Uint8Array(bytes)], { type })),
          key = crypto.randomUUID();
        this.uploads.set(key, { blob, name, type });
        return key as T;
      }
      case 'savePrompt': {
        const old = input.id ? find('prompt', input.id).data : undefined,
          id = input.id || crypto.randomUUID();
        const kind = old?.kind || input.kind;
        ensure(['text', 'image'].includes(kind), 'Prompt 类型无效');
        const prompt = {
          ...old,
          id,
          kind,
          title: text(input.title, 160, true).trim(),
          content: text(input.content, 1_000_000, true),
          category: text(input.category || '', 80),
          tags: tags(input.tags || []),
          notes: text(input.notes || '', 10000),
          favorite: old?.favorite || false,
          cover_id: old?.cover_id || null,
          created_at: old?.created_at || now(),
          updated_at: now(),
          used_at: old?.used_at || null,
        };
        edits.push({ kind: 'prompt', id, data: prompt });
        if (kind === 'image') {
          this.addImages(edits, rows, id, null, 'reference', input.references || []);
          if (input.generation)
            this.addGeneration(edits, rows, id, prompt.content, input.generation);
        }
        result = id;
        break;
      }
      case 'addGeneration': {
        const p = find('prompt', input.promptId);
        ensure(p.data.kind === 'image', '仅图片 Prompt 支持实验记录');
        result = this.addGeneration(
          edits,
          rows,
          p.id,
          text(input.snapshot ?? p.data.content, 1_000_000, true),
          input,
        );
        update('prompt', p.id, { updated_at: now() });
        break;
      }
      case 'favorite': {
        ensure(['prompt', 'skill'].includes(input.kind), '类型无效');
        const r = find(input.kind, input.id);
        update(input.kind, input.id, { favorite: !r.data.favorite });
        break;
      }
      case 'delete': {
        ensure(['prompt', 'skill'].includes(input.kind), '类型无效');
        remove(find(input.kind, input.id));
        rows
          .filter((r) => r.data.prompt_id === input.id || r.data.skill_id === input.id)
          .forEach(remove);
        rows
          .filter(
            (r) =>
              r.kind === 'task' && r.data.assetId === input.id && r.data.assetKind === input.kind,
          )
          .forEach((r) => {
            const data = { ...r.data };
            delete data.asset;
            delete data.assetId;
            delete data.assetKind;
            edits.push({ ...r, data });
          });
        break;
      }
      case 'copy':
        if (input.id) update('prompt', input.id, { used_at: now() });
        break;
      case 'manageImage': {
        const image = find('image', input.id);
        if (input.action === 'cover')
          update('prompt', image.data.prompt_id, { cover_id: image.id });
        else if (input.action === 'delete') {
          remove(image);
          const p = find('prompt', image.data.prompt_id);
          if (p.data.cover_id === image.id) update('prompt', p.id, { cover_id: null });
        } else if (input.action === 'move') {
          ensure(input.direction === 1 || input.direction === -1, '排序方向无效');
          const group = rows
            .filter(
              (r) =>
                r.kind === 'image' &&
                r.data.prompt_id === image.data.prompt_id &&
                r.data.role === image.data.role &&
                r.data.generation_id === image.data.generation_id,
            )
            .sort((a, b) => a.data.position - b.data.position);
          const at = group.findIndex((r) => r.id === image.id),
            next = at + input.direction;
          if (next >= 0 && next < group.length) [group[at], group[next]] = [group[next], group[at]];
          group.forEach((r, i) => update('image', r.id, { position: i }));
        } else throw new Error('图片操作无效');
        break;
      }
      case 'scanLocal': {
        ensure(
          Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 10000,
          '请选择 Skill 文件夹',
        );
        const files = input.files.map((f: Data) => ({
          path: safePath(f.path),
          bytes: bytesFromBase64(f.base64),
        }));
        ensure(
          files.reduce((sum: number, f: FileEntry) => sum + f.bytes.length, 0) <= 200 * 1024 ** 2,
          '目录超过 200 MB',
        );
        return this.scan(files, 'local', '', '') as T;
      }
      case 'scanGithub': {
        const repo = this.repo(input.url),
          remote = await this.githubFiles(repo);
        return this.scan(remote.files, 'github', repo, remote.commit) as T;
      }
      case 'importSkills': {
        const scan = this.scans.get(input.token);
        ensure(scan, '导入会话已过期，请重新扫描');
        ensure(Array.isArray(input.keys) && input.keys.length, '请选择 Skill');
        let skipped = 0,
          imported = 0;
        for (const directory of [...new Set(input.keys as string[])]) {
          ensure(
            scan.candidates.some((c) => c.key === directory),
            '导入路径无效',
          );
          if (
            scan.source === 'github' &&
            rows.some(
              (r) =>
                r.kind === 'skill' &&
                r.data.repo === scan.repo &&
                r.data.relative_path === directory,
            )
          ) {
            skipped++;
            continue;
          }
          const info = skillInfo(scan.files, directory),
            id = crypto.randomUUID();
          const files = await this.storeFiles(id, info.files);
          edits.push(...files, {
            kind: 'skill',
            id,
            data: {
              id,
              name: info.name,
              description: info.description,
              content: info.content,
              tags: [],
              favorite: false,
              source: scan.source,
              repo: scan.repo,
              relative_path: directory,
              commit_hash: scan.commit,
              latest_commit: scan.commit,
              files: info.files.map((f) => f.path),
              file_manifest: Object.fromEntries(files.map((f) => [f.data.path, f.data.blob])),
              updated_at: now(),
            },
          });
          imported++;
        }
        result = { imported, skipped };
        break;
      }
      case 'saveSkill':
        update('skill', input.id, {
          name: text(input.name, 120, true),
          description: text(input.description || '', 2000),
          tags: tags(input.tags || []),
          updated_at: now(),
        });
        break;
      case 'checkUpdate': {
        const s = find('skill', input.id);
        ensure(s.data.source === 'github', '本地 Skill 不支持 GitHub 更新');
        const commit = await this.githubCommit(this.repo(s.data.repo));
        update('skill', s.id, { latest_commit: commit });
        result = commit !== s.data.commit_hash;
        break;
      }
      case 'updateSkill': {
        const s = find('skill', input.id);
        ensure(s.data.source === 'github', '仅 GitHub Skill 支持更新');
        const remote = await this.githubFiles(this.repo(s.data.repo)),
          info = skillInfo(remote.files, s.data.relative_path);
        rows.filter((r) => r.kind === 'skillFile' && r.data.skill_id === s.id).forEach(remove);
        const importedFiles = await this.storeFiles(s.id, info.files);
        edits.push(...importedFiles);
        update('skill', s.id, {
          content: info.content,
          files: info.files.map((f) => f.path),
          file_manifest: Object.fromEntries(importedFiles.map((f) => [f.data.path, f.data.blob])),
          commit_hash: remote.commit,
          latest_commit: remote.commit,
          updated_at: now(),
        });
        break;
      }
      case 'exportSkill': {
        const skill = find('skill', input.id),
          files: Record<string, Uint8Array> = {};
        const name = skill.data.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'skill';
        const manifest =
          skill.data.file_manifest ||
          Object.fromEntries(
            rows
              .filter((r) => r.kind === 'skillFile' && r.data.skill_id === skill.id)
              .map((r) => [r.data.path, r.data.blob]),
          );
        ensure(
          Array.isArray(skill.data.files) &&
            skill.data.files.length &&
            skill.data.files.length === Object.keys(manifest).length &&
            skill.data.files.every((file: string) => manifest[file]),
          'Skill 附件尚未同步完整，请联网同步后再导出',
        );
        for (const [relative, hash] of Object.entries(manifest))
          files[`${name}/${safePath(relative)}`] = new Uint8Array(
            await (await this.engine.blob(hash as string)).arrayBuffer(),
          );
        return this.download(zipSync(files), `${name}.zip`) as T;
      }
      case 'openData':
        return '云空间：附件和 Skill 请通过导出或备份下载。' as T;
      case 'openSkill':
        return '云空间：点击“下载 Skill ZIP”后解压到项目目录。' as T;
      case 'softwareStatus':
        return {
          phase: 'unavailable',
          currentVersion: '2.0.0',
          message: '云空间正在使用；桌面软件更新请切回本机空间。',
        } as T;
      case 'backup':
        return (await this.backup()) as T;
      case 'inspectBackup':
        return (await this.inspectBackup(input.archive)) as T;
      case 'restoreBackup': {
        ensure(this.restore, '请先选择并检查云空间备份');
        const recovery = await this.backup();
        this.clickDownload(recovery);
        for (const [hash, bytes] of Object.entries(this.restore.blobs))
          ensure(
            (await this.engine.storeBlob(new Blob([new Uint8Array(bytes)]))) === hash,
            '附件校验失败',
          );
        const desired = new Set(this.restore.rows.map((r) => `${r.kind}:${r.id}`));
        const deletions = rows
          .filter((r) => !desired.has(`${r.kind}:${r.id}`))
          .map((r) => ({ ...r, deleted: true }));
        await this.engine.commit(
          [...deletions, ...this.restore.rows],
          snapshot.revision,
          emptyAssistant().timer,
        );
        this.restore = undefined;
        return { recovery: recovery.name } as T;
      }
      default:
        throw new Error('此操作需切回电脑的本机空间完成');
    }
    if (edits.length) await this.engine.commit(edits, input._revision || snapshot.revision);
    return result as T;
  }
  private addImages(
    edits: Edit[],
    rows: Edit[],
    promptId: string,
    generationId: string | null,
    role: string,
    keys: string[],
  ) {
    ensure(Array.isArray(keys) && keys.length <= 30, '每次最多保存 30 张图片');
    const offset = rows.filter((r) => r.kind === 'image' && r.data.prompt_id === promptId).length;
    keys.forEach((key, i) => {
      const image = this.uploads.get(key);
      ensure(image, '图片已过期，请重新选择');
      const id = crypto.randomUUID();
      edits.push({
        kind: 'image',
        id,
        data: {
          ...image,
          id,
          prompt_id: promptId,
          generation_id: generationId,
          role,
          position: offset + i,
        },
      });
    });
  }
  private addGeneration(
    edits: Edit[],
    rows: Edit[],
    promptId: string,
    snapshot: string,
    input: Data,
  ) {
    const id = crypto.randomUUID(),
      rating = Number(input.rating || 0);
    ensure(Number.isInteger(rating) && rating >= 0 && rating <= 5, '评分无效');
    edits.push({
      kind: 'generation',
      id,
      data: {
        id,
        prompt_id: promptId,
        snapshot,
        model: text(input.model || '', 120),
        size: text(input.size || '', 80),
        ratio: text(input.ratio || '', 40),
        parameters: text(input.parameters || '', 10000),
        rating,
        notes: text(input.notes || '', 10000),
        created_at: now(),
      },
    });
    this.addImages(edits, rows, promptId, id, 'output', input.outputs || []);
    return id;
  }
  private scan(files: FileEntry[], source: string, repo: string, commit: string): Scan {
    const candidates = files
      .filter((f) => f.path.split('/').pop() === 'SKILL.md')
      .map((f) => {
        const directory = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        const info = skillInfo(files, directory);
        return {
          key: directory,
          name: info.name,
          description: info.description,
          count: info.files.length,
        };
      });
    ensure(candidates.length, '未发现 SKILL.md');
    const token = crypto.randomUUID();
    this.scans.set(token, { files, source, repo, commit, candidates });
    return { token, candidates };
  }
  private async storeFiles(skillId: string, files: FileEntry[]): Promise<Edit[]> {
    const result: Edit[] = [];
    for (const f of files) {
      const path = safePath(f.path),
        blob = await this.engine.storeBlob(new Blob([new Uint8Array(f.bytes)]));
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path))),
        (n) => n.toString(16).padStart(2, '0'),
      ).join('');
      result.push({
        kind: 'skillFile',
        id: `${skillId}:${digest}`,
        data: { skill_id: skillId, path, blob },
      });
    }
    return result;
  }
  private repo(url: string) {
    const m = String(url).match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    ensure(m, '请输入公开 GitHub 仓库根地址');
    return `https://github.com/${m[1]}/${m[2]}`;
  }
  private async githubJson(repo: string, path: string) {
    const response = await fetch(
      `https://api.github.com/repos/${repo.slice('https://github.com/'.length)}/${path}`,
      { signal: AbortSignal.timeout(30000) },
    );
    ensure(
      response.ok,
      response.status === 403 ? 'GitHub 请求额度已用完，请稍后重试' : '无法读取公开 GitHub 仓库',
    );
    return response.json();
  }
  private async githubCommit(repo: string) {
    const data = await this.githubJson(repo, 'commits/HEAD');
    ensure(/^[a-f0-9]{40}$/.test(data.sha), 'GitHub 版本无效');
    return data.sha as string;
  }
  private async githubFiles(repo: string) {
    const commit = await this.githubCommit(repo),
      tree = await this.githubJson(repo, `git/trees/${commit}?recursive=1`);
    ensure(
      !tree.truncated && Array.isArray(tree.tree) && tree.tree.length <= 10000,
      '仓库目录过大，请缩小导入范围',
    );
    const mains = tree.tree.filter(
      (f: Data) =>
        f.type === 'blob' &&
        f.mode !== '120000' &&
        (f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md')),
    );
    ensure(mains.length, '仓库未发现 SKILL.md');
    const prefixes = mains.map((f: Data) => f.path.slice(0, -'SKILL.md'.length));
    const selected = tree.tree.filter(
      (f: Data) =>
        f.type === 'blob' &&
        f.mode !== '120000' &&
        prefixes.some((p: string) => f.path.startsWith(p)) &&
        !f.path.split('/').some((p: string) => ['.git', 'node_modules', '.env'].includes(p)),
    );
    ensure(
      selected.length <= 10000 &&
        selected.reduce((sum: number, f: Data) => sum + f.size, 0) <= 200 * 1024 ** 2,
      'Skill 文件超过 200 MB',
    );
    const files: FileEntry[] = [];
    for (const f of selected) {
      const path = safePath(f.path);
      ensure(f.size <= 30 * 1024 ** 2, '单个文件超过 30 MB');
      const response = await fetch(
        `https://raw.githubusercontent.com/${repo.slice('https://github.com/'.length)}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`,
        { signal: AbortSignal.timeout(30000) },
      );
      ensure(response.ok, '无法下载 Skill 文件');
      const bytes = new Uint8Array(await response.arrayBuffer());
      ensure(bytes.length <= 30 * 1024 ** 2, '单个文件超过 30 MB');
      files.push({ path, bytes });
    }
    return { files, commit };
  }
  private download(bytes: Uint8Array, name: string) {
    const download = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], {
        type: name.endsWith('.zip') ? 'application/zip' : 'application/json',
      }),
    );
    setTimeout(() => URL.revokeObjectURL(download), 60000);
    return { download, name };
  }
  private clickDownload(result: { download: string; name: string }) {
    const a = document.createElement('a');
    a.href = result.download;
    a.download = result.name;
    a.click();
  }
  async backup() {
    const snapshot = await this.engine.snapshot(),
      files: Record<string, Uint8Array> = {};
    files['records.json'] = strToU8(
      JSON.stringify({
        app: 'AgentValue-Cloud',
        schema: 1,
        createdAt: now(),
        rows: snapshot.rows.map(({ kind, id, data }) => ({ kind, id, data })),
      }),
    );
    for (const hash of new Set(snapshot.rows.flatMap((r) => blobReferences(r.data))))
      files[`blobs/${hash}`] = new Uint8Array(await (await this.engine.blob(hash)).arrayBuffer());
    // Use JSON envelope to preserve the existing file-picker/backup workflow.
    const zip = zipSync(files),
      chunks: string[] = [];
    for (let i = 0; i < zip.length; i += 32768)
      chunks.push(String.fromCharCode(...zip.subarray(i, i + 32768)));
    return this.download(
      strToU8(JSON.stringify({ app: 'AgentValue-Cloud-Archive', zip: btoa(chunks.join('')) })),
      `AgentValue-云空间-${now().slice(0, 10)}.json`,
    );
  }
  private async inspectBackup(archive: Data): Promise<BackupPreview> {
    ensure(
      archive?.app === 'AgentValue-Cloud-Archive' &&
        typeof archive.zip === 'string' &&
        archive.zip.length <= 700 * 1024 ** 2,
      '请选择云空间导出的备份文件',
    );
    const zipped = Uint8Array.from(atob(archive.zip), (c) => c.charCodeAt(0));
    let total = 0;
    const files = unzipSync(zipped, {
      filter(file) {
        ensure(file.originalSize <= 512 * 1024 ** 2, '备份文件过大');
        total += file.originalSize;
        ensure(total <= 512 * 1024 ** 2, '备份解压后超过 512 MB');
        return true;
      },
    });
    ensure(files['records.json'], '备份记录不存在');
    const data = JSON.parse(new TextDecoder().decode(files['records.json']));
    ensure(
      data.app === 'AgentValue-Cloud' &&
        data.schema === 1 &&
        Array.isArray(data.rows) &&
        data.rows.length <= 100000,
      '备份格式无效',
    );
    const seen = new Set<string>(),
      blobs: Record<string, Uint8Array> = {};
    for (const row of data.rows) {
      validateEdit(row);
      const key = `${row.kind}:${row.id}`;
      ensure(!seen.has(key), '备份编号重复');
      seen.add(key);
      for (const hash of blobReferences(row.data)) {
        const bytes = files[`blobs/${hash}`];
        ensure(bytes, '备份附件缺失');
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
          (n) => n.toString(16).padStart(2, '0'),
        ).join('');
        ensure(digest === hash, '备份附件校验失败');
        blobs[digest] = bytes;
      }
    }
    assembleAssistant(data.rows);
    this.restore = { rows: data.rows, blobs };
    const count = (kind: string) => data.rows.filter((r: Edit) => r.kind === kind).length;
    return {
      root: '云空间备份',
      schema: 1,
      createdAt: data.createdAt,
      verified: true,
      bytes: total,
      counts: {
        prompts: count('prompt'),
        images: count('image'),
        generations: count('generation'),
        skills: count('skill'),
        tasks: count('task'),
        logs: count('log'),
        goals: count('goal'),
        reviews: count('review'),
      },
    };
  }
  async importLocal(archive: {
    assistant: AssistantState;
    records: Edit[];
    files: { kind: Kind; id: string; base64: string; type?: string; name?: string }[];
  }) {
    const snapshot = await this.engine.snapshot();
    ensure(
      !snapshot.rows.length && !this.engine.status.pending && !this.engine.status.error,
      '请先同步；仅空云空间支持首次导入，避免覆盖已有数据',
    );
    const edits = assistantEdits(validateAssistant(archive.assistant));
    const records = structuredClone(archive.records);
    records.forEach(validateEdit);
    for (const file of archive.files) {
      const record = records.find((r) => r.kind === file.kind && r.id === file.id);
      ensure(record, '导入附件没有对应记录');
      record.data.blob = await this.engine.storeBlob(
        new Blob([new Uint8Array(bytesFromBase64(file.base64))], { type: file.type || '' }),
      );
      if (file.type) record.data.type = file.type;
      if (file.name) record.data.name = file.name;
    }
    for (const skill of records.filter((r) => r.kind === 'skill'))
      skill.data.file_manifest = Object.fromEntries(
        records
          .filter((r) => r.kind === 'skillFile' && r.data.skill_id === skill.id)
          .map((r) => [safePath(r.data.path), r.data.blob]),
      );
    await this.engine.commit([...edits, ...records], snapshot.revision, emptyAssistant().timer);
  }
}
