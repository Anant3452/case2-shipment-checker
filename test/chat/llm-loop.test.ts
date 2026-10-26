// The Gemini path with a scripted client: the model calls update_booking, the server applies it and
// returns the checks as the function response, then the model replies. No network, no key.

import { describe, expect, it } from 'vitest';
import { llmTurn, type GenerateClient, type GenerateResponse } from '../../src/chat/llm';
import { emptyState } from '../../src/chat/state';
import { carriers } from '../../src/config';

const TODAY = '2026-10-26';

function scripted(responses: GenerateResponse[]) {
  const calls: { model: string; contents: unknown[]; config: unknown }[] = [];
  const client: GenerateClient = {
    models: {
      generateContent: async (params) => {
        calls.push(params as never);
        const next = responses.shift();
        if (!next) throw new Error('no scripted response left');
        return next;
      },
    },
  };
  return { client, calls };
}

const functionCall = (name: string, args: Record<string, unknown>, id = 'fc_1'): GenerateResponse => ({
  functionCalls: [{ id, name, args }],
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { id, name, args } }] }, finishReason: 'STOP' }],
});
const text = (t: string): GenerateResponse => ({
  text: t,
  candidates: [{ content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }],
});

describe('Gemini function-calling loop (scripted)', () => {
  it('applies the function call, returns the checks as the function response, then the model reply', async () => {
    const state = emptyState();
    const { client, calls } = scripted([
      functionCall('update_booking', { originCity: 'Manchester', destinationCity: 'Frankfurt', destinationType: 'Warehouse', pallets: 3 }),
      text('Got it: Manchester to Frankfurt, 3 pallets. What is the seller name?'),
    ]);

    const out = await llmTurn(state, [], '3 pallets from Manchester to Frankfurt, warehouse', TODAY, carriers, { client });

    expect(state.booking.originCity).toBe('Manchester');
    expect(state.booking.destinationCity).toBe('Frankfurt');
    expect(state.booking.pallets).toBe(3);
    expect(out.reply).toMatch(/Manchester to Frankfurt/);

    // The second request carries the function response with the checks the model must phrase.
    const second = calls[1] as { contents: { role: string; parts: { functionResponse?: { response: Record<string, unknown> } }[] }[] };
    const last = second.contents.at(-1)!;
    expect(last.role).toBe('user');
    const response = last.parts[0].functionResponse!.response as { changed: string[]; checks: Record<string, unknown> };
    expect(response.changed).toContain('originCity');
    expect(response.checks).toHaveProperty('carriers');
  });

  it('reports a bad value back to the model as an error, not a crash', async () => {
    const state = emptyState();
    const { client, calls } = scripted([
      functionCall('update_booking', { originCity: 'Glasgow' }),
      text('We collect from London, Manchester, Birmingham or Leeds only.'),
    ]);
    const out = await llmTurn(state, [], 'from Glasgow', TODAY, carriers, { client });
    expect(state.booking.originCity).toBeNull();
    const second = calls[1] as { contents: { parts: { functionResponse?: { response: { errors: string[] } } }[] }[] };
    const response = second.contents.at(-1)!.parts[0].functionResponse!.response;
    expect(response.errors[0]).toMatch(/not a supported collection city/);
    expect(out.reply).toMatch(/only/);
  });

  it('answers every function call in one turn', async () => {
    const state = emptyState();
    const { client } = scripted([
      {
        functionCalls: [
          { id: 'a', name: 'update_booking', args: { sellerName: 'Northfield Goods' } },
          { id: 'b', name: 'update_booking', args: { sellerPriority: 'Cheapest' } },
        ],
        candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
      },
      text('Got it: Northfield Goods, cheapest.'),
    ]);
    await llmTurn(state, [], 'Northfield Goods, cheapest', TODAY, carriers, { client });
    expect(state.booking.sellerName).toBe('Northfield Goods');
    expect(state.booking.sellerPriority).toBe('Cheapest');
  });

  it('declares the tools with JSON Schema and sends the system instruction', async () => {
    const { client, calls } = scripted([text('Hello.')]);
    await llmTurn(emptyState(), [], 'hi', TODAY, carriers, { client, model: 'gemini-3.5-flash-lite' });
    const params = calls[0] as { model: string; config: { systemInstruction: string; tools: { functionDeclarations: { name: string }[] }[] } };
    expect(params.model).toBe('gemini-3.5-flash-lite');
    expect(params.config.systemInstruction).toMatch(/booking assistant/);
    expect(params.config.tools[0].functionDeclarations.map((f) => f.name)).toEqual(['update_booking', 'update_items', 'set_field', 'remove_item']);
  });

  it('treats a safety stop as a failure so the fallback answers', async () => {
    const { client } = scripted([{ candidates: [{ finishReason: 'SAFETY' }] }]);
    await expect(llmTurn(emptyState(), [], 'hi', TODAY, carriers, { client })).rejects.toThrow(/declined/);
  });
});
