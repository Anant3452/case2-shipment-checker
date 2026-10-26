// What's still missing, most blocking first (brief section 7: route before items, items before totals).

import { ORIGIN_CITIES, calculatedValue, money, num, type Item } from '../domain';
import { itemName } from '../domain/confirmation';
import type { ChatState } from './state';
import { itemKey } from './state';

export interface Question {
  /** Stable key, e.g. "booking.pallets", "item:MUG-01.hsCode", "items.more". */
  key: string;
  /** What to ask, in plain English. */
  text: string;
}

const ITEM_FIELDS: { field: keyof Item; ask: (name: string) => string }[] = [
  { field: 'hsCode', ask: (n) => `What's the HS code for ${n}? (The customs code that classifies your product. You can look it up on the UK Trade Tariff at gov.uk/trade-tariff.)` },
  { field: 'quantity', ask: (n) => `How many units of ${n}?` },
  { field: 'unitPrice', ask: (n) => `What's the price of one unit of ${n}, in GBP?` },
  { field: 'unitsPerCarton', ask: (n) => `How many units of ${n} go in one carton?` },
  { field: 'cartons', ask: (n) => `How many cartons of ${n}?` },
  { field: 'unitWeightKg', ask: (n) => `What does one unit of ${n} weigh, in kg?` },
  { field: 'countryOfOrigin', ask: (n) => `Where was ${n} made? (Country of origin: United Kingdom, China, India, Vietnam, Turkey or Germany.)` },
];

export function missingQuestions(state: ChatState): Question[] {
  const { booking: b, items, meta } = state;
  const skip = (key: string) => meta.unknown.includes(key);
  const q: Question[] = [];
  const add = (key: string, text: string) => { if (!skip(key)) q.push({ key, text }); };

  if (!b.originCity) add('booking.originCity', `Which UK city are the goods collected from: ${ORIGIN_CITIES.join(', ')}?`);
  if (!b.destinationCity) add('booking.destinationCity', 'Where are the goods going? We ship to Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon) and the Netherlands (Amsterdam, Rotterdam).');
  if (!b.destinationType) add('booking.destinationType', `Is the ${b.destinationCity ?? 'delivery'} site a warehouse or a business address?`);
  if (!b.readyToShipDate) add('booking.readyToShipDate', 'What date will the goods be packed and ready for collection?');
  if (!b.sellerPriority) add('booking.sellerPriority', 'What matters most for this shipment: cheapest, fastest, most reliable, or a balance of all three?');
  if (!b.sellerName) add('booking.sellerName', 'What is the name of the business sending the goods?');

  if (items.length === 0) {
    add('items.first', "What's in the shipment? For each product: name, HS code, quantity, unit price, units per carton, cartons, unit weight and country of origin.");
  } else {
    items.forEach((item, i) => {
      const name = itemName(item, i);
      const key = itemKey(item, i);
      if (!item.sku && !item.description) add(`${key}.description`, `What is product ${i + 1}?`);
      for (const f of ITEM_FIELDS) {
        if (item[f.field] == null || item[f.field] === '') add(`${key}.${f.field}`, f.ask(name));
      }
    });
    if (!meta.itemsDone) add('items.more', 'Anything else in this shipment, or is that everything?');
  }

  if (b.pallets == null || b.pallets === 0) {
    add('booking.pallets', b.cartons != null
      ? `Are the ${b.cartons} cartons packed on pallets? If so, how many pallets?`
      : 'How many pallets is the shipment packed on?');
  }
  // Totals can be derived from the items, but the seller confirms them; never filled in silently.
  const sumCartons = items.length && items.every((i) => i.cartons != null) ? items.reduce((s, i) => s + (i.cartons as number), 0) : null;
  const sumValue = items.length ? calculatedValue(items) : null;
  if (b.cartons == null && b.totalDeclaredValue == null && sumCartons != null && sumValue != null) {
    add('booking.totals', `Your items add up to ${num(sumCartons)} cartons and ${money(sumValue)}. Shall I use those as the booking totals for cartons and declared value?`);
  } else {
    if (b.cartons == null) add('booking.cartons', sumCartons != null
      ? `Your items add up to ${num(sumCartons)} cartons. Is that the total on the booking?`
      : 'How many cartons are in the shipment in total?');
    if (b.totalDeclaredValue == null) add('booking.totalDeclaredValue', sumValue != null
      ? `Your items add up to ${money(sumValue)}. Is that the total declared value?`
      : 'What is the total declared value of the goods, in GBP?');
  }
  if (b.totalGrossWeightKg == null) add('booking.totalGrossWeightKg', 'What is the total gross weight, including cartons and pallets, in kg?');
  if (b.destinationType === 'Warehouse' && b.deliveryAppointmentBooked == null) {
    add('booking.deliveryAppointmentBooked', `Do you have a delivery appointment booked with the ${b.destinationCity ?? ''} warehouse?`.replace('  ', ' '));
  }
  return q;
}
