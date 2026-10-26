// Scripted conversation through the rule-based slot-filler (no API key), following brief section 11:
// the seller omits pallets, the assistant asks, the seller adds 2 pallets, and the booking, the R-05
// result and the carrier ranking all update.

import { describe, expect, it } from 'vitest';
import { handleTurn } from '../../src/chat';
import { carriers } from '../../src/config';

const TODAY = '2026-10-26';

async function say(state: unknown, message: string) {
  return handleTurn({ state, history: [], message }, TODAY, carriers, null);
}

describe('chat fallback: omit pallets, then add two', () => {
  // A booking that is complete except for pallets, built from a real BK-001-style state.
  function almostComplete() {
    const booking = {
      bookingId: 'CHAT-1', sellerName: 'Glasshouse Goods', originCity: 'Leeds', originCountry: 'United Kingdom',
      destinationCity: 'Berlin', destinationCountry: 'Germany', destinationType: 'Warehouse' as const,
      readyToShipDate: '2026-10-29', sellerPriority: 'Cheapest' as const, pallets: null, cartons: 30,
      totalDeclaredValue: 1200, currency: 'GBP', totalGrossWeightKg: 900, deliveryAppointmentBooked: 'Yes' as const,
    };
    const item = {
      bookingId: 'CHAT-1', sku: 'GLS-05', description: 'Glass tumbler, 300 ml', hsCode: '701339', quantity: 300,
      unitPrice: 4, unitsPerCarton: 10, cartons: 30, unitWeightKg: 3, countryOfOrigin: 'Vietnam',
    };
    return { booking, items: [item], meta: { approximate: [], unknown: [], conversions: [], itemsDone: true, priorityDefaulted: false, pendingQuestion: 'booking.pallets' } };
  }

  it('asks for pallets, then the booking, R-05 and carrier ranking all update', async () => {
    let r = await say(almostComplete(), 'hello');
    expect(r.evaluation.missing.map((q) => q.key)).toEqual(['booking.pallets']);
    expect(r.evaluation.recommendation.status).toBe('needs-pallets');
    expect(r.reply).toMatch(/pallet/i);

    r = await say(r.state, 'add 2 pallets');
    expect(r.state.booking.pallets).toBe(2);
    const rec = r.evaluation.recommendation;
    expect(rec.status).toBe('recommended');
    // 900 kg across 2 pallets = 450 kg each: Carrier C (400 kg) is excluded, A and B remain.
    expect(rec.excluded.map((e) => e.carrier.carrier)).toEqual(['Carrier C']);
    expect(rec.eligible.map((c) => c.carrier)).toEqual(['Carrier A', 'Carrier B']);
    expect(rec.recommended?.carrier).toBe('Carrier A');
    expect(rec.recommended?.totalCost).toBe(360);
  });

  it('a mid-conversation route change re-checks the lane', async () => {
    let r = await say(almostComplete(), 'actually it is going to Lyon');
    expect(r.state.booking.destinationCountry).toBe('France');
    expect(r.state.booking.destinationCity).toBe('Lyon');
    expect(r.reply).toMatch(/re-checked/);
  });
});

describe('chat fallback: declines and messy input', () => {
  it('declines a destination outside the lanes and creates no destination', async () => {
    const r = await say(undefined, 'Send 3 pallets from Manchester to Madrid');
    expect(r.state.booking.destinationCountry).toBeNull();
    expect(r.reply).toMatch(/Spain|Madrid/i);
    expect(r.reply).toMatch(/Supported lanes/);
  });

  it('declines a non-GBP value and asks for pounds', async () => {
    const r = await say(undefined, 'the goods are worth €5,000');
    expect(r.state.booking.totalDeclaredValue).toBeNull();
    expect(r.reply).toMatch(/GBP only/);
  });

  it('converts tonnes to kg and says so', async () => {
    const r = await say(undefined, 'total weight 1.2 t');
    expect(r.state.booking.totalGrossWeightKg).toBe(1200);
    expect(r.reply).toMatch(/1,200 kg|1\.2 t/);
  });
});
