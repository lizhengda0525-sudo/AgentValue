import type { SyncEngine } from './engine';
export type Workspace = {
  engine: SyncEngine;
  call: <T>(operation: string, input?: unknown) => Promise<T>;
  dispose: () => void;
};
let active: Workspace | undefined;
export const cloudWorkspace = () => active;
export const inCloud = () => !!active;
export function setWorkspace(workspace?: Workspace) {
  active?.dispose();
  active = workspace;
  window.dispatchEvent(new Event('agentvalue-workspace'));
}
