// Booking status and the plain-English confirmation.

import { carrierName, type Recommendation } from './carriers';
import { addDays, displayDate, kg, listJoin, money, num, plural } from './format';
import type { Booking, BookingStatus, Finding, Item } from './types';

export function computeStatus(findings: Finding[]): BookingStatus {
  if (findings.some((f) => f.severity === 'Red')) return 'Blocked';
  if (findings.some((f) => f.severity === 'Amber')) return 'Ready with warnings';
  return 'Ready';
}

export interface Confirmation {
  status: BookingStatus;
  /** "1,080 × Ceramic coffee mug, 350 ml" per item */
  goods: string[];
  route: string;
  carrier: string | null;
  totalCost: number | null;
  expectedArrival: string | null;
  nextSteps: string[];
  /** Full summary, ready to copy. */
  text: string;
}

/** Short "what to do" per rule, for next steps. */
function stepFor(f: Finding, booking: Booking): string {
  const site = booking.destinationCity ? `the ${booking.destinationCity} warehouse` : 'the warehouse';
  switch (f.ruleId) {
    case 'R-01': return 'add the missing HS codes';
    case 'R-02': return 'fix the R-02 value mismatch';
    case 'R-03': return 'fix the R-03 carton count on the affected items';
    case 'R-04': return 'fix the R-04 total carton count';
    case 'R-05': return booking.pallets ? 'fix the R-05 weight per pallet' : 'add the pallet count';
    case 'R-06': return 'remove the restricted goods flagged by R-06';
    case 'R-07': return 'check the gross weight (R-07)';
    case 'R-08': return `book a delivery appointment with ${site}`;
    case 'R-09': return 'add the missing country of origin';
    case 'R-10': return 'move the ready date to today or later';
    default: return f.fix.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
  }
}

export function itemName(item: Item, i: number): string {
  return item.description || item.sku || `item ${i + 1}`;
}

export function buildConfirmation(
  booking: Booking, items: Item[], recommendation: Recommendation, findings: Finding[] = [],
): Confirmation {
  const status = computeStatus(findings);
  const goods = items.map((it, i) => `${it.quantity != null ? num(it.quantity) : '?'} × ${itemName(it, i)}`);
  const to = [booking.destinationCity, booking.destinationCountry].filter(Boolean).join(', ') || 'destination not set';
  const route = `${booking.originCity ?? 'origin not set'} to ${to}${booking.destinationType ? ` (${booking.destinationType.toLowerCase()})` : ''}`;
  const rec = recommendation.recommended;
  const expectedArrival = rec && booking.readyToShipDate ? addDays(booking.readyToShipDate, rec.transitDays) : null;

  const steps = [...new Set(findings.map((f) => stepFor(f, booking)))];
  const nextSteps: string[] = [];
  if (steps.length) {
    const first = steps[0].replace(/^./, (c) => c.toUpperCase());
    nextSteps.push(`${listJoin([first, ...steps.slice(1)])}.`);
    nextSteps.push(status === 'Blocked'
      ? `Once ${steps.length === 1 ? 'that is' : 'these are'} done, the booking is ready to confirm.`
      : 'You can confirm now, but fixing the warnings first avoids delays.');
  } else {
    nextSteps.push('Confirm the booking.');
  }
  if (rec && booking.readyToShipDate && booking.originCity) {
    nextSteps.push(`Have the goods packed, labelled and ready for ${rec.carrier} to collect in ${booking.originCity} on ${displayDate(booking.readyToShipDate)}.`);
  }

  const lines = [
    `Booking ${booking.bookingId}${booking.sellerName ? ` for ${booking.sellerName}` : ''}`,
    `Shipping: ${goods.length ? listJoin(goods) : 'no items yet'}`,
    `Packed as: ${booking.pallets != null ? plural(booking.pallets, 'pallet') : '? pallets'}, ${booking.cartons != null ? plural(booking.cartons, 'carton') : '? cartons'}, ${booking.totalGrossWeightKg != null ? kg(booking.totalGrossWeightKg) : '? kg'} gross`,
    `Declared value: ${booking.totalDeclaredValue != null ? money(booking.totalDeclaredValue) : 'not set'} (GBP)`,
    `Route: ${route}`,
    `Ready to ship: ${booking.readyToShipDate ? displayDate(booking.readyToShipDate) : 'not set'}`,
    rec ? `Carrier: ${carrierName(rec)}, ${money(rec.totalCost)}` : `Carrier: none yet. ${recommendation.reason}`,
    expectedArrival ? `Expected arrival: ${displayDate(expectedArrival)} (${plural(rec!.transitDays, 'calendar day')} after collection)` : null,
    `Status: ${status}`,
    `Next steps: ${nextSteps.join(' ')}`,
  ].filter(Boolean) as string[];

  return {
    status, goods, route,
    carrier: rec ? carrierName(rec) : null,
    totalCost: rec ? rec.totalCost : null,
    expectedArrival,
    nextSteps,
    text: lines.join('\n'),
  };
}
