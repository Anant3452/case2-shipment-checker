import { describe, expect, it } from 'vitest';
import {
  addDays, displayDate, money, kg, parseCount, parseDMY, parseHsCode, parseMoneyGBP, parseNaturalDate,
  parseNumber, parseWeightKg, wordsToNumber,
} from '../../src/domain';

const TODAY = '2026-10-26'; // a Monday

describe('counts', () => {
  it('"about 3 pallets" → 3, approximate', () => expect(parseCount('about 3 pallets', 'pallet')).toEqual({ value: 3, approximate: true }));
  it('"3-ish pallets" → 3, approximate', () => expect(parseCount('3-ish pallets', 'pallet')).toEqual({ value: 3, approximate: true }));
  it('"send 3 pallets of mugs" → 3, exact', () => expect(parseCount('I need to send 3 pallets of mugs', 'pallet')).toEqual({ value: 3, approximate: false }));
  it('"two pallets" → 2', () => expect(parseCount('add two pallets', 'pallet')?.value).toBe(2));
  it('"1 pallet" singular', () => expect(parseCount('just 1 pallet', 'pallet')?.value).toBe(1));
  it('"90 cartons"', () => expect(parseCount('90 cartons in total', 'carton')?.value).toBe(90));
  it('no count → null', () => expect(parseCount('some pallets', 'pallet')).toBeNull());
});

describe('weights', () => {
  it('"1.2 t" → 1200 kg with a note', () => expect(parseWeightKg('1.2 t')).toEqual({ value: 1200, approximate: false, note: '1.2 t = 1,200 kg' }));
  it('"1.2 tonnes" → 1200 kg', () => expect(parseWeightKg('about 1.2 tonnes')?.value).toBe(1200));
  it('"800 g" → 0.8 kg', () => expect(parseWeightKg('800 g')?.value).toBe(0.8));
  it('"620kg" → 620', () => expect(parseWeightKg('620kg')?.value).toBe(620));
  it('"1,250 kg" → 1250', () => expect(parseWeightKg('1,250 kg')?.value).toBe(1250));
  it('bare number is kg', () => expect(parseWeightKg('620')?.value).toBe(620));
});

describe('money', () => {
  it('"£5.4k" → 5400', () => expect(parseMoneyGBP('£5.4k')).toEqual({ ok: true, value: 5400, approximate: false }));
  it('"£5,400.50" → 5400.5', () => expect(parseMoneyGBP('£5,400.50')).toMatchObject({ ok: true, value: 5400.5 }));
  it('"5400 GBP" → 5400', () => expect(parseMoneyGBP('5400 GBP')).toMatchObject({ ok: true, value: 5400 }));
  it('"five thousand four hundred pounds" → 5400', () => expect(parseMoneyGBP('five thousand four hundred pounds')).toMatchObject({ ok: true, value: 5400 }));
  it('rejects euros', () => expect(parseMoneyGBP('€5,000')).toEqual({ ok: false, reason: 'non-gbp', currency: '€' }));
  it('rejects dollars', () => expect(parseMoneyGBP('5000 USD')).toMatchObject({ ok: false, reason: 'non-gbp' }));
  it('rejects rupees', () => expect(parseMoneyGBP('4 lakh rupees')).toMatchObject({ ok: false, reason: 'non-gbp' }));
});

describe('numbers', () => {
  it('words', () => {
    expect(wordsToNumber('five thousand four hundred')).toBe(5400);
    expect(wordsToNumber('one hundred and twenty')).toBe(120);
    expect(wordsToNumber('mugs')).toBeNull();
  });
  it('"1,080" → 1080', () => expect(parseNumber('1,080 units')?.value).toBe(1080));
});

describe('HS codes', () => {
  it('strips spaces', () => expect(parseHsCode('6912 00')).toBe('691200'));
  it('strips dots', () => expect(parseHsCode('HS 6912.00.10')).toBe('69120010'));
  it('strips dashes', () => expect(parseHsCode('6912-00')).toBe('691200'));
  it('"mugs" has no code', () => expect(parseHsCode('mugs')).toBeNull());
  it('"ceramics" has no code', () => expect(parseHsCode('ceramics')).toBeNull());
});

describe('dates', () => {
  it('DD-MM-YYYY', () => expect(parseDMY('05-11-2026')).toBe('2026-11-05'));
  it('D/M/YYYY', () => expect(parseDMY('5/11/2026')).toBe('2026-11-05'));
  it('rejects impossible dates', () => expect(parseDMY('31-02-2026')).toBeNull());
  it('rejects other formats', () => expect(parseDMY('2026-11-05')).toBeNull());
  it('natural: today / tomorrow', () => {
    expect(parseNaturalDate('ready today', TODAY)).toBe('2026-10-26');
    expect(parseNaturalDate('tomorrow', TODAY)).toBe('2026-10-27');
  });
  it('natural: "next Thursday" on a Monday is the coming Thursday', () => expect(parseNaturalDate('next Thursday', TODAY)).toBe('2026-10-29'));
  it('natural: "Monday" on a Monday is a week later', () => expect(parseNaturalDate('Monday', TODAY)).toBe('2026-11-02'));
  it('natural: "5 Nov" / "November 5th 2026"', () => {
    expect(parseNaturalDate('5 Nov', TODAY)).toBe('2026-11-05');
    expect(parseNaturalDate('November 5th, 2026', TODAY)).toBe('2026-11-05');
  });
  it('natural: past day-month rolls to next year', () => expect(parseNaturalDate('3rd March', TODAY)).toBe('2027-03-03'));
  it('natural: "in 10 days"', () => expect(parseNaturalDate('in 10 days', TODAY)).toBe('2026-11-05'));
  it('natural: DD-MM-YYYY inside a sentence', () => expect(parseNaturalDate('ready on 05-11-2026', TODAY)).toBe('2026-11-05'));
});

describe('display formats', () => {
  it('money', () => {
    expect(money(5400)).toBe('£5,400');
    expect(money(5400.5)).toBe('£5,400.50');
  });
  it('kg', () => expect(kg(1250)).toBe('1,250 kg'));
  it('date', () => expect(displayDate('2026-11-05')).toBe('5 Nov 2026'));
  it('addDays crosses months', () => expect(addDays('2026-10-30', 5)).toBe('2026-11-04'));
});
