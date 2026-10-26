import { describe, expect, it } from 'vitest';
import {
  checkFields, r01, r02, r03, r04, r05, r06, r07, r08, r09, r10, validateBooking, matchDangerousGoods,
} from '../../src/domain';
import { GERMANY, TODAY, bk001, ids, mug } from './helpers';

describe('BK-001 (clean fixture from the brief)', () => {
  it('has no findings', () => {
    expect(validateBooking(bk001(), [mug()], TODAY, GERMANY)).toEqual([]);
  });
});

describe('R-01 HS code at least 6 digits', () => {
  it('passes 691200', () => expect(r01([mug()])).toEqual([]));
  it('passes with spaces, dots and dashes stripped', () => {
    expect(r01([mug({ hsCode: '6912.00' })])).toEqual([]);
    expect(r01([mug({ hsCode: '69 12 00' })])).toEqual([]);
    expect(r01([mug({ hsCode: '6912-00-10' })])).toEqual([]);
  });
  it('fails a 4-digit code', () => {
    const [f] = r01([mug({ hsCode: '6912' })]);
    expect(f.ruleId).toBe('R-01');
    expect(f.severity).toBe('Red');
    expect(f.message).toContain('4 digits');
  });
  it('fails 5 digits after stripping ("69.1.20")', () => expect(r01([mug({ hsCode: '69.1.20' })])).toHaveLength(1));
  it('fails a blank code', () => {
    expect(r01([mug({ hsCode: null })])[0].message).toContain('no HS code');
    expect(r01([mug({ hsCode: '  ' })])).toHaveLength(1);
  });
  it('fails a non-numeric code', () => expect(r01([mug({ hsCode: 'mugs' })])[0].message).toContain('not a number'));
});

describe('R-02 declared value within 1% of calculated', () => {
  // calculated = 1080 × £5 = £5,400
  it('passes when equal', () => expect(r02(bk001(), [mug()])).toEqual([]));
  it('passes at exactly 1% over (5454)', () => expect(r02(bk001({ totalDeclaredValue: 5454 }), [mug()])).toEqual([]));
  it('passes at exactly 1% under (5346)', () => expect(r02(bk001({ totalDeclaredValue: 5346 }), [mug()])).toEqual([]));
  it('fails at 1.01% over (5454.54)', () => {
    const [f] = r02(bk001({ totalDeclaredValue: 5454.54 }), [mug()]);
    expect(f.ruleId).toBe('R-02');
    expect(f.message).toContain('1.01%');
  });
  it('fails at 1.01% under (5345.46)', () => expect(r02(bk001({ totalDeclaredValue: 5345.46 }), [mug()])).toHaveLength(1));
  it('is relative to the calculated sum, not the declared value', () => {
    // declared 5,280 vs calc 5,400: 120/5400 = 2.2% off.
    const [f] = r02(bk001({ totalDeclaredValue: 5280 }), [mug()]);
    expect(f.message).toContain('£5,280');
    expect(f.message).toContain('£5,400');
    expect(f.message).toContain('2.2%');
    expect(f.fix).toContain('£5,400');
  });
  it('reports a Red finding when there are no items', () => {
    const [f] = r02(bk001(), []);
    expect(f.severity).toBe('Red');
    expect(f.message).toContain('no items');
  });
});

describe('R-03 units per carton × cartons = quantity', () => {
  it('passes 12 × 90 = 1080', () => expect(r03([mug()])).toEqual([]));
  it('fails 12 × 90 ≠ 1000', () => {
    const [f] = r03([mug({ quantity: 1000 })]);
    expect(f.ruleId).toBe('R-03');
    expect(f.message).toContain('1,080 units');
    expect(f.message).toContain('1,000');
  });
});

describe('R-04 booking cartons = sum of item cartons', () => {
  it('passes 90 = 90', () => expect(r04(bk001(), [mug()])).toEqual([]));
  it('passes across two items', () => {
    expect(r04(bk001({ cartons: 100 }), [mug(), mug({ sku: 'MUG-02', cartons: 10, quantity: 120 })])).toEqual([]);
  });
  it('fails 95 ≠ 90', () => {
    const [f] = r04(bk001({ cartons: 95 }), [mug()]);
    expect(f.ruleId).toBe('R-04');
    expect(f.message).toContain('95 cartons');
    expect(f.message).toContain('90 cartons');
  });
});

describe('R-05 weight per pallet', () => {
  it('passes 620 kg / 3 pallets (207 kg) on every carrier', () => expect(r05(bk001(), GERMANY)).toEqual([]));
  it('passes when at least one carrier can take it (550 kg/pallet: only Bravo 600)', () => {
    expect(r05(bk001({ pallets: 1, totalGrossWeightKg: 550 }), GERMANY)).toEqual([]);
  });
  it('fails when no carrier can take it (620 kg on 1 pallet > 600)', () => {
    const [f] = r05(bk001({ pallets: 1 }), GERMANY);
    expect(f.ruleId).toBe('R-05');
    expect(f.message).toContain('620 kg per pallet');
    expect(f.fix).toContain('at least 2 pallets');
  });
  it('reports Red when pallets is 0, without guessing', () => {
    const [f] = r05(bk001({ pallets: 0 }), GERMANY);
    expect(f.severity).toBe('Red');
    expect(f.message).toContain('pallet count is 0');
    expect(f.fix).toContain('how many pallets');
  });
  it('reports Red when pallets is blank', () => {
    expect(r05(bk001({ pallets: null }), GERMANY)[0].message).toContain('missing');
  });
});

describe('R-06 dangerous goods keywords', () => {
  it('passes a mug', () => expect(r06([mug()])).toEqual([]));
  it('fails "aerosol spray paint" and names the keywords and SKU', () => {
    const [f] = r06([mug({ sku: 'SP-9', description: 'Aerosol spray paint, red' })]);
    expect(f.ruleId).toBe('R-06');
    expect(f.message).toContain('SP-9');
    expect(f.message).toContain('"aerosol"');
    expect(f.message).toContain('"spray"');
    expect(f.message).toContain('"paint"');
  });
  it('matches case-insensitively and on hyphenated forms', () => {
    expect(matchDangerousGoods('LI-ION power bank').map((k) => k.keyword)).toEqual(['li-ion']);
    expect(matchDangerousGoods('Battery-powered fan').map((k) => k.keyword)).toEqual(['battery']);
  });
  it('respects word boundaries', () => {
    expect(matchDangerousGoods('Paintbrush set')).toEqual([]);
    expect(matchDangerousGoods('Sprayer bottle (empty)')).toEqual([]);
    expect(matchDangerousGoods('Refuel station sign')).toEqual([]);
  });
  it('matches multi-word phrases', () => {
    expect(matchDangerousGoods('Nail polish remover 100ml').map((k) => k.keyword)).toContain('nail polish remover');
  });
  it('accepts an extended keyword list', () => {
    expect(r06([mug({ description: 'Fireworks pack' })], [{ keyword: 'fireworks', category: 'explosives' }])).toHaveLength(1);
  });
});

describe('R-07 gross weight ≥ net weight', () => {
  it('passes 620 ≥ 540', () => expect(r07(bk001(), [mug()])).toEqual([]));
  it('passes when equal', () => expect(r07(bk001({ totalGrossWeightKg: 540 }), [mug()])).toEqual([]));
  it('fails 500 < 540, as Amber', () => {
    const [f] = r07(bk001({ totalGrossWeightKg: 500 }), [mug()]);
    expect(f.ruleId).toBe('R-07');
    expect(f.severity).toBe('Amber');
    expect(f.message).toContain('540 kg');
  });
});

describe('R-08 warehouse needs a delivery appointment', () => {
  it('passes warehouse + Yes', () => expect(r08(bk001())).toEqual([]));
  it('passes business address + No', () => expect(r08(bk001({ destinationType: 'Business address', deliveryAppointmentBooked: 'No' }))).toEqual([]));
  it('fails warehouse + No, naming the site', () => {
    const [f] = r08(bk001({ deliveryAppointmentBooked: 'No' }));
    expect(f.severity).toBe('Amber');
    expect(f.fix).toContain('Frankfurt warehouse');
  });
  it('fails warehouse + unknown', () => expect(r08(bk001({ deliveryAppointmentBooked: null }))).toHaveLength(1));
});

describe('R-09 country of origin', () => {
  it('passes when present', () => expect(r09([mug()])).toEqual([]));
  it('fails when blank, as Amber', () => {
    const [f] = r09([mug({ countryOfOrigin: null })]);
    expect(f.ruleId).toBe('R-09');
    expect(f.severity).toBe('Amber');
  });
});

describe('R-10 ready date not in the past', () => {
  it('passes a future date', () => expect(r10(bk001(), TODAY)).toEqual([]));
  it('passes today', () => expect(r10(bk001({ readyToShipDate: TODAY }), TODAY)).toEqual([]));
  it('fails yesterday, as Amber', () => {
    const [f] = r10(bk001({ readyToShipDate: '2026-10-25' }), TODAY);
    expect(f.severity).toBe('Amber');
    expect(f.message).toContain('25 Oct 2026');
  });
});

describe('DATA checks', () => {
  it('flags missing and out-of-list fields as Red', () => {
    const fs = checkFields(bk001({ sellerName: null, originCity: 'Glasgow', destinationCity: 'Munich', currency: 'EUR' }), [mug({ quantity: null })]);
    expect(fs.every((f) => f.ruleId === 'DATA' && f.severity === 'Red')).toBe(true);
    expect(fs).toHaveLength(5);
  });
});

describe('validateBooking ordering', () => {
  it('lists Red before Amber', () => {
    const fs = validateBooking(bk001({ deliveryAppointmentBooked: 'No', totalDeclaredValue: 6000 }), [mug({ countryOfOrigin: null })], TODAY, GERMANY);
    expect(ids(fs)).toEqual(['R-02', 'R-08', 'R-09']);
    expect(fs[0].severity).toBe('Red');
    expect(fs.slice(1).every((f) => f.severity === 'Amber')).toBe(true);
  });
});
