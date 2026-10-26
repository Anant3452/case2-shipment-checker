import type { Booking, Carrier, Item } from '../../src/domain';

/** BK-001 from the brief: clean. */
export function bk001(over: Partial<Booking> = {}): Booking {
  return {
    bookingId: 'BK-001', sellerName: 'Northfield Goods', originCity: 'Manchester', originCountry: 'United Kingdom',
    destinationCity: 'Frankfurt', destinationCountry: 'Germany', destinationType: 'Warehouse',
    readyToShipDate: '2026-11-05', sellerPriority: 'Cheapest', pallets: 3, cartons: 90,
    totalDeclaredValue: 5400, currency: 'GBP', totalGrossWeightKg: 620, deliveryAppointmentBooked: 'Yes',
    ...over,
  };
}

export function mug(over: Partial<Item> = {}): Item {
  return {
    bookingId: 'BK-001', sku: 'MUG-01', description: 'Ceramic coffee mug, 350 ml', hsCode: '691200',
    quantity: 1080, unitPrice: 5, unitsPerCarton: 12, cartons: 90, unitWeightKg: 0.5, countryOfOrigin: 'United Kingdom',
    ...over,
  };
}

export function carrier(over: Partial<Carrier> & Pick<Carrier, 'carrier'>): Carrier {
  return {
    service: 'Road', originCountry: 'United Kingdom', destinationCountry: 'Germany',
    pricePerPallet: 200, transitDays: 5, onTimeRate: 90, maxWeightPerPalletKg: 500,
    ...over,
  };
}

/** Synthetic Germany lane used by most tests (independent of the placeholder rate card). */
export const GERMANY: Carrier[] = [
  carrier({ carrier: 'Alpha', service: 'Economy', pricePerPallet: 180, transitDays: 5, onTimeRate: 92, maxWeightPerPalletKg: 500 }),
  carrier({ carrier: 'Bravo', service: 'Express', pricePerPallet: 240, transitDays: 3, onTimeRate: 95, maxWeightPerPalletKg: 600 }),
  carrier({ carrier: 'Charlie', service: 'Groupage', pricePerPallet: 165, transitDays: 7, onTimeRate: 85, maxWeightPerPalletKg: 400 }),
];

export const TODAY = '2026-10-26';

export const ids = (fs: { ruleId: string }[]) => [...new Set(fs.map((f) => f.ruleId))].sort();
