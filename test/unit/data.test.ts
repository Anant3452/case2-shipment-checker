import { describe, expect, it } from 'vitest';
import carriersFile from '../../data/carriers.json';
import rulebookFile from '../../data/rulebook.json';
import { DESTINATIONS } from '../../src/domain';

describe('generated data', () => {
  it('rate card covers every lane with complete numbers', () => {
    for (const lane of Object.keys(DESTINATIONS)) {
      expect(carriersFile.carriers.some((c) => c.originCountry === 'United Kingdom' && c.destinationCountry === lane)).toBe(true);
    }
    for (const c of carriersFile.carriers) {
      for (const v of [c.pricePerPallet, c.transitDays, c.onTimeRate, c.maxWeightPerPalletKg]) expect(typeof v).toBe('number');
    }
  });

  it('rulebook is R-01..R-10 with the brief severities', () => {
    expect(rulebookFile.rules.map((r) => `${r.ruleId}:${r.severity}`)).toEqual([
      'R-01:Red', 'R-02:Red', 'R-03:Red', 'R-04:Red', 'R-05:Red', 'R-06:Red',
      'R-07:Amber', 'R-08:Amber', 'R-09:Amber', 'R-10:Amber',
    ]);
  });
});
