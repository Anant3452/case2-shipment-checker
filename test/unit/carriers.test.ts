import { describe, expect, it } from 'vitest';
import {
  balancedScores, buildConfirmation, carrierName, computeStatus, rankCarriers, recommendCarriers, validateBooking,
  type RankedCarrier,
} from '../../src/domain';
import { GERMANY, TODAY, bk001, carrier, mug } from './helpers';

const rc = (c: ReturnType<typeof carrier>, pallets = 1): RankedCarrier => ({ ...c, totalCost: c.pricePerPallet * pallets });
const names = (list: RankedCarrier[]) => list.map((c) => c.carrier);

describe('recommendCarriers: eligibility', () => {
  it('BK-001 (Cheapest): all three Germany carriers eligible, Charlie cheapest at £495', () => {
    const r = recommendCarriers(bk001(), [mug()], 'Cheapest', GERMANY);
    expect(r.status).toBe('recommended');
    expect(names(r.eligible)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect(r.recommended?.totalCost).toBe(495);
    expect(r.reason).toBe('Cheapest eligible option at £495 for 3 pallets, but it takes 7 days against 5 for the next option (£540).');
    expect(r.alternatives).toHaveLength(2);
    expect(r.excluded).toEqual([]);
  });

  it('excludes carriers that fail R-05 and says why', () => {
    // 450 kg on 1 pallet: Charlie (400) out, Alpha (500) and Bravo (600) in.
    const r = recommendCarriers(bk001({ pallets: 1, totalGrossWeightKg: 450 }), [], 'Cheapest', GERMANY);
    expect(names(r.eligible)).toEqual(['Alpha', 'Bravo']);
    expect(r.excluded.map((e) => e.carrier.carrier)).toEqual(['Charlie']);
    expect(r.excluded[0].reason).toBe("Excluded: 450 kg across 1 pallet is 450 kg per pallet, above this carrier's 400 kg limit.");
  });

  it('only matches the booking lane', () => {
    const fr = carrier({ carrier: 'France Only', destinationCountry: 'France' });
    const r = recommendCarriers(bk001(), [], 'Cheapest', [...GERMANY, fr]);
    expect(names(r.eligible)).not.toContain('France Only');
  });

  it('none eligible: explains limits and suggests a fix', () => {
    const r = recommendCarriers(bk001({ pallets: 1, totalGrossWeightKg: 700 }), [], 'Cheapest', GERMANY);
    expect(r.status).toBe('none-eligible');
    expect(r.recommended).toBeNull();
    expect(r.excluded).toHaveLength(3);
    expect(r.reason).toContain('700 kg per pallet');
    expect(r.reason).toContain('at least 2 pallets');
  });

  it('pallets 0 or blank: does not guess', () => {
    expect(recommendCarriers(bk001({ pallets: 0 }), [], 'Cheapest', GERMANY).status).toBe('needs-pallets');
    expect(recommendCarriers(bk001({ pallets: null }), [], 'Cheapest', GERMANY).eligible).toEqual([]);
  });

  it('no carrier on the lane: lists the lanes that are served', () => {
    const r = recommendCarriers(bk001({ destinationCountry: 'France', destinationCity: 'Paris' }), [], 'Cheapest', GERMANY);
    expect(r.status).toBe('no-lane');
    expect(r.reason).toContain('United Kingdom → Germany');
  });

  it('defaults to Balanced when no priority is given and says so', () => {
    const r = recommendCarriers(bk001(), [], null, GERMANY);
    expect(r.priority).toBe('Balanced');
    expect(r.reason).toContain('No priority was given');
  });
});

describe('rankCarriers by priority', () => {
  const list = GERMANY.map((c) => rc(c, 3));

  it('Cheapest: lowest total cost', () => expect(names(rankCarriers(list, 'Cheapest'))).toEqual(['Charlie', 'Alpha', 'Bravo']));
  it('Fastest: lowest transit', () => expect(names(rankCarriers(list, 'Fastest'))).toEqual(['Bravo', 'Alpha', 'Charlie']));
  it('Most reliable: highest on-time', () => expect(names(rankCarriers(list, 'Most reliable'))).toEqual(['Bravo', 'Alpha', 'Charlie']));

  it('Fastest tie-breaks on cost', () => {
    const tied = [
      rc(carrier({ carrier: 'Dear', pricePerPallet: 300, transitDays: 2 })),
      rc(carrier({ carrier: 'Cheap', pricePerPallet: 200, transitDays: 2 })),
      rc(carrier({ carrier: 'Slow', pricePerPallet: 100, transitDays: 6 })),
    ];
    expect(names(rankCarriers(tied, 'Fastest'))).toEqual(['Cheap', 'Dear', 'Slow']);
  });

  it('Most reliable tie-breaks on cost', () => {
    const tied = [
      rc(carrier({ carrier: 'Dear', pricePerPallet: 300, onTimeRate: 97 })),
      rc(carrier({ carrier: 'Cheap', pricePerPallet: 200, onTimeRate: 97 })),
    ];
    expect(names(rankCarriers(tied, 'Most reliable'))).toEqual(['Cheap', 'Dear']);
  });

  it('Cheapest tie-breaks on name so the order is stable', () => {
    const tied = [rc(carrier({ carrier: 'Zed' })), rc(carrier({ carrier: 'Amy' }))];
    expect(names(rankCarriers(tied, 'Cheapest'))).toEqual(['Amy', 'Zed']);
  });

  it('single eligible carrier: recommended, reason says it was the only option', () => {
    const only = [GERMANY[1]];
    for (const p of ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'] as const) {
      const r = recommendCarriers(bk001(), [], p, only);
      expect(r.recommended?.carrier).toBe('Bravo');
      expect(r.reason).toContain('only eligible option');
      expect(r.alternatives).toEqual([]);
    }
  });
});

describe('Balanced score', () => {
  /*
   * Worked example (weights cost 0.40, speed 0.30, reliability 0.30):
   *
   *   carrier  cost  days  on-time
   *   X        £500   5     90%
   *   Y        £600   3     95%
   *   Z        £400   7     85%
   *
   * Normalise (min-max, cost and days inverted so lower = better = 1):
   *   cost:  X (600-500)/200 = 0.5   Y 0.0   Z 1.0
   *   speed: X (7-5)/4      = 0.5   Y 1.0   Z 0.0
   *   rel:   X (90-85)/10   = 0.5   Y 1.0   Z 0.0
   *
   * Score = 0.4·cost + 0.3·speed + 0.3·rel
   *   X = 0.20 + 0.15 + 0.15 = 0.50
   *   Y = 0.00 + 0.30 + 0.30 = 0.60   ← best
   *   Z = 0.40 + 0.00 + 0.00 = 0.40
   */
  const X = rc(carrier({ carrier: 'X', pricePerPallet: 500, transitDays: 5, onTimeRate: 90 }));
  const Y = rc(carrier({ carrier: 'Y', pricePerPallet: 600, transitDays: 3, onTimeRate: 95 }));
  const Z = rc(carrier({ carrier: 'Z', pricePerPallet: 400, transitDays: 7, onTimeRate: 85 }));

  it('matches the worked example', () => {
    const [x, y, z] = balancedScores([X, Y, Z]);
    expect(x).toBeCloseTo(0.5, 10);
    expect(y).toBeCloseTo(0.6, 10);
    expect(z).toBeCloseTo(0.4, 10);
    expect(names(rankCarriers([X, Y, Z], 'Balanced'))).toEqual(['Y', 'X', 'Z']);
  });

  it('changes with the weights (cost-heavy picks Z)', () => {
    expect(names(rankCarriers([X, Y, Z], 'Balanced', { cost: 0.8, speed: 0.1, reliability: 0.1 }))[0]).toBe('Z');
  });

  it('tie-breaks on cost', () => {
    // Mirror images: P is cheaper but slower, Q is faster but dearer, same reliability. With equal
    // cost/speed weights both score 0.5, so the cheaper one wins.
    const P = rc(carrier({ carrier: 'P', pricePerPallet: 100, transitDays: 6, onTimeRate: 90 }));
    const Q = rc(carrier({ carrier: 'Q', pricePerPallet: 200, transitDays: 2, onTimeRate: 90 }));
    expect(names(rankCarriers([Q, P], 'Balanced', { cost: 0.4, speed: 0.4, reliability: 0.2 }))).toEqual(['P', 'Q']);
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() => balancedScores([X], { cost: 0.5, speed: 0.5, reliability: 0.5 })).toThrow(/sum to 1/);
  });
});

describe('computeStatus', () => {
  it('Ready with no findings', () => expect(computeStatus([])).toBe('Ready'));
  it('Ready with warnings with Amber only', () => {
    expect(computeStatus([{ ruleId: 'R-08', severity: 'Amber', message: '', fix: '', fieldRefs: [] }])).toBe('Ready with warnings');
  });
  it('Blocked with any Red', () => {
    expect(computeStatus([
      { ruleId: 'R-08', severity: 'Amber', message: '', fix: '', fieldRefs: [] },
      { ruleId: 'R-02', severity: 'Red', message: '', fix: '', fieldRefs: [] },
    ])).toBe('Blocked');
  });
});

describe('buildConfirmation', () => {
  it('BK-001: names the product, route, carrier, cost and arrival (ready + transit calendar days)', () => {
    const booking = bk001();
    const rec = recommendCarriers(booking, [mug()], 'Cheapest', GERMANY);
    const c = buildConfirmation(booking, [mug()], rec, validateBooking(booking, [mug()], TODAY, GERMANY));
    expect(c.status).toBe('Ready');
    expect(c.goods).toEqual(['1,080 × Ceramic coffee mug, 350 ml']);
    expect(c.route).toBe('Manchester to Frankfurt, Germany (warehouse)');
    expect(c.carrier).toBe(carrierName(GERMANY[2]));
    expect(c.totalCost).toBe(495);
    expect(c.expectedArrival).toBe('2026-11-12'); // 5 Nov + 7 days
    expect(c.text).toContain('Expected arrival: 12 Nov 2026');
  });

  it('gives specific next steps for a blocked booking', () => {
    const booking = bk001({ totalDeclaredValue: 6000, deliveryAppointmentBooked: 'No' });
    const findings = validateBooking(booking, [mug()], TODAY, GERMANY);
    const c = buildConfirmation(booking, [mug()], recommendCarriers(booking, [mug()], 'Cheapest', GERMANY), findings);
    expect(c.status).toBe('Blocked');
    expect(c.nextSteps[0]).toBe('Fix the R-02 value mismatch and book a delivery appointment with the Frankfurt warehouse.');
    expect(c.nextSteps[1]).toBe('Once these are done, the booking is ready to confirm.');
  });
});
