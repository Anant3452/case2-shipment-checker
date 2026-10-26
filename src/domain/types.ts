// Types matching the template columns (Sheet 1 Bookings, Sheet 2 Items, Sheet 3 Carrier options).
// A field is null when the seller has not given it, or the cell was blank or unparseable.

export const ORIGIN_COUNTRY = 'United Kingdom';
export const ORIGIN_CITIES = ['London', 'Manchester', 'Birmingham', 'Leeds'] as const;
export const DESTINATIONS: Record<string, readonly string[]> = {
  Germany: ['Berlin', 'Frankfurt', 'Hamburg'],
  France: ['Paris', 'Lyon'],
  Netherlands: ['Amsterdam', 'Rotterdam'],
};
export const ITEM_ORIGIN_COUNTRIES = ['United Kingdom', 'China', 'India', 'Vietnam', 'Turkey', 'Germany'] as const;
export const DESTINATION_TYPES = ['Warehouse', 'Business address'] as const;
export const SELLER_PRIORITIES = ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'] as const;
export const CURRENCY = 'GBP';

export type DestinationType = (typeof DESTINATION_TYPES)[number];
export type SellerPriority = (typeof SELLER_PRIORITIES)[number];
export type YesNo = 'Yes' | 'No';

export interface Booking {
  bookingId: string;
  sellerName: string | null;
  originCity: string | null;
  originCountry: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationType: DestinationType | null;
  /** ISO date, YYYY-MM-DD. The sheets use DD-MM-YYYY; parsers convert. */
  readyToShipDate: string | null;
  sellerPriority: SellerPriority | null;
  pallets: number | null;
  cartons: number | null;
  totalDeclaredValue: number | null;
  currency: string | null;
  totalGrossWeightKg: number | null;
  deliveryAppointmentBooked: YesNo | null;
}

export interface Item {
  bookingId: string;
  sku: string | null;
  description: string | null;
  /** As the seller states it. R-01 normalises it. */
  hsCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  unitsPerCarton: number | null;
  cartons: number | null;
  unitWeightKg: number | null;
  countryOfOrigin: string | null;
}

export interface Carrier {
  carrier: string;
  service: string;
  originCountry: string;
  destinationCountry: string;
  pricePerPallet: number;
  transitDays: number;
  /** Percent, e.g. 92 */
  onTimeRate: number;
  maxWeightPerPalletKg: number;
}

export type Severity = 'Red' | 'Amber';

/** Points at the field a finding is about. The upload path turns these into cell references. */
export interface FieldRef {
  entity: 'booking' | 'item';
  /** Index into the items array, for entity 'item'. */
  index?: number;
  field: keyof Booking | keyof Item;
}

export interface Finding {
  /** R-01..R-10, or DATA for a missing or invalid field. */
  ruleId: string;
  severity: Severity;
  message: string;
  fix: string;
  fieldRefs: FieldRef[];
}

export type BookingStatus = 'Blocked' | 'Ready with warnings' | 'Ready';
