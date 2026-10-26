// Chat entry point: Claude when a key is set, the rule-based slot-filler otherwise or on any failure.

import type { Carrier } from '../domain';
import { fallbackTurn } from './fallback';
import { createClient, llmTurn, type HistoryTurn, type MessagesClient } from './llm';
import { normaliseState, type ChatState, type Evaluation } from './state';

export interface ChatRequest {
  state?: unknown;
  history?: HistoryTurn[];
  message: string;
}

export interface ChatResponse {
  state: ChatState;
  reply: string;
  evaluation: Evaluation;
  engine: 'claude' | 'fallback';
  /** Set when Claude was configured but failed and the fallback answered. */
  notice?: string;
}

export async function handleTurn(
  req: ChatRequest, today: string, carriers: Carrier[], client: MessagesClient | null = createClient(),
): Promise<ChatResponse> {
  const original = normaliseState(req.state);
  const message = String(req.message ?? '').slice(0, 4000);
  if (client) {
    const working = structuredClone(original);
    try {
      const { reply, evaluation } = await llmTurn(working, req.history ?? [], message, today, carriers, { client });
      return { state: working, reply, evaluation, engine: 'claude' };
    } catch (err) {
      console.error('Claude turn failed, using fallback:', err instanceof Error ? err.message : err);
      const r = fallbackTurn(original, message, today, carriers);
      return { ...r, engine: 'fallback', notice: 'The AI assistant is unavailable right now, so a simpler rule-based assistant answered.' };
    }
  }
  const r = fallbackTurn(original, message, today, carriers);
  return { ...r, engine: 'fallback' };
}

export { evaluate, normaliseState, emptyState } from './state';
export type { ChatState, Evaluation } from './state';
