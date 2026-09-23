export type Media = {
  id: string;
  name: string;
  role: 'reference' | 'output';
  url: string;
  thumbnail: string;
  generation_id: string | null;
};
export type Generation = {
  id: string;
  snapshot: string;
  model: string;
  size: string;
  ratio: string;
  parameters: string;
  rating: number;
  notes: string;
  created_at: string;
  images: Media[];
};
export type Prompt = {
  id: string;
  kind: 'text' | 'image';
  cover_id: string | null;
  title: string;
  content: string;
  category: string;
  tags: string[];
  notes: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  used_at: string | null;
  images: Media[];
  generations: Generation[];
};
export type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  favorite: boolean;
  source: string;
  repo: string;
  directory: string;
  relative_path: string;
  commit_hash: string;
  latest_commit: string;
  files: string[];
  updated_at: string;
};
export type State = { prompts: Prompt[]; skills: Skill[]; root: string; schema: number };
export type SoftwareStatus = {
  phase:
    | 'idle'
    | 'unavailable'
    | 'checking'
    | 'available'
    | 'current'
    | 'downloading'
    | 'ready'
    | 'error';
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
};
export type Scan = {
  token: string;
  candidates: { key: string; name: string; description: string; count: number }[];
};
export type BackupPreview = {
  root: string;
  schema: number;
  createdAt: string;
  verified: boolean;
  bytes: number;
  counts: { prompts: number; images: number; skills: number; generations: number };
};
declare global {
  interface Window {
    vault: {
      call: <T = unknown>(operation: string, input?: unknown) => Promise<T>;
      filePath: (file: File) => string;
      onUpdateStatus: (listener: (status: SoftwareStatus) => void) => () => void;
    };
  }
}
