import type { AssistantState } from '../src/assistant/persistence';
export function emptyAssistant(): AssistantState;
export function validateAssistant(input: unknown): AssistantState;
