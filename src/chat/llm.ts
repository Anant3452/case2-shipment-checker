// Claude as the conversation layer. The model extracts fields and writes them through
// tools; after every change the server re-runs validateBooking and recommendCarriers and
// hands the results back. The model phrases those results; it never decides pass or fail.

import Anthropic from '@anthropic-ai/sdk';
import {
  DESTINATIONS, DESTINATION_TYPES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, SELLER_PRIORITIES,
  displayDate, money, type Carrier,
} from '../domain';
import { carrierName } from '../domain/carriers';
import {
  InputError, applyBookingPatch, evaluate, removeItem, upsertItem,
  type ChatState, type Evaluation,
} from './state';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** The subset of the SDK client this module uses, so tests can script responses. */
export interface MessagesClient {
  beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } };
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

const ALL_DEST_CITIES = Object.values(DESTINATIONS).flat();

const SYSTEM = `You are the booking assistant for a UK-to-EU freight service. A small-business seller describes a shipment in plain language; you turn it into a complete, checked booking.

How you work:
- Record every fact the seller gives by calling tools (update_booking, update_items, set_field, remove_item) BEFORE you reply. Capture all facts in a message, not just the first one.
- After each tool call you get back the checks: findings (rule ID, severity, message, fix), the carrier recommendation, and the list of missing details in priority order. These come from deterministic code. Never decide yourself whether a rule passes, never compute totals, prices, weights per pallet or dates yourself, and never contradict the tool results. Quote their numbers.
- Never ask for something the seller already said. Never invent values. If you are unsure, ask.

Each reply:
- Start with one short sentence confirming what you understood or changed ("Got it: …" on the first turn, "Updated: …" after an edit).
- Then, if relevant, one line on the checks (e.g. "R-02 (Red): the declared value is £5,400 but the items add up to £5,280.").
- Then ask one or two questions, taken from the top of the missing list (most blocking first: route before items, items before totals). Never dump a form.
- When nothing is missing, give the recommended carrier with its reason, the status (Ready, Ready with warnings, or Blocked) and the next step.
- Under about 120 words. Short sentences, active voice, plain English for a small-business owner. Explain jargon on first use in one line, e.g. "HS code (the customs code that classifies your product)". Money like £5,400; weights like 620 kg; dates like 5 Nov 2026. No "please note", no "unfortunately", no filler. Never blame the seller. Don't claim certainty about customs: say "may be held" or "could cause a delay". Don't mention tools, JSON or field names.

Messy input:
- "about 3 pallets" or "3-ish": record 3, list the field in approximate_fields, and confirm it once.
- Tonnes or grams: convert to kg, record the conversion in conversions (e.g. "1.2 t = 1,200 kg") and say so.
- "£5.4k" or "five thousand four hundred pounds": record 5400 and confirm.
- Any non-GBP currency: don't record it. Say we work in GBP only and ask for the GBP value.
- Destinations outside the lanes: don't record them. Decline politely and list the supported lanes: ${Object.entries(DESTINATIONS).map(([c, cities]) => `${c} (${cities.join(', ')})`).join(', ')}. Collection is from ${ORIGIN_CITIES.join(', ')} only.
- A total that doesn't match the items (R-02 or R-04): show both numbers and ask which to use. Never pick one silently and never overwrite the seller's number with the computed one.
- Booking totals (cartons, declared value) can be derived from the items: when they are missing, offer the item sums and ask the seller to confirm before recording them.
- HS code given as words ("mugs", "ceramics"): ask for the number and point to the UK Trade Tariff (gov.uk/trade-tariff). Never guess a code.
- Only cartons given: ask whether they're on pallets and how many. Only pallets given: ask for cartons.
- Seller doesn't know a detail: call set_field with unknown=true so it isn't asked again; the checks will show the consequence.
- "No preference" on priority: record Balanced and say you've balanced cost, speed and reliability.
- Delivery appointment is only asked when the destination is a Warehouse.
- Items: collect one product at a time. When a product is complete, ask "Anything else?". When the seller says that's all, call update_items with items_complete=true. Support edits and removal ("remove the kettles").
- If the seller writes in another language, reply in English and say which language you noticed.

Dates: resolve relative dates ("next Thursday") against today's date given in the context, record YYYY-MM-DD, and say the date back ("Thursday 29 Oct 2026") so the seller can correct it.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'update_booking',
    description: 'Set booking-level fields the seller stated. Only include fields you are setting. Returns the updated checks.',
    input_schema: {
      type: 'object',
      properties: {
        sellerName: { type: 'string' },
        originCity: { type: 'string', enum: [...ORIGIN_CITIES] },
        destinationCity: { type: 'string', enum: ALL_DEST_CITIES },
        destinationCountry: { type: 'string', enum: Object.keys(DESTINATIONS) },
        destinationType: { type: 'string', enum: [...DESTINATION_TYPES] },
        readyToShipDate: { type: 'string', description: 'YYYY-MM-DD' },
        sellerPriority: { type: 'string', enum: [...SELLER_PRIORITIES] },
        priorityDefaulted: { type: 'boolean', description: 'True when the seller said they have no preference and you chose Balanced.' },
        pallets: { type: 'number' },
        cartons: { type: 'number', description: 'Total cartons on the booking, as the seller states it.' },
        totalDeclaredValue: { type: 'number', description: 'GBP' },
        totalGrossWeightKg: { type: 'number' },
        deliveryAppointmentBooked: { type: 'string', enum: ['Yes', 'No'] },
        approximate_fields: { type: 'array', items: { type: 'string' }, description: 'Fields the seller hedged on, e.g. ["pallets"].' },
        conversions: { type: 'array', items: { type: 'string' }, description: 'Unit conversions you made, e.g. "1.2 t = 1,200 kg".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_items',
    description: 'Add products, or update existing ones. To update, set match to the existing SKU or description. Only include fields the seller stated. Returns the updated checks.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              match: { type: 'string', description: 'SKU or description of an existing item to update. Omit to add a new item.' },
              sku: { type: 'string' },
              description: { type: 'string' },
              hsCode: { type: 'string', description: 'Digits as the seller gave them. Never guess.' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'GBP per unit' },
              unitsPerCarton: { type: 'number' },
              cartons: { type: 'number' },
              unitWeightKg: { type: 'number' },
              countryOfOrigin: { type: 'string', enum: [...ITEM_ORIGIN_COUNTRIES] },
            },
            additionalProperties: false,
          },
        },
        items_complete: { type: 'boolean', description: 'True when the seller says there are no more products.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_field',
    description: 'Clear a field (value null), or mark a detail the seller does not know (unknown=true) so it is not asked again.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['booking', 'item'] },
        item: { type: 'string', description: 'SKU or description, when target is item.' },
        field: { type: 'string' },
        value: nullable({ type: ['string', 'number'] }),
        unknown: { type: 'boolean' },
      },
      required: ['target', 'field'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_item',
    description: 'Remove a product from the booking.',
    input_schema: {
      type: 'object',
      properties: { item: { type: 'string', description: 'SKU or description, e.g. "kettles".' } },
      required: ['item'],
      additionalProperties: false,
    },
  },
];

/** Compact view of the evaluation for the model. */
export function checksForModel(ev: Evaluation): Record<string, unknown> {
  const r = ev.recommendation;
  return {
    status: ev.complete ? ev.status : `In progress (would be ${ev.status} now)`,
    findings: ev.findings.map((f) => ({ rule: f.ruleId, severity: f.severity, message: f.message, fix: f.fix })),
    carriers: r.recommended
      ? {
        recommended: `${carrierName(r.recommended)}, ${money(r.recommended.totalCost)}, ${r.recommended.transitDays} days, ${r.recommended.onTimeRate}% on time`,
        reason: r.reason, alternatives: r.alternativeLines, excluded: r.excludedLines,
      }
      : { recommended: null, reason: r.reason, excluded: r.excludedLines },
    expectedArrival: ev.confirmation.expectedArrival ? displayDate(ev.confirmation.expectedArrival) : null,
    nextSteps: ev.confirmation.nextSteps,
    itemSums: {
      cartons: ev.computed.cartons,
      declaredValue: ev.computed.declaredValue != null ? money(ev.computed.declaredValue) : null,
    },
    missing: ev.missing.slice(0, 4).map((q) => q.text),
  };
}

function contextBlock(state: ChatState, ev: Evaluation, today: string): string {
  return `<context>
Today: ${displayDate(today)} (${today}).
Current booking record: ${JSON.stringify({ booking: state.booking, items: state.items, approximate: state.meta.approximate, unknown: state.meta.unknown, itemsComplete: state.meta.itemsDone })}
Current checks: ${JSON.stringify(checksForModel(ev))}
</context>`;
}

function runTool(state: ChatState, name: string, input: Record<string, unknown>): { changed: string[]; errors: string[] } {
  const changed: string[] = [];
  const errors: string[] = [];
  const attempt = (fn: () => void) => {
    try { fn(); } catch (e) {
      if (e instanceof InputError) errors.push(e.message); else throw e;
    }
  };
  switch (name) {
    case 'update_booking': {
      const { approximate_fields, conversions, priorityDefaulted, ...fields } = input as Record<string, unknown> & {
        approximate_fields?: string[]; conversions?: string[]; priorityDefaulted?: boolean;
      };
      for (const [k, v] of Object.entries(fields)) attempt(() => changed.push(...applyBookingPatch(state, { [k]: v })));
      if (approximate_fields?.length) state.meta.approximate = [...new Set([...state.meta.approximate, ...approximate_fields.map((f) => `booking.${f}`)])];
      if (conversions?.length) state.meta.conversions.push(...conversions);
      if (typeof priorityDefaulted === 'boolean') state.meta.priorityDefaulted = priorityDefaulted;
      break;
    }
    case 'update_items': {
      const items = (input.items as Record<string, unknown>[] | undefined) ?? [];
      for (const raw of items) {
        const { match, ...patch } = raw;
        attempt(() => { upsertItem(state, patch, (match as string) ?? null); changed.push(`item ${patch.sku ?? patch.description ?? match}`); });
      }
      if (input.items_complete === true && state.items.length) { state.meta.itemsDone = true; changed.push('items complete'); }
      break;
    }
    case 'set_field': {
      const { target, item, field, value, unknown } = input as { target: string; item?: string; field: string; value?: unknown; unknown?: boolean };
      if (unknown) {
        const idx = target === 'item' ? state.items.findIndex((i) => i.sku === item || i.description === item) : -1;
        const key = target === 'booking' ? `booking.${field}` : `item:${idx >= 0 ? state.items[idx].sku || state.items[idx].description : item}.${field}`;
        if (!state.meta.unknown.includes(key)) state.meta.unknown.push(key);
        changed.push(`${key} unknown`);
      } else if (target === 'booking') {
        attempt(() => changed.push(...applyBookingPatch(state, { [field]: value ?? null })));
      } else {
        attempt(() => { upsertItem(state, { [field]: value ?? null }, item ?? null); changed.push(`item ${item}.${field}`); });
      }
      break;
    }
    case 'remove_item': {
      const removed = removeItem(state, String(input.item));
      if (removed) changed.push(`removed ${removed.description ?? removed.sku}`);
      else errors.push(`No item matches "${input.item}". Items: ${state.items.map((i) => i.description ?? i.sku).join(', ') || 'none'}.`);
      break;
    }
    default:
      errors.push(`Unknown tool ${name}`);
  }
  return { changed, errors };
}

export interface LlmTurnOptions {
  client: MessagesClient;
  model?: string;
  maxIterations?: number;
}

/**
 * One conversation turn with Claude. Mutates `state`. Throws on any API problem so the
 * caller can fall back to the rule-based slot-filler with the untouched original state.
 */
export async function llmTurn(
  state: ChatState, history: HistoryTurn[], message: string, today: string, carriers: Carrier[], opts: LlmTurnOptions,
): Promise<{ reply: string; evaluation: Evaluation }> {
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const before = evaluate(state, today, carriers);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-20).map((h) => ({ role: h.role, content: h.text })),
    { role: 'user', content: `${contextBlock(state, before, today)}\n\nSeller: ${message}` },
  ];
  // Claude API refusal fallbacks are only accepted by current-generation models.
  const fallback = /^claude-(sonnet-5-5|opus-5|fable-5)/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {};

  for (let i = 0; i < (opts.maxIterations ?? 6); i++) {
    const response = await opts.client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      output_config: { effort: 'low' },
      messages,
      ...fallback,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') throw new Error('Model declined the request');
    if (response.stop_reason === 'max_tokens') throw new Error('Model reply was cut off');

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const reply = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (!reply) throw new Error('Model returned no text');
      return { reply, evaluation: evaluate(state, today, carriers) };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu) => {
      const { changed, errors } = runTool(state, tu.name, (tu.input ?? {}) as Record<string, unknown>);
      const ev = evaluate(state, today, carriers);
      return {
        type: 'tool_result',
        tool_use_id: tu.id,
        is_error: errors.length > 0 && changed.length === 0,
        content: JSON.stringify({ changed, errors, checks: checksForModel(ev) }),
      };
    });
    messages.push({ role: 'user', content: results });
  }
  throw new Error('Too many tool iterations');
}

export function createClient(): MessagesClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ maxRetries: 1, timeout: 45_000 }) as unknown as MessagesClient;
}
