// The Claude path with a scripted client: the model calls update_booking, the server applies it and
// returns the checks as the tool result, then the model replies. No network, no key.

import { describe, expect, it } from 'vitest';
import { llmTurn, type MessagesClient } from '../../src/chat/llm';
import { emptyState } from '../../src/chat/state';
import { carriers } from '../../src/config';

const TODAY = '2026-10-26';

function scripted(responses: unknown[]) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return responses.shift();
        },
      },
    },
  } as unknown as MessagesClient;
  return { client, calls };
}

describe('Claude tool loop (scripted)', () => {
  it('applies the tool call, sends the checks back, and returns the model reply', async () => {
    const state = emptyState();
    const { client, calls } = scripted([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'update_booking', input: { originCity: 'Manchester', destinationCity: 'Frankfurt', destinationType: 'Warehouse', pallets: 3 } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Got it: Manchester to Frankfurt, 3 pallets. What is the seller name?' }] },
    ]);

    const out = await llmTurn(state, [], '3 pallets from Manchester to Frankfurt, warehouse', TODAY, carriers, { client });

    expect(state.booking.originCity).toBe('Manchester');
    expect(state.booking.destinationCity).toBe('Frankfurt');
    expect(state.booking.pallets).toBe(3);
    expect(out.reply).toMatch(/Manchester to Frankfurt/);

    // The second request carries the tool result with the checks the model must phrase.
    const second = calls[1] as { messages: { content: { content: string }[] }[] };
    const toolResult = JSON.parse((second.messages.at(-1)!.content as unknown as { content: string }[])[0].content);
    expect(toolResult.changed).toContain('originCity');
    expect(toolResult.checks.carriers.excluded).toBeDefined();
  });

  it('reports a bad value back to the model as an error, not a crash', async () => {
    const state = emptyState();
    const { client, calls } = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_2', name: 'update_booking', input: { originCity: 'Glasgow' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'We collect from London, Manchester, Birmingham or Leeds only.' }] },
    ]);
    const out = await llmTurn(state, [], 'from Glasgow', TODAY, carriers, { client });
    expect(state.booking.originCity).toBeNull();
    const second = calls[1] as { messages: { content: { content: string }[] }[] };
    const toolResult = JSON.parse((second.messages.at(-1)!.content as unknown as { content: string }[])[0].content);
    expect(toolResult.errors[0]).toMatch(/not a supported collection city/);
    expect(out.reply).toMatch(/only/);
  });

  it('sends the refusal fallback header on current-generation models', async () => {
    const { client, calls } = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] }]);
    await llmTurn(emptyState(), [], 'hi', TODAY, carriers, { client, model: 'claude-opus-5-5' });
    const params = calls[0] as { betas?: string[]; fallbacks?: string; model: string };
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
  });
});
