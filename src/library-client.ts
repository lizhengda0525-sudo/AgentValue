import type { Media, Prompt, Skill, State } from './types.ts';
import { backendCall } from './backend-client.ts';

const seedTime = '2026-10-04T08:00:00.000Z';
const seedPrompt = (
  id: string,
  kind: 'text' | 'image',
  title: string,
  content: string,
  category: string,
  tags: string[],
): Prompt => ({
  id,
  kind,
  title,
  content,
  category,
  tags,
  notes: '',
  favorite: false,
  cover_id: null,
  images: [],
  generations: [],
  created_at: seedTime,
  updated_at: seedTime,
  used_at: null,
});
const initialState: State = {
  schema: 1,
  root: '浏览器演示 · 仅当前会话',
  prompts: [
    seedPrompt(
      'demo-report',
      'text',
      '工作周报整理',
      '根据本周记录，整理已完成事项、遇到的问题和下周计划。保留原始信息，不补写未发生的成果。',
      '工作',
      ['周报', '总结'],
    ),
    seedPrompt(
      'demo-review',
      'text',
      '代码审查',
      '检查代码中的逻辑错误、边界条件和可读性，说明问题影响，并给出具体修改建议。',
      '开发',
      ['审查', '开发'],
    ),
    seedPrompt(
      'demo-image',
      'image',
      '产品界面配图',
      'A clean minimal workspace illustration, muted sage green, soft daylight, simple geometric composition, no text.',
      '设计',
      ['配图', '设计'],
    ),
  ],
  skills: [
    {
      id: 'demo-skill',
      name: '论文速读',
      description: '提取研究问题、方法、结论和待核对信息。',
      content:
        '---\nname: paper-reader\ndescription: 论文速读\n---\n\n阅读论文，分别记录研究问题、方法、结论、局限和待核对信息。',
      tags: ['学习', '论文'],
      favorite: false,
      source: 'local',
      repo: '',
      directory: '演示 Skill',
      relative_path: 'paper-reader/SKILL.md',
      commit_hash: '',
      latest_commit: '',
      files: ['SKILL.md'],
      updated_at: seedTime,
    },
  ],
};
const previewFiles = new Map<string, string>();
const browserFiles = new Map<string, File>();
export const assetFileName = (path: string) =>
  previewFiles.get(path) || path.split(/[/\\]/).pop() || path;
type GenerationInput = {
  snapshot?: string;
  model?: string;
  size?: string;
  ratio?: string;
  parameters?: string;
  rating?: number;
  notes?: string;
  outputs?: string[];
};
type LibraryInput = GenerationInput & {
  id?: string;
  promptId?: string;
  kind?: string;
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  references?: string[];
  generation?: GenerationInput;
  name?: string;
  description?: string;
  text?: string;
  action?: string;
};
export function assetFilePath(file: File) {
  if (window.vault) return window.vault.filePath(file);
  const url = URL.createObjectURL(file);
  previewFiles.set(url, file.name);
  browserFiles.set(url, file);
  return url;
}

export function createPreviewLibrary() {
  const state = structuredClone(initialState);
  const media = (
    urls: string[],
    role: Media['role'],
    generationId: string | null = null,
  ): Media[] =>
    urls.map((url) => ({
      id: crypto.randomUUID(),
      name: previewFiles.get(url) || '预览图片',
      role,
      url,
      thumbnail: url,
      generation_id: generationId,
    }));
  return async <T = unknown>(operation: string, input?: unknown): Promise<T> => {
    const data = (input || {}) as LibraryInput;
    let result: unknown = true;
    switch (operation) {
      case 'state':
        return structuredClone(state) as T;
      case 'softwareStatus':
        return { phase: 'unavailable', message: '浏览器演示，更新与文件管理请使用桌面版。' } as T;
      case 'savePrompt': {
        if (!data.title?.trim() || !data.content?.trim())
          throw new Error('请填写标题和 Prompt 正文。');
        const old = state.prompts.find((prompt) => prompt.id === data.id);
        const prompt: Prompt =
          old ||
          seedPrompt(crypto.randomUUID(), data.kind === 'image' ? 'image' : 'text', '', '', '', []);
        Object.assign(prompt, {
          title: data.title.trim(),
          content: data.content,
          category: data.category || '',
          tags: data.tags || [],
          notes: data.notes || '',
          updated_at: new Date().toISOString(),
        });
        prompt.images.push(...media(data.references || [], 'reference'));
        if (!old) state.prompts.push(prompt);
        if (data.generation) {
          const g = data.generation;
          const id = crypto.randomUUID();
          const images = media(g.outputs || [], 'output', id);
          prompt.generations.unshift({
            id,
            snapshot: prompt.content,
            model: g.model || '',
            size: g.size || '',
            ratio: g.ratio || '',
            parameters: g.parameters || '',
            rating: g.rating || 0,
            notes: g.notes || '',
            created_at: new Date().toISOString(),
            images,
          });
          prompt.images.push(...images);
        }
        result = prompt.id;
        break;
      }
      case 'addGeneration': {
        const prompt = state.prompts.find((prompt) => prompt.id === data.promptId);
        if (!prompt) throw new Error('未找到图片提示词。');
        const id = crypto.randomUUID();
        const images = media(data.outputs || [], 'output', id);
        prompt.generations.unshift({
          id,
          snapshot: data.snapshot || prompt.content,
          model: data.model || '',
          size: data.size || '',
          ratio: data.ratio || '',
          parameters: data.parameters || '',
          rating: data.rating || 0,
          notes: data.notes || '',
          created_at: new Date().toISOString(),
          images,
        });
        prompt.images.push(...images);
        break;
      }
      case 'favorite': {
        const record = (data.kind === 'prompt' ? state.prompts : state.skills).find(
          (record) => record.id === data.id,
        );
        if (record) record.favorite = !record.favorite;
        break;
      }
      case 'saveSkill': {
        if (!data.name?.trim()) throw new Error('请填写 Skill 名称。');
        const skill = state.skills.find((skill) => skill.id === data.id);
        if (!skill) throw new Error('未找到 Skill。');
        Object.assign(skill, {
          name: data.name.trim(),
          description: data.description || '',
          tags: data.tags || [],
          updated_at: new Date().toISOString(),
        });
        break;
      }
      case 'copy': {
        if (!navigator.clipboard) throw new Error('当前浏览器无法复制，请选择正文手动复制。');
        await navigator.clipboard.writeText(data.text || '');
        const prompt = state.prompts.find((prompt) => prompt.id === data.id);
        if (prompt) prompt.used_at = new Date().toISOString();
        break;
      }
      case 'delete': {
        if (data.kind === 'prompt')
          state.prompts = state.prompts.filter((prompt) => prompt.id !== data.id);
        else state.skills = state.skills.filter((skill) => skill.id !== data.id);
        break;
      }
      case 'manageImage': {
        const prompt = state.prompts.find((prompt) =>
          prompt.images.some((image) => image.id === data.id),
        );
        if (!prompt) throw new Error('未找到图片。');
        if (data.action === 'cover' && data.id) prompt.cover_id = data.id;
        else throw new Error('图片文件调整请在桌面版中操作。');
        break;
      }
      default:
        throw new Error(
          '本机文件导入、导出和更新请在 AgentValue 桌面版中操作；浏览器演示支持查看、编辑、收藏和新增 Prompt。',
        );
    }
    return result as T;
  };
}
async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function chooseFiles(directory = false, accept = ''): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = directory;
    input.accept = accept;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}
export async function libraryCall<T = unknown>(operation: string, input?: unknown): Promise<T> {
  if (window.vault) {
    const result = await window.vault.call<T>(operation, input);
    if (operation === 'restoreBackup') window.dispatchEvent(new Event('agentvalue-restored'));
    if (operation === 'delete' && result)
      window.dispatchEvent(new CustomEvent('agentvalue-asset-deleted', { detail: input }));
    return result;
  }
  let data = { ...(input || {}) } as Record<string, any>;
  if (operation === 'savePrompt' || operation === 'addGeneration') {
    const upload = async (paths: string[] = []) =>
      Promise.all(
        paths.map(async (path) => {
          const file = browserFiles.get(path);
          if (!file) throw new Error('图片已失效，请重新选择。');
          return backendCall<string>('uploadImage', {
            name: file.name,
            base64: await base64(file),
          });
        }),
      );
    data = {
      ...data,
      references: await upload(data.references),
      outputs: await upload(data.outputs),
      ...(data.generation
        ? { generation: { ...data.generation, outputs: await upload(data.generation.outputs) } }
        : {}),
    };
  }
  if (operation === 'scanLocal') {
    const files = await chooseFiles(true);
    if (!files.length) return null as T;
    data = {
      files: await Promise.all(
        files.map(async (file) => ({
          path: file.webkitRelativePath || file.name,
          base64: await base64(file),
        })),
      ),
    };
  }
  if (operation === 'inspectBackup') {
    const [file] = await chooseFiles(false, '.json');
    if (!file) return null as T;
    data = { archive: JSON.parse(await file.text()) };
  }
  if (operation === 'copy') await navigator.clipboard.writeText(data.text || '');
  const result = await backendCall<any>(operation, data);
  if ((operation === 'openData' || operation === 'openSkill') && typeof result === 'string')
    await navigator.clipboard.writeText(result);
  if (operation === 'delete' && result)
    window.dispatchEvent(new CustomEvent('agentvalue-asset-deleted', { detail: input }));
  if (result?.download) {
    const a = document.createElement('a');
    a.href = result.download;
    a.download = result.name;
    a.click();
    return (result.path || result.name) as T;
  }
  if (operation === 'restoreBackup') window.dispatchEvent(new Event('agentvalue-restored'));
  return result as T;
}
