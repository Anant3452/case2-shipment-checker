// Rulebook R-01..R-10 as deterministic code, plus DATA checks for missing or invalid fields.
// Pure functions: no I/O, no clock. `today` is passed in.

import dangerousGoods from '../../config/dangerous-goods.json';
import { displayDate, kg, listJoin, money, num, pct, plural } from './format';
import {
  CURRENCY, DESTINATIONS, DESTINATION_TYPES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, ORIGIN_COUNTRY,
  SELLER_PRIORITIES,
  type Booking, type Carrier, type FieldRef, type Finding, type Item,
} from './types';

export interface DangerousGoodsKeyword {
  keyword: string;
  category: string;
}

export interface ValidateOptions {
  dangerousGoods?: DangerousGoodsKeyword[];
}

const DEFAULT_DG: DangerousGoodsKeyword[] = dangerousGoods.keywords;

const b = (field: keyof Booking): FieldRef => ({ entity: 'booking', field });
const it = (index: number, field: keyof Item): FieldRef => ({ entity: 'item', index, field });

/** "MUG-01 (Ceramic coffee mug, 350 ml)", falling back to whichever exists. */
export function itemLabel(item: Item, index: number): string {
  if (item.sku && item.description) return `${item.sku} (${item.description})`;
  return item.sku || item.description || `item ${index + 1}`;
}

/** Strip spaces, dots and dashes. */
export function normaliseHsCode(raw: string | null | undefined): string {
  return (raw ?? '').toString().replace(/[\s.\-]/g, '');
}

const isNum = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// DATA: missing or invalid fields. Fields that a rule reports itself (pallets → R-05,
// HS code → R-01, item country of origin → R-09, delivery appointment → R-08) are left to that rule.

export function checkFields(booking: Booking, items: Item[]): Finding[] {
  const out: Finding[] = [];
  const missing = (label: string, ref: FieldRef, fix: string) =>
    out.push({ ruleId: 'DATA', severity: 'Red', message: `${label} is missing.`, fix, fieldRefs: [ref] });
  const invalid = (message: string, ref: FieldRef, fix: string) =>
    out.push({ ruleId: 'DATA', severity: 'Red', message, fix, fieldRefs: [ref] });

  if (!booking.sellerName) missing('Seller name', b('sellerName'), 'Add the name of the business sending the goods.');

  if (!booking.originCity) missing('Origin city', b('originCity'), `Add the collection city: ${listJoin([...ORIGIN_CITIES])}.`);
  else if (!(ORIGIN_CITIES as readonly string[]).includes(booking.originCity))
    invalid(`Origin city "${booking.originCity}" is not a supported collection city.`, b('originCity'),
      `Use one of ${listJoin([...ORIGIN_CITIES])}.`);

  if (booking.originCountry && booking.originCountry !== ORIGIN_COUNTRY)
    invalid(`Origin country "${booking.originCountry}" is not supported. Shipments start in the United Kingdom.`,
      b('originCountry'), 'Set the origin country to United Kingdom.');

  const lanes = Object.keys(DESTINATIONS);
  if (!booking.destinationCountry) missing('Destination country', b('destinationCountry'), `Add the destination country: ${listJoin(lanes)}.`);
  else if (!lanes.includes(booking.destinationCountry))
    invalid(`Destination country "${booking.destinationCountry}" is not a supported lane.`, b('destinationCountry'),
      `Supported destinations are ${listJoin(lanes)}.`);

  if (!booking.destinationCity) missing('Destination city', b('destinationCity'), 'Add the delivery city.');
  else if (booking.destinationCountry && lanes.includes(booking.destinationCountry)
    && !DESTINATIONS[booking.destinationCountry].includes(booking.destinationCity))
    invalid(`${booking.destinationCity} is not a supported city in ${booking.destinationCountry}.`, b('destinationCity'),
      `Use one of ${listJoin([...DESTINATIONS[booking.destinationCountry]])}.`);

  if (!booking.destinationType) missing('Destination type', b('destinationType'), 'Say whether the site is a Warehouse or a Business address.');
  else if (!(DESTINATION_TYPES as readonly string[]).includes(booking.destinationType))
    invalid(`Destination type "${booking.destinationType}" is not recognised.`, b('destinationType'), 'Use Warehouse or Business address.');

  if (!booking.readyToShipDate) missing('Ready-to-ship date', b('readyToShipDate'), 'Add the date the goods will be packed and ready for collection.');

  if (!booking.sellerPriority) missing('Seller priority', b('sellerPriority'), `Choose ${listJoin([...SELLER_PRIORITIES])}.`);
  else if (!(SELLER_PRIORITIES as readonly string[]).includes(booking.sellerPriority))
    invalid(`Seller priority "${booking.sellerPriority}" is not recognised.`, b('sellerPriority'), `Choose ${listJoin([...SELLER_PRIORITIES])}.`);

  if (!isNum(booking.cartons)) missing('Total cartons', b('cartons'), 'Add the total number of cartons on the booking.');
  if (!isNum(booking.totalDeclaredValue)) missing('Total declared value', b('totalDeclaredValue'), 'Add the total value of the goods in GBP.');
  if (!isNum(booking.totalGrossWeightKg)) missing('Total gross weight', b('totalGrossWeightKg'), 'Add the weight of everything shipped, in kg, including cartons and pallets.');

  if (booking.currency && booking.currency.toUpperCase() !== CURRENCY)
    invalid(`Currency is ${booking.currency}. Only GBP is supported.`, b('currency'), 'Give every value in GBP.');

  items.forEach((item, i) => {
    const label = itemLabel(item, i);
    if (!item.sku && !item.description) missing(`Product name for item ${i + 1}`, it(i, 'description'), 'Add a SKU or a short description.');
    const numeric: [keyof Item, string][] = [
      ['quantity', 'Quantity'], ['unitPrice', 'Unit price'], ['unitsPerCarton', 'Units per carton'],
      ['cartons', 'Cartons'], ['unitWeightKg', 'Unit weight'],
    ];
    for (const [field, name] of numeric) {
      const v = item[field] as number | null;
      if (!isNum(v)) missing(`${name} for ${label}`, it(i, field), `Add the ${name.toLowerCase()} for ${label}.`);
      else if (v < 0) invalid(`${name} for ${label} is negative (${num(v)}).`, it(i, field), `Check the ${name.toLowerCase()}.`);
    }
    if (item.countryOfOrigin && !(ITEM_ORIGIN_COUNTRIES as readonly string[]).includes(item.countryOfOrigin))
      invalid(`Country of origin "${item.countryOfOrigin}" for ${label} is not in the supported list.`, it(i, 'countryOfOrigin'),
        `Use one of ${listJoin([...ITEM_ORIGIN_COUNTRIES])}.`);
  });

  return out;
}

// ---------------------------------------------------------------------------
// R-01 HS code at least 6 digits.

export function r01(items: Item[]): Finding[] {
  const out: Finding[] = [];
  items.forEach((item, i) => {
    const label = itemLabel(item, i);
    const code = normaliseHsCode(item.hsCode);
    const ref = [it(i, 'hsCode')];
    if (code === '') {
      out.push({
        ruleId: 'R-01', severity: 'Red', fieldRefs: ref,
        message: `${label} has no HS code (the customs code that classifies your product). Goods without one may be held at customs.`,
        fix: 'Look up the code on the UK Trade Tariff (gov.uk/trade-tariff) and add at least the first 6 digits.',
      });
    } else if (!/^\d+$/.test(code)) {
      out.push({
        ruleId: 'R-01', severity: 'Red', fieldRefs: ref,
        message: `The HS code for ${label} is "${item.hsCode}", which is not a number.`,
        fix: 'Replace it with the numeric code from the UK Trade Tariff (gov.uk/trade-tariff), at least 6 digits.',
      });
    } else if (code.length < 6) {
      out.push({
        ruleId: 'R-01', severity: 'Red', fieldRefs: ref,
        message: `The HS code for ${label} is ${code}, which has ${code.length} digits. Customs needs at least 6.`,
        fix: 'Check the full code on the UK Trade Tariff (gov.uk/trade-tariff) and add the missing digits.',
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// R-02 declared value equals Σ(quantity × unit price) within 1% of the calculated sum.

export function calculatedValue(items: Item[]): number | null {
  if (items.some((i) => !isNum(i.quantity) || !isNum(i.unitPrice))) return null;
  return items.reduce((s, i) => s + (i.quantity as number) * (i.unitPrice as number), 0);
}

export function r02(booking: Booking, items: Item[]): Finding[] {
  if (items.length === 0) {
    return [{
      ruleId: 'R-02', severity: 'Red', fieldRefs: [b('totalDeclaredValue')],
      message: 'There are no items on this booking, so the declared value cannot be checked.',
      fix: 'Add each product with its quantity and unit price.',
    }];
  }
  const declared = booking.totalDeclaredValue;
  const calc = calculatedValue(items);
  if (!isNum(declared) || calc === null) return []; // reported by checkFields
  const diff = Math.abs(declared - calc);
  if (diff <= 0.01 * calc + EPS) return [];
  const off = calc === 0 ? null : (diff / calc) * 100;
  return [{
    ruleId: 'R-02', severity: 'Red',
    fieldRefs: [b('totalDeclaredValue'), ...items.flatMap((_, i) => [it(i, 'quantity'), it(i, 'unitPrice')])],
    message: `The declared value is ${money(declared)}, but the items add up to ${money(calc)}.`
      + (off === null ? '' : ` That is ${pct(off)} off, and the allowed tolerance is 1%.`)
      + ' Customs relies on these figures matching, so the shipment may be held.',
    fix: `Check the quantities and unit prices, or change the declared value to ${money(calc)}.`,
  }];
}

// ---------------------------------------------------------------------------
// R-03 units per carton × cartons = quantity, per item.

export function r03(items: Item[]): Finding[] {
  const out: Finding[] = [];
  items.forEach((item, i) => {
    const { unitsPerCarton: upc, cartons, quantity } = item;
    if (!isNum(upc) || !isNum(cartons) || !isNum(quantity)) return;
    const packed = upc * cartons;
    if (Math.abs(packed - quantity) <= EPS) return;
    const label = itemLabel(item, i);
    out.push({
      ruleId: 'R-03', severity: 'Red',
      fieldRefs: [it(i, 'unitsPerCarton'), it(i, 'cartons'), it(i, 'quantity')],
      message: `${label}: ${num(upc)} units per carton × ${plural(cartons, 'carton')} is ${num(packed)} units, but the quantity is ${num(quantity)}. The receiving site may report units missing.`,
      fix: `Recount the cartons or units per carton, or change the quantity to ${num(packed)}.`,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// R-04 booking cartons = Σ item cartons.

export function r04(booking: Booking, items: Item[]): Finding[] {
  if (!isNum(booking.cartons) || items.length === 0 || items.some((i) => !isNum(i.cartons))) return [];
  const sum = items.reduce((s, i) => s + (i.cartons as number), 0);
  if (Math.abs(sum - booking.cartons) <= EPS) return [];
  return [{
    ruleId: 'R-04', severity: 'Red',
    fieldRefs: [b('cartons'), ...items.map((_, i) => it(i, 'cartons'))],
    message: `The booking says ${plural(booking.cartons, 'carton')}, but the items add up to ${plural(sum, 'carton')}. The receiving site checks carton counts against the booking.`,
    fix: `Recount the cartons, or change the booking total to ${num(sum)}.`,
  }];
}

// ---------------------------------------------------------------------------
// R-05 weight per pallet ≤ carrier max. Returns a finding only when the check cannot run
// or when no carrier on the lane can take the load. Per-carrier exclusions are reported
// by recommendCarriers.

export function laneCarriers(booking: Booking, carriers: Carrier[]): Carrier[] {
  return carriers.filter((c) => c.originCountry === (booking.originCountry ?? ORIGIN_COUNTRY)
    && c.destinationCountry === booking.destinationCountry);
}

export function weightPerPallet(booking: Booking): number | null {
  if (!isNum(booking.pallets) || booking.pallets <= 0 || !isNum(booking.totalGrossWeightKg)) return null;
  return booking.totalGrossWeightKg / booking.pallets;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function r05(booking: Booking, carriers: Carrier[]): Finding[] {
  if (!isNum(booking.pallets) || booking.pallets <= 0) {
    return [{
      ruleId: 'R-05', severity: 'Red', fieldRefs: [b('pallets')],
      message: booking.pallets === 0
        ? 'The pallet count is 0, so the weight per pallet cannot be checked against carrier limits.'
        : 'The pallet count is missing, so the weight per pallet cannot be checked against carrier limits.',
      fix: 'Add how many pallets the goods are packed on.',
    }];
  }
  const perPallet = weightPerPallet(booking);
  if (perPallet === null) return []; // gross weight missing: reported by checkFields
  const lane = laneCarriers(booking, carriers);
  if (lane.length === 0) return []; // unsupported lane: reported by checkFields / recommendCarriers
  if (lane.some((c) => perPallet <= c.maxWeightPerPalletKg + EPS)) return [];
  const highest = Math.max(...lane.map((c) => c.maxWeightPerPalletKg));
  const needed = Math.ceil((booking.totalGrossWeightKg as number) / highest);
  return [{
    ruleId: 'R-05', severity: 'Red', fieldRefs: [b('totalGrossWeightKg'), b('pallets')],
    message: `${kg(booking.totalGrossWeightKg as number)} across ${plural(booking.pallets, 'pallet')} is ${kg(round1(perPallet))} per pallet. `
      + `No carrier on this route takes that: ${lane.map((c) => `${c.carrier} ${c.service} ${kg(c.maxWeightPerPalletKg)}`).join(', ')}.`,
    fix: `Spread the load over at least ${plural(needed, 'pallet')}, split the shipment, or correct the gross weight if it is wrong.`,
  }];
}

// ---------------------------------------------------------------------------
// R-06 dangerous goods keywords.

function keywordRegex(keyword: string): RegExp {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

export function matchDangerousGoods(text: string, keywords: DangerousGoodsKeyword[] = DEFAULT_DG): DangerousGoodsKeyword[] {
  return keywords.filter((k) => keywordRegex(k.keyword).test(text));
}

export function r06(items: Item[], keywords: DangerousGoodsKeyword[] = DEFAULT_DG): Finding[] {
  const out: Finding[] = [];
  items.forEach((item, i) => {
    const hits = matchDangerousGoods(`${item.sku ?? ''} ${item.description ?? ''}`, keywords);
    if (hits.length === 0) return;
    const words = hits.map((h) => `"${h.keyword}"`);
    const cats = [...new Set(hits.map((h) => h.category))];
    out.push({
      ruleId: 'R-06', severity: 'Red', fieldRefs: [it(i, 'description'), it(i, 'sku')],
      message: `${itemLabel(item, i)} matches ${listJoin(words)}, which suggests ${listJoin(cats)}. These cannot travel on standard road freight.`,
      fix: 'Remove this item from the booking, or if the keyword is a false match, change the description so it says plainly what the product is.',
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// R-07 gross weight ≥ Σ(unit weight × quantity).

export function netWeight(items: Item[]): number | null {
  if (items.some((i) => !isNum(i.unitWeightKg) || !isNum(i.quantity))) return null;
  return items.reduce((s, i) => s + (i.unitWeightKg as number) * (i.quantity as number), 0);
}

export function r07(booking: Booking, items: Item[]): Finding[] {
  const gross = booking.totalGrossWeightKg;
  const net = netWeight(items);
  if (!isNum(gross) || net === null || items.length === 0) return [];
  if (gross + EPS >= net) return [];
  return [{
    ruleId: 'R-07', severity: 'Amber',
    fieldRefs: [b('totalGrossWeightKg'), ...items.flatMap((_, i) => [it(i, 'unitWeightKg'), it(i, 'quantity')])],
    message: `The gross weight is ${kg(gross)}, but the products alone weigh ${kg(round1(net))}. Gross weight includes cartons and pallets, so it should be higher.`,
    fix: 'Weigh the shipment again, or check the unit weights and quantities.',
  }];
}

// ---------------------------------------------------------------------------
// R-08 warehouse needs a delivery appointment.

export function r08(booking: Booking): Finding[] {
  if (booking.destinationType !== 'Warehouse' || booking.deliveryAppointmentBooked === 'Yes') return [];
  const where = booking.destinationCity ? `the ${booking.destinationCity} warehouse` : 'the warehouse';
  return [{
    ruleId: 'R-08', severity: 'Amber', fieldRefs: [b('deliveryAppointmentBooked')],
    message: booking.deliveryAppointmentBooked === 'No'
      ? `No delivery appointment is booked with ${where}. Warehouses can turn away deliveries without one.`
      : `It's not yet known whether a delivery appointment is booked with ${where}. Warehouses can turn away deliveries without one.`,
    fix: `Book a delivery time slot with ${where}.`,
  }];
}

// ---------------------------------------------------------------------------
// R-09 every item has a country of origin.

export function r09(items: Item[]): Finding[] {
  return items.flatMap((item, i) => (item.countryOfOrigin ? [] : [{
    ruleId: 'R-09', severity: 'Amber' as const, fieldRefs: [it(i, 'countryOfOrigin')],
    message: `${itemLabel(item, i)} has no country of origin (where it was made, not where it ships from). Customs uses it to work out duty, so a gap could cause a delay.`,
    fix: `Add where ${itemLabel(item, i)} was made.`,
  }]));
}

// ---------------------------------------------------------------------------
// R-10 ready date not before today.

export function r10(booking: Booking, today: string): Finding[] {
  const d = booking.readyToShipDate;
  if (!d || d >= today) return [];
  return [{
    ruleId: 'R-10', severity: 'Amber', fieldRefs: [b('readyToShipDate')],
    message: `The ready-to-ship date is ${displayDate(d)}, which is before today (${displayDate(today)}). Carriers cannot collect in the past.`,
    fix: 'Change the ready date to today or a later day.',
  }];
}

// ---------------------------------------------------------------------------

const severityOrder = { Red: 0, Amber: 1 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, z) => severityOrder[a.severity] - severityOrder[z.severity]
    || (a.ruleId === 'DATA' ? 1 : 0) - (z.ruleId === 'DATA' ? 1 : 0)
    || a.ruleId.localeCompare(z.ruleId));
}

/** All findings for one booking, Red first then Amber. */
export function validateBooking(
  booking: Booking, items: Item[], today: string, carriers: Carrier[], options: ValidateOptions = {},
): Finding[] {
  return sortFindings([
    ...checkFields(booking, items),
    ...r01(items),
    ...r02(booking, items),
    ...r03(items),
    ...r04(booking, items),
    ...r05(booking, carriers),
    ...r06(items, options.dangerousGoods),
    ...r07(booking, items),
    ...r08(booking),
    ...r09(items),
    ...r10(booking, today),
  ]);
}
